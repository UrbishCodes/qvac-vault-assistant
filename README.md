# ⚡ QVAC Vault Assistant

A private, **on-device AI assistant for Obsidian**, powered by [Tether's QVAC SDK](https://github.com/tetherto/qvac).
Summarize notes, continue writing, ask questions about a note, extract action items, and semantically
search your vault — with **zero cloud calls, zero API keys, and your notes never leaving your machine**.

Built for the [QVAC Whop bounty](https://whop.com/qvac/posts/post_1Cf6BActRMK2RVY3m4Lqcd/)
— *"Build a local AI app with Tether's QVAC SDK"*.

**Which QVAC functions it calls:** `loadModel` once per model, then `completion`
(summarize / continue / Q&A / action items) and `embed` (semantic vault search),
with `unloadModel` freeing RAM when the plugin is disabled.

## ✨ Features

| Command (Ctrl/Cmd+P) | What it does | QVAC function |
|---|---|---|
| Summarize current note | TL;DR + key points, insertable as a section | `completion` |
| Continue writing from cursor | Completes your selection / text before cursor | `completion` |
| Ask about current note… | Q&A grounded only in the open note | `completion` |
| Extract action items from note | Markdown checklist of todos & follow-ups | `completion` |
| Find related notes… | Semantic search across all vault notes | `embed` + cosine similarity |
| Open Vault Assistant | Side-panel chat grounded in the active note | `completion` |

- 📊 **Status bar** shows model state (`idle` → `loading…` → `ready`).
- ⚙️ **Settings tab**: pick the chat model (SmolLM2 360M / Qwen3 0.6B / Llama 3.2 1B), temperature, max tokens,
  related-notes limit, auto-unload on disable, plus manual Load/Unload buttons.
- 💾 Models download **once** on first use (with progress) and are cached locally by the SDK.

## 📋 Requirements

- 🖥️ **Obsidian desktop** (desktop-only — the QVAC worker needs Node).
- 📦 **Node.js ≥ 22.17** and **npm ≥ 10.9** (for building).
- 💽 Disk: ~2 GB free for the first model download. 🧠 RAM: ≥ 4 GB recommended.
- `@qvac/sdk` version used: **0.19.1** (declared in `package.json`, satisfies ≥ 0.19.0).

## 🚀 Install

### 1. 📥 Clone the repo

```bash
git clone https://github.com/Adata-cmd/qvac-vault-assistant.git
cd qvac-vault-assistant
```

### 2. 📦 Install dependencies

```bash
npm install
```

This installs `@qvac/sdk` — it is required at runtime, not just for the build.

### 3. 🔨 Build the plugin

```bash
npm run build
```

This produces `main.js` next to `manifest.json` and `styles.css`.

### 4. 📁 Copy the plugin into your vault

Copy the **entire** `qvac-vault-assistant` folder — including `node_modules`,
so `@qvac/sdk` and its worker resolve at runtime — into your vault's plugin folder:

```
<your-vault>/.obsidian/plugins/qvac-vault-assistant/
```

With a terminal:

```bash
mkdir -p "<your-vault>/.obsidian/plugins"
cp -r qvac-vault-assistant "<your-vault>/.obsidian/plugins/"
```

No terminal? Just drag the folder there in your file manager. When done it should look like this:

```
your-vault/.obsidian/plugins/qvac-vault-assistant/
├── manifest.json
├── main.js
├── styles.css
└── node_modules/
    └── @qvac/sdk/
```

> ⚠️ **Heads-up:** `node_modules` is ~5 GB — the QVAC SDK ships every on-device
> engine (LLM, embeddings, diffusion, OCR, TTS, translation…) and its worker
> loads all of them, so the whole folder must be copied. It's a one-time copy.
> On Windows, if Explorer struggles with a copy this large, use `robocopy`
> (handles big copies and long paths, shows progress):
>
> ```cmd
> robocopy "C:\path\to\qvac-vault-assistant\node_modules" "C:\path\to\<your-vault>\.obsidian\plugins\qvac-vault-assistant\node_modules" /E
> ```
>
> If a command later says `Cannot find module '@qvac/sdk'`, this copy is what
> went missing — re-copy `node_modules` and reload Obsidian (`Ctrl/Cmd+R`).

### 5. 🔌 Enable the plugin in Obsidian

1. Open **Settings → Community plugins**.
2. Turn off **Safe mode** (confirm the prompt) if it is on.
3. Find **QVAC Vault Assistant** in the list and toggle it **on**.
4. If it doesn't appear, reload Obsidian (`Ctrl/Cmd+R`) and double-check the folder
   name is exactly `qvac-vault-assistant`.

### 6. ▶️ Run your first command

1. Open any note.
2. Press `Ctrl/Cmd+P` and run **Summarize current note**.
3. The first run downloads the model (~2 GB, one time) — watch the progress notice.
   After that everything runs locally, no internet needed.

> 🆕 **New to Obsidian?** Create a vault via *Open folder as vault*, add a note with
> the **+** button, type a few paragraphs, then run the commands above. This repo's
> `demo-vault/` folder has sample notes — copy them into your vault to try
> semantic search right away.

> 🛠️ **Dev mode:** `npm run dev` watches `src/` and rebuilds `main.js` on change —
> then reload Obsidian (`Ctrl/Cmd+R`) to pick it up.

## 🧠 How it works

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

## 🔒 Privacy

100% on-device inference. No accounts, no API keys, no telemetry, no network calls
except the one-time model download from the QVAC model registry.

## ✅ Bounty compliance checklist

- [x] `@qvac/sdk@0.19.1` declared in `package.json` (≥ 0.19.0)
- [x] Calls `loadModel` + `completion` + `embed` (+ `unloadModel`) — all real SDK functions
- [x] All inference on-device (no cloud AI anywhere)
- [ ] Public repo — private during local testing, will be public before Whop submission; MIT license, README with install/run steps and SDK version
- [x] Original code — written for this bounty, not a fork of `qvac-examples`

## 📄 License

MIT — see [LICENSE](LICENSE).
