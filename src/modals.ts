import { App, Modal, MarkdownRenderer, Notice, TFile } from "obsidian";

/** Small modal that asks the user for a single line of input. */
export class AskModal extends Modal {
  private resolve: (value: string | null) => void;
  private settled = false;
  private inputEl!: HTMLInputElement;

  constructor(app: App, private title: string, private placeholder: string, private cta: string) {
    super(app);
    this.resolve = () => {};
  }

  /** Opens the modal and resolves with the entered text, or null on cancel. */
  prompt(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      placeholder: this.placeholder,
      cls: "qvac-ask-input",
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.submit();
    });

    const btnRow = contentEl.createDiv({ cls: "qvac-btn-row" });
    const askBtn = btnRow.createEl("button", { text: this.cta, cls: "mod-cta" });
    askBtn.addEventListener("click", () => this.submit());
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    setTimeout(() => this.inputEl.focus(), 50);
  }

  private submit(): void {
    const value = this.inputEl.value.trim();
    this.settled = true;
    this.close();
    this.resolve(value.length > 0 ? value : null);
  }

  onClose(): void {
    // If closed without submitting (esc / X), resolve null once.
    if (this.settled) return;
    this.settled = true;
    this.resolve(null);
  }
}

/** Modal that renders markdown AI output with Copy / Insert actions. */
export class ResultModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private markdown: string,
    private onInsert?: (text: string) => void,
    private insertLabel = "Insert at cursor"
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("qvac-result-modal");
    contentEl.createEl("h3", { text: this.title });

    const body = contentEl.createDiv({ cls: "qvac-result-body" });
    MarkdownRenderer.render(this.app, this.markdown, body, "/", this as unknown as never);

    const btnRow = contentEl.createDiv({ cls: "qvac-btn-row" });

    const copyBtn = btnRow.createEl("button", { text: "Copy" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.markdown);
      new Notice("Copied to clipboard");
    });

    if (this.onInsert) {
      const insertBtn = btnRow.createEl("button", { text: this.insertLabel, cls: "mod-cta" });
      insertBtn.addEventListener("click", () => {
        this.onInsert?.(this.markdown);
        this.close();
      });
    }

    const closeBtn = btnRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Modal listing related notes with scores; clicking a row opens the note. */
export class RelatedNotesModal extends Modal {
  constructor(
    app: App,
    private queryLabel: string,
    private hits: { file: TFile; score: number }[]
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Notes related to “${this.queryLabel}”` });
    contentEl.createEl("p", {
      text: "Ranked by on-device semantic similarity (QVAC embed).",
      cls: "qvac-settings-note",
    });

    const list = contentEl.createEl("ul", { cls: "qvac-related-list" });
    if (this.hits.length === 0) {
      list.createEl("li", { text: "No related notes found." });
    }
    for (const hit of this.hits) {
      const li = list.createEl("li");
      const link = li.createEl("a", { text: hit.file.basename, cls: "qvac-related-link" });
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        await this.app.workspace.getLeaf(false).openFile(hit.file);
        this.close();
      });
      li.createEl("span", {
        text: ` — ${(hit.score * 100).toFixed(1)}% match · ${hit.file.path}`,
        cls: "qvac-related-meta",
      });
    }

    const btnRow = contentEl.createDiv({ cls: "qvac-btn-row" });
    const closeBtn = btnRow.createEl("button", { text: "Close", cls: "mod-cta" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
