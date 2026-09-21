# Project Ideas 💡

Ideas worth building, collected over the last few months.

## Local-first AI notebook
An Obsidian plugin that summarizes notes and answers questions using a small
language model running entirely on-device. No data ever leaves the machine, so
it works for journals, work notes, and anything sensitive. The key challenge is
making the model small enough to be fast but smart enough to be useful — a 1B
parameter instruction-tuned model at 4-bit quantization seems like the sweet spot.

## Semantic vault search
Instead of keyword search, embed every note and rank by cosine similarity. Great
for rediscovering old notes you forgot you wrote. Needs an embedding model that
runs locally and incremental re-indexing when notes change.

## Focus timer with attention tracking
A pomodoro-style timer that learns when you do your best deep work and suggests
focus blocks accordingly. Pairs well with the ideas in *Deep Work* — long,
uninterrupted blocks beat fragmented attention every time.

## Private meeting assistant
Transcribe meetings locally, then extract action items and decisions without
sending audio to any cloud service. Privacy is the whole selling point.

---
*Next step: pick one idea and write a one-page plan for it.*
