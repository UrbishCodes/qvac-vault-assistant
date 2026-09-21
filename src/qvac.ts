import { createRequire } from "module";
import { Notice, TFile } from "obsidian";
import type QvacVaultAssistantPlugin from "./main";
import type { VaultAssistantSettings } from "./settings";

/** Type-only import: erased at compile time, so the SDK is never loaded eagerly. */
type QvacSdk = typeof import("@qvac/sdk");

let sdkPromise: Promise<QvacSdk> | null = null;

/**
 * Reasoning models (e.g. Qwen3) wrap their chain-of-thought in
 * `<think>...</think>` — or ramble through it untagged. The user should only
 * ever see the final answer, so strip those blocks (including an unclosed
 * trailing one, in case generation was cut off).
 */
function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .replace(/^\s*$/, "")
    .trim();
}

/**
 * True when the QVAC worker no longer knows a model ID we cached — e.g.
 * `Model with ID "bd4db59fb4120b52" not found` (SDK code 52002,
 * MODEL_NOT_FOUND). This happens when the worker process restarts (heavy
 * model loads can crash it); the fix is to load the model again.
 */
function isModelNotFound(err: unknown): boolean {
  const e = err as { code?: number; name?: string; message?: string };
  if (e?.code === 52002) return true;
  if (typeof e?.name === "string" && /modelnotfound/i.test(e.name)) return true;
  const msg = typeof e?.message === "string" ? e.message : String(err);
  return /model with id .* not found/i.test(msg);
}

/**
 * Absolute path of this plugin's folder on disk, e.g.
 * `C:/Users/you/vault/.obsidian/plugins/qvac-vault-assistant`.
 * Derived from the vault path + manifest id instead of trusting the module
 * loader's context, which Obsidian does not set up like plain Node does.
 */
function getPluginDir(plugin: QvacVaultAssistantPlugin): string {
  const adapter = plugin.app.vault.adapter as unknown as {
    getBasePath?: () => string;
  };
  const basePath = adapter.getBasePath?.();
  if (!basePath) {
    throw new Error(
      "Could not determine the vault folder (this plugin needs desktop file access)."
    );
  }
  return `${basePath}/.obsidian/plugins/${plugin.manifest.id}`;
}

/**
 * Pre-flight check: verify the SDK files actually made it into the installed
 * plugin folder, and return the plugin dir. A missing/incomplete node_modules
 * copy (on Windows, usually the 260-char path limit silently skipping files)
 * is the #1 install failure, so name the exact file that's absent.
 */
async function assertSdkFilesPresent(
  plugin: QvacVaultAssistantPlugin
): Promise<string> {
  const rel = (p: string) =>
    `.obsidian/plugins/${plugin.manifest.id}/node_modules/@qvac/sdk/${p}`;
  for (const file of ["package.json", "dist/src/index.js"]) {
    const ok = await plugin.app.vault.adapter.exists(rel(file));
    if (!ok) {
      throw new Error(
        "QVAC SDK files are missing from the installed plugin folder. " +
          `Expected "${rel(file)}" inside your vault — the node_modules copy is ` +
          "incomplete (on Windows this is usually the 260-char path limit silently " +
          "skipping files). Re-copy the plugin's node_modules folder, then reload " +
          "Obsidian (Ctrl/Cmd+R)."
      );
    }
  }
  return getPluginDir(plugin);
}

/**
 * Load the QVAC SDK lazily on first AI use — never at plugin startup.
 *
 * Two strategies, most deterministic first:
 * 1. `createRequire` anchored at the plugin's real folder → resolves
 *    `node_modules/@qvac/sdk` from disk no matter how the host loaded us.
 * 2. Bare-specifier dynamic `import("@qvac/sdk")` (host-resolved).
 */
