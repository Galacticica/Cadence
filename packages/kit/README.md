# @cadence/kit

The canonical Cadence sample kit — one real acoustic recording per drum
symbol, plus the count-in stick and the pitched TONE marimba.

These bytes are **canonical, not cosmetic** (SPEC §8): the same files are

- played by the web IDE,
- mixed by the core WAV **encoder** into program `.wav` files, and
- the **templates** the v1 decoder cross-correlates against.

All content is public domain / CC0 — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
Format: 44.1 kHz, 16-bit, mono WAV; onset at sample 0; peak −6 dBFS.

| Entry | Use |
|---|---|
| `@cadence/kit` (or `/node`) | Node loader: symbol → `Float32Array` PCM via core's WAV reader |
| `@cadence/kit/assets` | Vite asset URLs for the web app |
| `@cadence/kit/manifest` | The typed symbol → file contract |

`raw/` holds the unprocessed downloads; `tools/` the one-time processing
recipe. Neither is part of any build — the committed `samples/` and `tone/`
bytes are frozen (see [tools/PROCESSING.md](tools/PROCESSING.md)).
