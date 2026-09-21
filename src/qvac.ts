import {
  LLAMA_3_2_1B_INST_Q4_0,
  QWEN3_600M_INST_Q4,
  EMBEDDINGGEMMA_300M_Q4_0,
  completion,
  embed,
  loadModel,
  unloadModel,
} from "@qvac/sdk";
import { Notice, TFile } from "obsidian";
import type { VaultAssistantSettings } from "./settings";

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
    private onStatus: (s: QvacStatus) => void
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
      // Branch explicitly: loadModel's descriptor overload is generic over a
      // single descriptor type, so a union of two descriptors won't infer.
      const modelId =
        this.getSettings().llmModel === "qwen3-0.6b"
          ? await loadModel({ modelSrc: QWEN3_600M_INST_Q4, onProgress })
          : await loadModel({ modelSrc: LLAMA_3_2_1B_INST_Q4_0, onProgress });
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
      const modelId = await loadModel({
        modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
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
    const modelId = await this.ensureLlmModel();
    const s = this.getSettings();
    const run = completion({
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
    return text.trim();
  }

  /** Embed one or more texts with the on-device embedding model. */
  async embedTexts(texts: string[]): Promise<number[][]> {
    const modelId = await this.ensureEmbedModel();
    const { embedding } = await embed({ modelId, text: texts });
    return embedding;
  }

  // ---------- High-level note features ----------

  async summarize(noteText: string): Promise<string> {
    return this.runCompletion(
      "You summarize notes clearly and concisely. Reply in markdown.",
      `Summarize the following note. Start with a 2-3 sentence TL;DR, then bullet the key points. Keep it tight:\n\n${noteText}`
    );
  }

  async continueText(context: string): Promise<string> {
    return this.runCompletion(
      "You are a writing assistant inside a note-taking app. Continue the user's writing in the same voice, tone, and formatting. Output ONLY the continuation — no preamble, no quotes.",
      `Continue writing from here:\n\n${context}`
    );
  }

  async answerAboutNote(question: string, noteText: string, noteName: string | null): Promise<string> {
    const scope = noteName ? `the note titled "${noteName}"` : "the provided note";
    return this.runCompletion(
      "You answer questions using ONLY the provided note. If the answer is not in the note, say so honestly. Reply in markdown.",
      `Question about ${scope}: ${question}\n\nNote content:\n${noteText}`
    );
  }

  async extractActionItems(noteText: string): Promise<string> {
    return this.runCompletion(
      "You extract action items from notes. Reply ONLY with a markdown checklist (- [ ] ...). If there are none, reply: _No action items found._",
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
    const ids = [this.llmModelId, this.embedModelId].filter((id): id is string => !!id);
    this.llmModelId = null;
    this.embedModelId = null;
    for (const modelId of ids) {
      try {
        await unloadModel({ modelId });
      } catch {
        /* best effort */
      }
    }
    this.setStatus("idle");
  }
}
