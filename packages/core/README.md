# @cadence/core

The Cadence language: parser, VM, and the WAV encoder/decoder that make the
audio file the canonical source. Zero runtime dependencies — the same code
runs in Node, the browser, and tests, byte-identically.

The **`Grid` is the universal intermediate representation**:

```
        edit                assemble
editor ──────► Grid ◄────────────────── Instruction[]
                │ ▲
        encode  │ │  decode
                ▼ │
           program .wav          Grid ──parse──► Program ──run──► VMEvents
```

## Data model (`types.ts`)

- `DrumSymbol` — `K S H T1 T2 T3 FT C R` (SPEC §1)
- `Step = DrumSymbol[]` — one sixteenth-note step, polyphonic
- `MeasureGrid { steps: Step[16]; ghosts?: Step[16] }` — one bar; `ghosts` is
  the decoration layer (quieter, never semantic), present only when non-empty
- `Grid = MeasureGrid[]`
- `Instruction { opcode, rd?, rs?, imm? }` — `rd` is the dest-subfield
  register (single-register ops keep theirs here), `rs` the source, `imm` the
  8-bit operand
- `Line` — `code | groove | invalid`, index-aligned with the Grid
- `Program { lines, errors }` · `ParseError { bar, message }` ·
  `formatError(e)` → `"bar 7: unknown opcode K→C"`

## Language

- `parse(grid): Program` — decode fields per SPEC §2–5; errors carry 1-based
  bar numbers; repeat blocks structurally matched
- `check(grid): ParseError[]` — parse and report only errors
- `assemble(instrs): Grid` / `assembleMeasure(instr): MeasureGrid` — inverse
  with canonical placement; contract: `parse(assemble(x))` round-trips
- `grooveMeasure(): MeasureGrid` — a steady-hat decoration bar
- Lookup tables: `OPCODES`, `OPCODE_INFO`, `opcodeForSequence(seq)`,
  `registerForFill(fill)`, `REG_TO_FILL`

## VM (`vm.ts`)

- `run(program, opts?): Generator<VMEvent, void, bigint | undefined>` —
  8 arbitrary-precision BigInt registers, one stack, structured control flow.
  Yields `outN | outC | tone | input | halt` (+ `bar` when
  `opts.barEvents`). `IN` yields an `input` event; resume with
  `gen.next(value)` (no value → 0). `opts.maxBars` stops silently — infinite
  loops are legal Cadence.
- `runToCompletion(program, inputs?, opts?)` — collect all events, feeding a
  queue of inputs
- `renderOutput(events)` — console text (`outN` + trailing space, `outC` as
  characters)
- `RuntimeError` — division by zero, pop from empty stack; carries `bar`

## Audio (`wav.ts`, `encode.ts`, `decode.ts`)

- `encodeWav(samples, sampleRate?)` / `decodeWav(bytes)` — mono 16-bit PCM
  writer; reader handles PCM 8/16/24/32 + float32, any channel count
  (averaged down), extra chunks tolerated
- `encode(grid, kit, {bpm})` — canonical render: one-bar count-in (4 clicks),
  real hits at `MIX_GAIN` (0.8), **ghost notes at `GHOST_GAIN` (0.35)**;
  byte-deterministic for identical inputs
- `decode(bytes, kit): { grid, bpm }` — count-in matched filter → tempo/phase
  lock → per-step orthogonal matched pursuit against the kit templates (joint
  amplitude refit for stacked hits) → real vs. ghost classified by fitted
  amplitude → grid snap. Throws `DecodeError` (no count-in, wrong rate, …)
- `SampleKit { sampleRate: 44100, samples: Record<DrumSymbol|"CLICK", Float32Array> }`
  — loading is host-specific; see `@cadence/kit` (Node fs loader and Vite
  asset entry). Always decode kit bytes with `decodeWav`, never a host audio
  API, so decoder templates stay byte-identical everywhere.
- Constants: `CANONICAL_SAMPLE_RATE` (44100), `DEFAULT_BPM` (120),
  `stepSeconds(bpm)`, `MIX_GAIN`, `GHOST_GAIN`

## Guarantees (tested)

- `parse(assemble(x)) === x` for all 21 opcodes, all register fills, operands
- `decode(encode(grid)) === grid` at 60–200 bpm, ghosts included
- encode→decode→encode is a byte fixpoint; golden files guard drift
- A program saved with ghost decoration reloads as the SAME program with the
  same output — decoration never leaks into semantics
