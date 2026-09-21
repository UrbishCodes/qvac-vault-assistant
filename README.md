# QVAC Vault Assistant

A private, **on-device AI assistant for Obsidian**, powered by [Tether's QVAC SDK](https://github.com/tetherto/qvac).
Summarize notes, continue writing, ask questions about a note, extract action items, and semantically
search your vault — with **zero cloud calls, zero API keys, and your notes never leaving your machine**.

Built for the [QVAC Whop bounty](https://whop.com/qvac/posts/post_1Cf6BActRMK2RVY3m4Lqcd/)
— *"Build a local AI app with Tether's QVAC SDK"*.

**What it does / which QVAC functions it calls:**
An Obsidian plugin that brings local AI to your notes. It calls `loadModel` once per model,
then `completion` (summarize / continue / Q&A / action items) and `embed` (semantic vault search),
with `unloadModel` freeing RAM on disable.

## Features

| Command (Ctrl/Cmd+P) | What it does | QVAC function |
|---|---|---|
| Summarize current note | TL;DR + key points, insertable as a section | `completion` |
| Continue writing from cursor | Completes your selection / text before cursor | `completion` |
| Ask about current note… | Q&A grounded only in the open note | `completion` |
| Extract action items from note | Markdown checklist of todos & follow-ups | `completion` |
| Find related notes… | Semantic search across all vault notes | `embed` + cosine similarity |
| Open Vault Assistant | Side-panel chat grounded in the active note | `completion` |

- **Status bar** shows model state (`idle` → `loading…` → `ready`).
- **Settings tab**: pick the chat model (Llama 3.2 1B / Qwen3 0.6B), temperature, max tokens,
  related-notes limit, auto-unload on disable, plus manual Load/Unload buttons.
- Models download **once** on first use (with progress) and are cached locally by the SDK.

## Requirements

- **Obsidian desktop** (this plugin is desktop-only — the QVAC worker needs Node).
- **Node.js ≥ 22.17** and **npm ≥ 10.9** (for building; the QVAC worker also needs Node).
- Disk: ~2 GB free for the first model download. RAM: ≥ 4 GB recommended.
- `@qvac/sdk` version used: **0.19.1** (declared in `package.json`, satisfies ≥ 0.19.0).

## Install

1. Clone this repo:
   ```bash
   git clone https://github.com/Adata-cmd/qvac-vault-assistant.git
   cd qvac-vault-assistant
   ```
2. Install dependencies (this installs `@qvac/sdk` — required at runtime):
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
   This produces `main.js` next to `manifest.json` and `styles.css`.
4. Copy the **entire plugin folder** (including `node_modules`, so `@qvac/sdk` and its
   worker resolve) into your vault:
   ```
   <vault>/.obsidian/plugins/qvac-vault-assistant/
   ```
5. In Obsidian: **Settings → Community plugins → enable "QVAC Vault Assistant"**
   (turn off Safe mode first if needed).
6. Run any command (e.g. *Summarize current note*). The model downloads on first use —
   watch the progress notice, then everything runs locally.

> **Dev mode:** `npm run dev` watches `src/` and rebuilds `main.js` on change.

## How it works

```
User command ──▶ QvacService ──▶ loadModel (once, cached)
                                  ├─▶ completion  → summarize / continue / ask / actions
                                  └─▶ embed       → vault semantic search
Plugin disable ─▶ unloadModel (frees RAM)
```

- `src/qvac.ts` — lazy model lifecycle + all QVAC calls.
- `src/commands.ts` — the six commands.
- `src/view.ts` — side-panel chat view.
- `src/modals.ts` — ask / result / related-notes modals.
- `src/settings.ts` — settings tab.
- `src/main.ts` — plugin entry, ribbon icon, status bar.

The `@qvac/sdk` package is kept **external** in the esbuild bundle (see `esbuild.config.mjs`)
because it ships a native worker binary — it is resolved from the plugin folder's
`node_modules` at runtime, which is why step 4 copies the whole folder.

## Privacy

100% on-device inference. No accounts, no API keys, no telemetry, no network calls
except the one-time model download from the QVAC model registry.

## Bounty compliance checklist

- [x] `@qvac/sdk@0.19.1` declared in `package.json` (≥ 0.19.0)
- [x] Calls `loadModel` + `completion` + `embed` (+ `unloadModel`) — all real SDK functions
- [x] All inference on-device (no cloud AI anywhere)
- [x] Public repo, MIT license, README with install/run steps and SDK version
- [x] Original code — written for this bounty, not a fork of `qvac-examples`

## License

MIT — see [LICENSE](LICENSE).
