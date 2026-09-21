# Meeting Notes — Plugin Launch Sync 📝
*2026-09-20, with the bounty team*

## Discussed
- The QVAC bounty deadline is approaching fast; the submission needs a public
  repo, a demo screenshot or recording, and a short description.
- Decided the plugin must stay desktop-only for now — the QVAC worker needs Node,
  so mobile support is out of scope.
- Model download size (~2 GB) worried the team; agreed to show a clear progress
  notice on first run and cache the model locally afterwards.
- Semantic search across the vault was the most exciting feature in testing —
  it surfaced related notes nobody remembered writing.

## Decisions
- Ship with two chat models (Llama 3.2 1B and Qwen3 0.6B) and let users switch
  in settings.
- Keep everything on-device; no analytics, no telemetry, no exceptions.

## Action items
- [ ] Record a 60-second demo video showing summarize + related notes
- [ ] Flip the repo from private to public before submitting to Whop
- [ ] Write the X post linking the repo and tagging @qvac
- [ ] Test the plugin on a fresh Obsidian vault to catch setup issues
- [ ] Double-check the README install steps on a second machine
