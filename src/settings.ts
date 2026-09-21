import { App, PluginSettingTab, Setting } from "obsidian";
import type QvacVaultAssistantPlugin from "./main";

export type LlmModelChoice = "smollm2-360m" | "qwen3-0.6b" | "llama-3.2-1b";

export interface VaultAssistantSettings {
  /** Which chat model to load on-device. */
  llmModel: LlmModelChoice;
  /** Sampling temperature for completions. */
  temperature: number;
  /** Max tokens per completion. */
  maxTokens: number;
  /** How many related notes "Find related notes" returns. */
  relatedNotesLimit: number;
  /** Unload models from RAM when the plugin is disabled. */
  autoUnloadOnDisable: boolean;
}

export const DEFAULT_SETTINGS: VaultAssistantSettings = {
  llmModel: "smollm2-360m",
  temperature: 0.7,
  maxTokens: 512,
  relatedNotesLimit: 8,
  autoUnloadOnDisable: true,
};

export class VaultAssistantSettingTab extends PluginSettingTab {
  plugin: QvacVaultAssistantPlugin;

  constructor(app: App, plugin: QvacVaultAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "QVAC Vault Assistant" });
    containerEl.createEl("p", {
      text: "All AI runs 100% on-device via Tether's QVAC SDK. The selected model downloads once (on first use) and is cached locally — no API key, no cloud, your notes never leave this machine.",
      cls: "qvac-settings-note",
    });

    new Setting(containerEl)
      .setName("Chat model")
      .setDesc("On-device model used for summarize / continue / ask. Smaller is faster; larger is smarter.")
      .addDropdown((drop) =>
        drop
          .addOption("smollm2-360m", "SmolLM2 360M (fastest, recommended)")
          .addOption("qwen3-0.6b", "Qwen3 0.6B (balanced)")
          .addOption("llama-3.2-1b", "Llama 3.2 1B (best quality, slower)")
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings.llmModel = value as LlmModelChoice;
            await this.plugin.saveSettings();
            // Model choice changed -> drop the loaded model so the new one loads lazily.
            await this.plugin.qvac.unloadAll();
          })
      );

    new Setting(containerEl)
      .setName("Temperature")
      .setDesc("Higher = more creative, lower = more focused. 0.7 is a good default.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 1.5, 0.1)
          .setValue(this.plugin.settings.temperature)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.temperature = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Maximum length of a single AI response.")
      .addSlider((slider) =>
        slider
          .setLimits(128, 2048, 64)
          .setValue(this.plugin.settings.maxTokens)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxTokens = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Related notes limit")
      .setDesc("How many notes 'Find related notes' returns.")
      .addSlider((slider) =>
        slider
          .setLimits(3, 20, 1)
          .setValue(this.plugin.settings.relatedNotesLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.relatedNotesLimit = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Unload model when disabled")
      .setDesc("Free the model's RAM when the plugin is turned off.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoUnloadOnDisable)
          .onChange(async (value) => {
            this.plugin.settings.autoUnloadOnDisable = value;
            await this.plugin.saveSettings();
          })
      );

    const status = containerEl.createEl("p", { cls: "qvac-settings-note" });
    status.setText(`QVAC status: ${this.plugin.qvac.describeStatus()}`);
    new Setting(containerEl)
      .setName("Model status")
      .setDesc("Load the model now (downloads on first run), or free its memory.")
      .addButton((btn) =>
        btn.setButtonText("Load model now").onClick(async () => {
          await this.plugin.qvac.ensureLlmModel();
          this.display();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Unload").onClick(async () => {
          await this.plugin.qvac.unloadAll();
          this.display();
        })
      );
  }
}
