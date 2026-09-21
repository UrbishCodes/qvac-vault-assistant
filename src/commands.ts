import { Editor, MarkdownFileInfo, MarkdownView, Notice, TFile } from "obsidian";
import type QvacVaultAssistantPlugin from "./main";
import { AskModal, RelatedNotesModal, ResultModal } from "./modals";

/** Max note characters sent to the model (keeps context small & fast). */
const MAX_NOTE_CHARS = 12000;

function truncate(text: string, max = MAX_NOTE_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[…truncated for context length…]";
}

export function registerCommands(plugin: QvacVaultAssistantPlugin): void {
  plugin.addCommand({
    id: "summarize-note",
    name: "Summarize current note",
    checkCallback: (checking: boolean) => {
      const file = plugin.getActiveFile();
      if (!file) return false;
      if (!checking) void summarizeNote(plugin, file);
      return true;
    },
  });

  plugin.addCommand({
    id: "continue-writing",
    name: "Continue writing from cursor",
    editorCheckCallback: (checking: boolean, editor: Editor, _ctx: MarkdownView | MarkdownFileInfo) => {
      if (!plugin.getActiveFile()) return false;
      if (!checking) void continueWriting(plugin, editor);
      return true;
    },
  });

  plugin.addCommand({
    id: "ask-about-note",
    name: "Ask about current note…",
    checkCallback: (checking: boolean) => {
      const file = plugin.getActiveFile();
      if (!file) return false;
      if (!checking) void askAboutNote(plugin, file);
      return true;
    },
  });

  plugin.addCommand({
    id: "extract-action-items",
    name: "Extract action items from note",
    checkCallback: (checking: boolean) => {
      const file = plugin.getActiveFile();
      if (!file) return false;
      if (!checking) void extractActionItems(plugin, file);
      return true;
    },
  });

  plugin.addCommand({
    id: "find-related-notes",
    name: "Find related notes (semantic search)…",
    callback: () => void findRelatedNotes(plugin),
  });

  plugin.addCommand({
    id: "open-assistant-view",
    name: "Open Vault Assistant",
    callback: () => void plugin.activateView(),
  });
}

async function withProgress<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const notice = new Notice(`${label}…`, 0);
  try {
    return await fn();
  } finally {
    notice.hide();
  }
}

async function summarizeNote(plugin: QvacVaultAssistantPlugin, file: TFile): Promise<void> {
  const text = truncate(await plugin.app.vault.cachedRead(file));
  if (!text.trim()) {
    new Notice("Note is empty — nothing to summarize.");
    return;
  }
  try {
    const summary = await withProgress("Summarizing on-device", () =>
      plugin.qvac.summarize(text)
    );
    new ResultModal(
      plugin.app,
      `Summary — ${file.basename}`,
      summary,
      (inserted) => plugin.insertAtCursor(`\n\n## Summary\n\n${inserted}\n`),
      "Insert as section"
    ).open();
  } catch (err) {
    new Notice(`Summarize failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function continueWriting(plugin: QvacVaultAssistantPlugin, editor: Editor): Promise<void> {
  const selection = editor.getSelection();
  const context =
    selection ||
    editor.getRange({ line: 0, ch: 0 }, editor.getCursor()).slice(-2000);
  if (!context.trim()) {
    new Notice("Write something first, or select text to continue from.");
    return;
  }
  try {
    const continued = await withProgress("Writing on-device", () =>
      plugin.qvac.continueText(context)
    );
    const cursor = editor.getCursor();
    // If there was a selection, replace it; otherwise insert at cursor.
    if (selection) editor.replaceSelection(continued);
    else editor.replaceRange(continued, cursor);
    new Notice("Inserted AI continuation.");
  } catch (err) {
    new Notice(`Continue failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function askAboutNote(plugin: QvacVaultAssistantPlugin, file: TFile): Promise<void> {
  const question = await new AskModal(
    plugin.app,
    `Ask about “${file.basename}”`,
    "e.g. What are the key decisions in this note?",
    "Ask"
  ).prompt();
  if (!question) return;
  const text = truncate(await plugin.app.vault.cachedRead(file));
  try {
    const answer = await withProgress("Thinking on-device", () =>
      plugin.qvac.answerAboutNote(question, text, file.basename)
    );
    new ResultModal(plugin.app, `Q: ${question}`, answer, (inserted) =>
      plugin.insertAtCursor(`\n\n> **Q:** ${question}\n>\n> ${inserted.replace(/\n/g, "\n> ")}\n`)
    ).open();
  } catch (err) {
    new Notice(`Ask failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function extractActionItems(plugin: QvacVaultAssistantPlugin, file: TFile): Promise<void> {
  const text = truncate(await plugin.app.vault.cachedRead(file));
  if (!text.trim()) {
    new Notice("Note is empty — nothing to extract.");
    return;
  }
  try {
    const items = await withProgress("Extracting on-device", () =>
      plugin.qvac.extractActionItems(text)
    );
    new ResultModal(
      plugin.app,
      `Action items — ${file.basename}`,
      items,
      (inserted) => plugin.insertAtCursor(`\n\n## Action items\n\n${inserted}\n`),
      "Insert as section"
    ).open();
  } catch (err) {
    new Notice(`Extract failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function findRelatedNotes(plugin: QvacVaultAssistantPlugin): Promise<void> {
  const query = await new AskModal(
    plugin.app,
    "Find related notes",
    "e.g. notes about project planning…",
    "Search"
  ).prompt();
  if (!query) return;

  const files = plugin.app.vault.getMarkdownFiles();
  if (files.length === 0) {
    new Notice("No markdown notes in this vault.");
    return;
  }
  try {
    const hits = await withProgress("Searching on-device", async () => {
      // Read note contents first: findRelatedNotes needs {file, text} pairs,
      // and cachedRead avoids re-reading from disk on every search.
      const docs: { file: typeof files[number]; text: string }[] = [];
      for (const file of files) {
        const text = await plugin.app.vault.cachedRead(file);
        if (text.trim().length > 0) docs.push({ file, text });
      }
      return plugin.qvac.findRelatedNotes(
        query,
        docs,
        plugin.settings.relatedNotesLimit
      );
    });
    new RelatedNotesModal(plugin.app, query, hits).open();
  } catch (err) {
    new Notice(`Search failed: ${err instanceof Error ? err.message : err}`);
  }
}
