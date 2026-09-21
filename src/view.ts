import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import type QvacVaultAssistantPlugin from "./main";

export const VIEW_TYPE_ASSISTANT = "qvac-vault-assistant-view";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

/** Side-panel chat grounded in the active note. All inference is on-device. */
export class AssistantView extends ItemView {
  plugin: QvacVaultAssistantPlugin;
  private messages: ChatMessage[] = [];
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, plugin: QvacVaultAssistantPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_ASSISTANT;
  }

  getDisplayText(): string {
    return "Vault Assistant";
  }

  getIcon(): string {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("qvac-assistant-view");

    contentEl.createEl("h4", { text: "Vault Assistant", cls: "qvac-view-title" });
    contentEl.createEl("p", {
      cls: "qvac-settings-note",
      text: "Ask anything — answers are grounded in your active note and generated 100% on-device by QVAC. Nothing leaves your machine.",
    });

    this.messagesEl = contentEl.createDiv({ cls: "qvac-chat-messages" });

    const composer = contentEl.createDiv({ cls: "qvac-composer" });
    this.inputEl = composer.createEl("textarea", {
      cls: "qvac-chat-input",
      attr: { rows: "3", placeholder: "Ask about the active note… (Enter to send)" },
    });
    const sendBtn = composer.createEl("button", { text: "Ask", cls: "mod-cta" });
    sendBtn.addEventListener("click", () => void this.ask());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.ask();
      }
    });
  }

  private async ask(): Promise<void> {
    if (this.busy) return;
    const question = this.inputEl.value.trim();
    if (!question) return;
    this.busy = true;
    this.inputEl.value = "";

    this.messages.push({ role: "user", text: question });
    this.messages.push({ role: "assistant", text: "_Thinking on-device…_" });
    this.renderMessages();

    try {
      const note = await this.plugin.getActiveNoteContent();
      const answer = await this.plugin.qvac.answerAboutNote(
        question,
        note ? note.text : "",
        note ? note.file.basename : null
      );
      this.messages[this.messages.length - 1] = { role: "assistant", text: answer };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.messages[this.messages.length - 1] = {
        role: "assistant",
        text: `⚠️ ${msg}`,
      };
    } finally {
      this.busy = false;
      this.renderMessages();
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private renderMessages(): void {
    this.messagesEl.empty();
    for (const m of this.messages) {
      const div = this.messagesEl.createDiv({
        cls: `qvac-chat-msg qvac-chat-${m.role}`,
      });
      if (m.role === "assistant") {
        MarkdownRenderer.render(this.app, m.text, div, "/", this);
      } else {
        div.setText(m.text);
      }
    }
  }

  async onClose(): Promise<void> {
    // nothing to tear down
  }
}
