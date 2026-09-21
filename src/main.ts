import { Editor, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  VaultAssistantSettings,
  VaultAssistantSettingTab,
} from "./settings";
import { QvacService } from "./qvac";
import { registerCommands } from "./commands";
import { AssistantView, VIEW_TYPE_ASSISTANT } from "./view";

export default class QvacVaultAssistantPlugin extends Plugin {
  settings!: VaultAssistantSettings;
  qvac!: QvacService;
  private statusBarEl!: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.qvac = new QvacService(
      () => this.settings,
      (status) => this.updateStatusBar(status)
    );

    this.addSettingTab(new VaultAssistantSettingTab(this.app, this));

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar("idle");

    this.addRibbonIcon("sparkles", "Open Vault Assistant", () => {
      void this.activateView();
    });

    this.registerView(VIEW_TYPE_ASSISTANT, (leaf: WorkspaceLeaf) => new AssistantView(leaf, this));

    registerCommands(this);

    // Warm hint: if the model was left loaded last session, status reflects it lazily.
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateStatusBar(this.qvac.status))
    );
  }

  async onunload(): Promise<void> {
    if (this.settings.autoUnloadOnDisable) {
      await this.qvac.unloadAll().catch(() => {
        /* best effort */
      });
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ASSISTANT);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_ASSISTANT)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_ASSISTANT, active: true });
    }
    void workspace.revealLeaf(leaf);
  }

  /** The currently active markdown file, if any. */
  getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  /** Read the active note; null when no note is open. */
  async getActiveNoteContent(): Promise<{ file: TFile; text: string } | null> {
    const file = this.getActiveFile();
    if (!file) return null;
    const text = await this.app.vault.cachedRead(file);
    return { file, text };
  }

  /** Insert text at the cursor of the active markdown editor. */
  insertAtCursor(text: string): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Open a note to insert into.");
      return;
    }
    const editor: Editor = view.editor;
    editor.replaceRange(text, editor.getCursor());
    new Notice("Inserted into note.");
  }

  private updateStatusBar(status: string): void {
    if (!this.statusBarEl) return;
    const label =
      status === "ready"
        ? "QVAC: ready"
        : status === "loading"
          ? "QVAC: loading…"
          : status === "error"
            ? "QVAC: error"
            : "QVAC: idle";
    this.statusBarEl.setText(label);
    this.statusBarEl.setAttribute("title", `QVAC Vault Assistant — model ${status}`);
  }
}
