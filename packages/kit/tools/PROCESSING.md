# Sample processing — one-time recipe

The files in `samples/` and `tone/` are the **canonical frozen bytes** of the
Cadence kit: the encoder mixes them into program WAVs and the v1 decoder
cross-correlates against them as templates. **Never regenerate them as part of
a build** — byte drift would break the deterministic encode→decode round-trip
and orphan every previously rendered program file.

They were produced once from the raw downloads in `raw/` by:

```
cd packages/kit
node tools/process.mjs
```

which, per file (all raw sources are 44.1 kHz / 24-bit / stereo WAV):

1. downmixes to mono (channel average),
2. trims leading silence below −60 dBFS, keeping 32 samples of pre-attack,
3. trims trailing silence and caps the decay (per-file cap in `process.mjs`),
4. peak-normalizes to −6 dBFS,
5. applies a 30 ms raised-cosine fade at the cap,
6. writes 44.1 kHz / 16-bit / mono PCM WAV.

The script is dependency-free and deterministic (no randomness, no
system-dependent resampling), so re-running it on the same `raw/` bytes
reproduces the same outputs — but the committed bytes remain the source of
truth, not the script.

To swap the kit (e.g. an 808 variant): put new raw files in `raw/`, adjust
`RECIPE`, run once, listen, update `manifest.json`/`ATTRIBUTIONS.md`, commit.
Then re-render any `.wav` programs you care about, since old renders will no
longer template-match perfectly.