function getSdk(plugin: QvacVaultAssistantPlugin): Promise<QvacSdk> {
  if (!sdkPromise) {
    sdkPromise = (async (): Promise<QvacSdk> => {
      const pluginDir = await assertSdkFilesPresent(plugin);
      const failures: string[] = [];

      try {
        const req = createRequire(`${pluginDir}/package.json`);
        return req("@qvac/sdk") as QvacSdk;
      } catch (err) {
        failures.push(
          `absolute-path require: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      try {
        return (await import("@qvac/sdk")) as QvacSdk;
      } catch (err) {
        failures.push(
          `dynamic import: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      sdkPromise = null; // allow retry once the install is fixed
      throw new Error(
        "QVAC SDK failed to load from the installed plugin folder " +
          `(${pluginDir}). Tried: ${failures.join(" | ")}`
      );
    })();
  }
  return sdkPromise;
}

export type QvacStatus = "idle" | "loading" | "ready" | "error";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Thin, lazy wrapper around the QVAC SDK.
 *
 * - Models load on first use (with download progress), never at startup.
 * - Uses `loadModel` + `completion` for text and `loadModel` + `embed`
 *   for semantic search. Everything runs on-device.
 */
export class QvacService {
  status: QvacStatus = "idle";
  private llmModelId: string | null = null;
  private embedModelId: string | null = null;
  private llmLoading: Promise<string> | null = null;
  private embedLoading: Promise<string> | null = null;

  constructor(
    private getSettings: () => VaultAssistantSettings,
    private onStatus: (s: QvacStatus) => void,
    private plugin: QvacVaultAssistantPlugin
  ) {}

  describeStatus(): string {
    if (this.status === "ready") return "ready — model loaded in memory";
    if (this.status === "loading") return "loading — downloading / initializing model…";
    if (this.status === "error") return "error — see console (Ctrl+Shift+I)";
    return "idle — model loads automatically on first AI command";
  }

  private setStatus(s: QvacStatus): void {
    this.status = s;
    try {
      this.onStatus(s);
    } catch {
      /* never break inference on a UI callback */
    }
  }

  /** Load (downloading on first run) the chat model; cached after. */
  async ensureLlmModel(): Promise<string> {
    if (this.llmModelId) return this.llmModelId;
    if (!this.llmLoading) this.llmLoading = this.loadLlm();
    return this.llmLoading;
  }

  private async loadLlm(): Promise<string> {
    this.setStatus("loading");
    const notice = new Notice("QVAC: preparing on-device model… 0%", 0);
    const onProgress = (p: { percentage: number }) => {
      notice.setMessage(`QVAC: preparing on-device model… ${p.percentage.toFixed(0)}%`);
    };
    try {
      const sdk = await getSdk(this.plugin);
      // Branch explicitly: loadModel's descriptor overload is generic over a
      // single descriptor type, so a union of descriptors won't infer.
      const choice = this.getSettings().llmModel;
      const onProg = { onProgress };
      const modelId =
        choice === "smollm2-360m"
          ? await sdk.loadModel({ modelSrc: sdk.SMOLLM2_360M_INST_Q8, ...onProg })
          : choice === "qwen3-0.6b"
            ? await sdk.loadModel({ modelSrc: sdk.QWEN3_600M_INST_Q4, ...onProg })
            : await sdk.loadModel({ modelSrc: sdk.LLAMA_3_2_1B_INST_Q4_0, ...onProg });
      this.llmModelId = modelId;
      this.setStatus("ready");
      notice.setMessage("QVAC: model ready — running 100% on-device");
      setTimeout(() => notice.hide(), 2000);
      return modelId;
    } catch (err) {
      this.setStatus("error");
      notice.hide();
      throw err;
    } finally {
      this.llmLoading = null;
    }
  }

  /** Load the embedding model (for semantic search); cached after. */
  async ensureEmbedModel(): Promise<string> {
    if (this.embedModelId) return this.embedModelId;
    if (!this.embedLoading) this.embedLoading = this.loadEmbed();
    return this.embedLoading;
  }

  private async loadEmbed(): Promise<string> {
    this.setStatus("loading");
    const notice = new Notice("QVAC: preparing embedding model… 0%", 0);
    try {
      const sdk = await getSdk(this.plugin);
      const modelId = await sdk.loadModel({
        modelSrc: sdk.EMBEDDINGGEMMA_300M_Q4_0,
        onProgress: (p: { percentage: number }) => {
          notice.setMessage(`QVAC: preparing embedding model… ${p.percentage.toFixed(0)}%`);
        },
      });
      this.embedModelId = modelId;
      if (!this.llmModelId) this.setStatus("idle");
      notice.hide();
      return modelId;
    } catch (err) {
      this.setStatus("error");
      notice.hide();
      throw err;
    } finally {
      this.embedLoading = null;
    }
  }

  /** Run a chat completion and return the full text. */
  private async runCompletion(system: string, user: string): Promise<string> {
    // Retry once if the worker lost our model (e.g. it restarted after a
    // heavy load): drop the stale ID and load fresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const modelId = await this.ensureLlmModel();
        const sdk = await getSdk(this.plugin);
        const s = this.getSettings();
        const run = sdk.completion({
          modelId,
          history: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          stream: true,
          generationParams: { temp: s.temperature, predict: s.maxTokens },
        });
        let text = "";
        for await (const token of run.tokenStream) text += token;
        return stripThinking(text).trim();
      } catch (err) {
        if (attempt === 0 && isModelNotFound(err)) {
          this.llmModelId = null;
          this.llmLoading = null;
          continue;
        }
        throw err;
      }
    }
    throw new Error("unreachable");
  }

  /** Embed one or more texts with the on-device embedding model. */
  async embedTexts(texts: string[]): Promise<number[][]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const modelId = await this.ensureEmbedModel();
        const sdk = await getSdk(this.plugin);
        const { embedding } = await sdk.embed({ modelId, text: texts });
        return embedding;
      } catch (err) {
        if (attempt === 0 && isModelNotFound(err)) {
          this.embedModelId = null;
          this.embedLoading = null;
          continue;
        }
        throw err;
      }
    }
    throw new Error("unreachable");
  }

  // ---------- High-level note features ----------

  async summarize(noteText: string): Promise<string> {
    return this.runCompletion(
      "You are a summarizer. You ALWAYS paraphrase: restate every idea in completely new words. You NEVER copy sentences, phrases, headings, or formatting from the input. Your output must be much shorter than the input.",
      `Summarize the note below in your own words.\n` +
        `Rules:\n` +
        `1. Maximum 120 words total.\n` +
        `2. Start with "TL;DR:" followed by 1-2 sentences capturing the single most important idea.\n` +
        `3. Then 3-5 bullet points, one sentence each, covering the remaining key points.\n` +
        `4. Use your own words - do not copy any sentence from the note.\n` +
        `5. Skip quotes and minor details.\n\n` +
        `Note:\n${noteText}`
    );
  }

  async continueText(context: string): Promise<string> {
    return this.runCompletion(
      "You are a writing assistant inside a note-taking app. Continue the user's writing in the same voice, tone, and formatting. Output ONLY the continuation — no preamble, no quotes, never narrate your thinking or planning.",
      `Continue writing from here:\n\n${context}`
    );
  }

  async answerAboutNote(question: string, noteText: string, noteName: string | null): Promise<string> {
    const scope = noteName ? `the note titled "${noteName}"` : "the provided note";
    return this.runCompletion(
      "You answer questions about a note. Answer directly in 2-5 sentences using your own words. NEVER repeat, reformat, or paste the note back. If asked what the note is about, briefly describe its topic and main points — do not dump the note's contents.",
      `Note:\n${noteText}\n\nQuestion about ${scope}: ${question}\n\nAnswer the question above using only the note. Be concise, in your own words.`
    );
  }

  async extractActionItems(noteText: string): Promise<string> {
    return this.runCompletion(
      "You extract action items from notes. Reply ONLY with a markdown checklist (- [ ] ...). If there are none, reply: _No action items found._ Never narrate your thinking or planning.",
      `Extract every action item, task, todo, or follow-up from this note:\n\n${noteText}`
    );
  }

  /**
   * Semantic search over the vault: embed the query and each note,
   * rank by cosine similarity. Fully on-device via QVAC `embed`.
   */
  async findRelatedNotes(
    query: string,
    docs: { file: TFile; text: string }[],
    limit: number
  ): Promise<{ file: TFile; score: number }[]> {
    if (docs.length === 0) return [];
    const BATCH = 8;
    const queryVec = (await this.embedTexts([query.slice(0, 2000)]))[0];

    const scored: { file: TFile; score: number }[] = [];
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      const vecs = await this.embedTexts(batch.map((d) => d.text.slice(0, 2000)));
      batch.forEach((d, j) => {
        // Cosine similarity is [-1, 1]; clamp negatives to 0 for display.
        const score = Math.max(0, cosine(queryVec, vecs[j]));
        scored.push({ file: d.file, score });
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Free model RAM. Called on plugin unload and when switching models. */
  async unloadAll(): Promise<void> {
    const sdk = await getSdk(this.plugin).catch(() => null);
    const ids = [this.llmModelId, this.embedModelId].filter((id): id is string => !!id);
    this.llmModelId = null;
    this.embedModelId = null;
    if (!sdk) {
      this.setStatus("idle");
      return;
    }
    for (const modelId of ids) {
      try {
        await sdk.unloadModel({ modelId });
      } catch {
        /* best effort */
      }
    }
    this.setStatus("idle");
  }

  /**
   * Verify the SDK module loads, without downloading any model.
   * Powers the "Diagnose QVAC setup" command.
   */
  async diagnose(): Promise<string> {
    const sdk = await getSdk(this.plugin);
    const checks: Array<[string, unknown]> = [
      ["loadModel", sdk.loadModel],
      ["completion", sdk.completion],
      ["embed", sdk.embed],
      ["unloadModel", sdk.unloadModel],
    ];
    const missing = checks.filter(([, fn]) => typeof fn !== "function").map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`QVAC SDK loaded but is missing: ${missing.join(", ")}`);
    }
    return "QVAC SDK loads OK — loadModel, completion, embed, unloadModel all present. Models download on first AI command (~2 GB, cached locally).";
  }
}
