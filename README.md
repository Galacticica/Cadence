# Cadence 🥁

**An esoteric programming language where the source code is a drum performance.**

There is no text format. A Cadence program is a `.wav` file of drums being played.
The interpreter *listens* to your code: it locks onto the count-in, detects every
hit, snaps them to a grid, and executes the beat, one measure per instruction.

```
beat.wav → count-in lock → onset detection → classification → grid snap → measures → VM
```

Piet made source code out of paintings, and Whitespace threw away everything
but the spaces. Cadence puts the program on a drum kit.

## How it works

Every measure of 4/4 (16 sixteenth-note steps) is one instruction, split into
three fields:

```
Step:      1   2   3   4 | 5   6   7   8 | 9  10  11  12  13  14  15  16
           [── opcode ──] [── registers─] [───── operand (8-bit) ──────]
```

- The **opcode** is the *sequence of drums* you hit in the first four steps.
  Kick opens data instructions, snare arithmetic, ride I/O, crash structure and
  tests. Follow-up hits pick the variant: snare then snare is `SUB`, snare then
  kick is `MUL`, crash then snare is a conditional. Exactly *where* the
  follow-ups land is up to the performer; the decoder only cares which drums,
  in what order.
- **Registers** are tom hits. One tom reaches R1-R4; a pair led by the floor
  tom reaches R5-R8, so the high registers literally take a mini tom fill.
- The **operand** is an 8-bit number played as a rhythm: **snare = 1, closed
  hi-hat = 0**. The binary of 72 is a drum lick.

A few things fall out of this design that we're quite pleased about:

- **Loops are repeat signs.** `REPEAT_START` … `REPEAT_END` work exactly like
  the double bar with dots in sheet music; `REPEAT_WHILE R1` re-reads a register
  every time around. The instruction set has no jumps at all.
- **Conditionals are skips.** `SKIPZ R1` blinds the machine for one measure.
  If you need a multi-bar branch, a repeat block that plays once
  (`REPEAT_START 1`) acts as the curly brace: skipping its opener skips the
  whole block.
- **Comments are groove.** Closed hi-hat outside the operand field is ignored,
  and a bar with no opcode on the downbeat is pure decoration. Programs can
  *breathe*, and they can sound like actual beats.
- **Ghost notes.** Any drum, on any step, played quietly (about 9 dB down) is
  pure decoration, even inside live fields. The decoder separates the language
  from the groove by loudness, so your program can have a soft snare drag
  right through its own operand bits and still mean exactly the same thing.
- **Tempo is the clock speed.** It never changes what a program means, only how
  fast it runs. Turn it down to ♩=40 and you're single-stepping by ear, which
  makes slow tempo Cadence's native debugger.
- **Input is drummed** (or typed, since the kit is optional). `IN` pauses the
  machine; you play a number in binary (snare = 1, hat = 0) and a crash submits
  it. The web IDE also takes typed input and the CLI reads stdin, so drumming
  your input in is the live-performance option rather than a requirement.

## Show me a program

Countdown, which prints `5 4 3 2 1`:

| Bar | Instruction | Drums |
|---|---|---|
| 1 | `LOADI R1, 5` | kick · high tom · `00000101` on snare/hat |
| 2 | `LOADI R2, 1` | kick · mid tom · `00000001` |
| 3 | `REPEAT_WHILE R1` | crash, kick · high tom |
| 4 | `OUTN R1` | ride · high tom |
| 5 | `SUB R1, R2` | snare, snare · high tom, mid tom |
| 6 | `REPEAT_END` | crash, crash |
| 7 | `HALT` | crash into the ride |

`Hello, World!` is 27 measures: a 54-second drum solo whose output is a
greeting. This is the correct amount of ridiculous.

Cadence is Turing-complete. Registers have arbitrary precision, so two of them
plus `REPEAT_WHILE` and the skips make a Minsky counter machine.

## See it / hear it

- **[SPEC.md](SPEC.md)** is the full language specification: alphabet, all 21
  opcodes, control-flow rules, worked examples for every instruction, the audio
  format, and the decoding pipeline.
- **The sequencer IDE** lets you compose on the grid and run with live console
  output. Save renders a real `.wav` with count-in, and Open decodes one back.
  Shift-click paints ghost notes (quiet decoration hits that never affect the
  program), and `IN` pauses the machine so you can drum your input in binary,
  where snare = 1, hat = 0, and a crash submits:

  ```
  npm install
  npm run dev        # → http://localhost:5173
  ```

- **The CLI** runs the language independent of its IDE:

  ```
  npm run build -w @cadence/cli
  node apps/cli/dist/cadence.js run examples/countdown.wav      # → 5 4 3 2 1
  node apps/cli/dist/cadence.js check examples/countdown.wav
  echo 0 | node apps/cli/dist/cadence.js run examples/truth-machine.wav
  ```

- **[diagram.html](diagram.html)** is the original interactive explainer, with
  a playable sequencer grid and every opcode demonstrated in a runnable
  mini-program. (Historical: it still uses the old synthesized drums; the real
  app plays the sampled kit below.)

## Status

**Milestones v1 + v2 are implemented.** The loop closes, and the CLI exists:

```
packages/core/     types, parser, VM (BigInt registers), wav encoder + decoder
packages/kit/      the canonical sample kit: real acoustic drums (SM Drums,
                   public domain) + a VCSL marimba for TONE; frozen bytes shared
                   by the IDE, the encoder, and the decoder's template matching
apps/web/          Vite sequencer IDE (the editor is a drum machine, not a text editor)
apps/cli/          cadence run beat.wav · cadence check beat.wav
apps/vscode-ext/   (next) opening a Cadence .wav shows the sequencer
```

Every sound is a recorded sample; nothing is synthesized. `examples/` holds
golden renders, and `npm test` runs 117 tests: the byte-deterministic
encode/decode/encode round-trip at multiple tempos, the template-separability
confusion matrix, all SPEC §6 programs on the VM, and the ghost-note
guarantee, meaning a program saved with decoration reloads as the same program
with the same output. `packages/core/README.md` documents the full API.

Remaining roadmap: the VS Code extension, live e-kit recording over Web MIDI,
and eventually decoding clean acoustic recordings (SPEC §8 v2/v3 classifiers).

## FAQ

**Why?**
Because a program you can perform on a drum kit is a program worth writing.

**Can a drummer actually play a valid program live?**
That's the design constraint the whole language is built around: one hit per
grid step, the opcode instruments (kick/snare/ride/crash) are the four most
acoustically distinct voices on a kit, and follow-up hit positions are free so
instructions can sit in the pocket. Live MIDI input is on the roadmap;
mic'd acoustic kits are the stretch goal.

**Is the audio really the source?**
Yes. The wav is canonical; the sequencer is just an editor. The decoder derives
tempo and grid phase from four count-in clicks at the top of the file, like a
modem handshake, except it's a drummer counting off.
