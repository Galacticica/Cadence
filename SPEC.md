# Cadence

**A programming language where the source code is a drum performance.**

There is no text format. A Cadence program is an audio file — a `.wav` of drums being
played. The sequencer UI is an *editor*, the way a text editor is an editor for C:
it is a convenience for humans, not the language itself. The interpreter's input is
sound.

> Piet: programs are paintings.
> Whitespace: only whitespace matters.
> **Cadence: programs are drum performances.**

Design stance: drums are an **instruction alphabet**, not musical expression. Tempo,
velocity, and feel carry no semantics — a program played at 60 BPM and 240 BPM is the
same program. What matters is *which drum* is hit on *which grid step*.

---

## 1. The alphabet

Cadence recognizes 9 drum symbols plus rest:

| Symbol | Instrument | Role |
|---|---|---|
| `K` | Kick | Opcode family: **data movement** |
| `S` | Snare | Opcode family: **arithmetic** · binary digit **1** in operands |
| `H` | Closed hi-hat | Binary digit **0** in operands · **decoration** elsewhere |
| `T1` | High tom | Register selector |
| `T2` | Mid tom | Register selector |
| `T3` | Low tom | Register selector |
| `FT` | Floor tom | Register selector |
| `C` | Crash | Opcode family: **structure/control/tests** · input-submit at runtime |
| `R` | Ride | Opcode family: **I/O** |
| `.` | Rest | Silence (binary **0** in operands; padding elsewhere) |

The **open hi-hat is not part of the language** — any open-hat sound is ignored
everywhere (treated as decoration). It's reserved should a future revision want it.

A stick click (count-in) is an eleventh sound but never appears inside a program —
see §8.

---

## 2. Grid and measures

- Fixed **4/4 time**, every measure is **16 sixteenth-note steps**.
- **One instruction per measure.** A measure is a line of code.
- Tempo never affects **meaning** — a program at 60 BPM and 240 BPM is the same
  program. What tempo controls is the **execution clock**: the interpreter runs
  one measure per bar at the current tempo, so the tempo dial is the VM's speed
  knob. Default ♩ = 120. Drop it to 40 and you're single-stepping by ear —
  Cadence's native debugger; crank it for fast runs. (Batch mode — the CLI —
  may execute at unlimited speed with audio off.)
- Program execution proceeds measure by measure, top to bottom, except where
  structure instructions (repeats, skips) redirect it.

### Measure anatomy

Each code measure has three positional fields:

```
Step:      1   2   3   4 | 5   6   7   8 | 9  10  11  12  13  14  15  16
           [── opcode ──] [── registers─] [───── operand (8-bit) ──────]
```

| Field | Steps | Contents |
|---|---|---|
| **Opcode** | 1–4 | A **sequence of 1–4 opcode-instrument hits** (`K S R C`). The instrument at step 1 picks the family; the *ordered sequence* of follow-up hits picks the variant. Where exactly the follow-up hits land within steps 2–4 is free — only which drums, in what order, matters. |
| **Registers** | 5–8 | Steps 5–6: destination/primary register. Steps 7–8: source register (two-operand ops only). Tom hits only. |
| **Operand** | 9–16 | 8-bit immediate, MSB first. `S`=1, `H`=0, rest=0. |

### Code measure vs. groove measure

A measure is **code** if and only if step 1 contains exactly one of
`K S R C` (the four opcode instruments).

If step 1 is empty, a rest, a hat, or a tom — the **entire measure is decoration**:
a free groove bar, semantically a NOP. This is the escape hatch that lets programs
contain pure musical breathing room.

### Decoration ("comments are groove")

Inside a *code* measure, closed hi-hat hits on **steps 1–8 are ignored**. You can
ride steady sixteenth hats under the opcode and register fields and the parser will
not care. On steps 9–16 the closed hat is a live symbol (binary 0) — except in
instructions whose operand field is unused (all register–register ops), where steps
9–16 are ignored entirely and may carry free decoration.

Any other unexpected hit — a tom in the opcode field, a crash in the operand field,
an opcode-field sequence that matches no defined instruction — is a **syntax error**,
reported with its bar number (`bar 12: tom in opcode field`, `bar 7: unknown opcode
K→C`).

---

## 3. Machine model

- **8 registers**, `R1`–`R8`, each holding an **arbitrary-precision signed integer**.
  (Arbitrary precision is not a flourish — it is what makes Cadence Turing-complete;
  see §9.)
- **One stack** of arbitrary-precision integers, unbounded depth, via `PUSH`/`POP`.
- No flags register. Conditionals compare registers directly.
- All registers start at 0; the stack starts empty.

### Register addressing: the tom fill

A register reference is one or two tom hits read left-to-right within its 2-step
subfield (dest = steps 5–6, source = steps 7–8):

| Hits | Register |
|---|---|
| `T1` | R1 |
| `T2` | R2 |
| `T3` | R3 |
| `FT` | R4 |
| `FT T1` | R5 |
| `FT T2` | R6 |
| `FT T3` | R7 |
| `FT FT` | R8 |

A single hit is placed on the first step of its subfield. High registers literally
require a mini tom fill to reach. Single-register instructions use only the dest
subfield (steps 5–6); steps 7–8 must be empty (hats allowed as decoration).

---

## 4. Literals

The operand field (steps 9–16) encodes one unsigned 8-bit integer, **MSB first**:

- **Snare = 1**
- **Closed hat = 0** (an *audible* zero, for performability)
- **Rest = 0** (a silent zero — equivalent)

Example: `72` = `01001000` = snare on steps 10 and 13.

Values above 255 (and negatives) are built with arithmetic — `LOADI` small pieces
and combine with `MUL`/`ADD`/`SUB`, exactly like early assembly programmers did.
Only *literals* are 8-bit; registers are unbounded (§3). 70,000 in six bars:

```
bar 1: LOADI R1, 250    ; the biggest chunk one bar can say
bar 2: LOADI R2, 4
bar 3: MUL   R1, R2     ; R1 = 1,000 — already past 8 bits
bar 4: LOADI R2, 70
bar 5: MUL   R1, R2     ; R1 = 70,000
bar 6: OUTN  R1
```

---

## 5. The instruction set

An opcode is an **instrument sequence**: the ordered list of `K S R C` hits in the
opcode field. The first drum (step 1) picks the family; the rest of the sequence
picks the variant. Positions within steps 2–4 are the performer's choice — `K S`
means "kick, then snare, somewhere in the first four steps," whether the snare
falls on step 2, 3, or 4. Sequences read left to right; one hit per step.

21 opcodes are defined. Undefined sequences (`K C`, `R C`, longer runs) are
reserved for future revisions and are syntax errors today.

### Kick — data movement
| Sequence | Mnemonic | Effect |
|---|---|---|
| `K` | `LOADI rd, imm8` | rd ← imm8 |
| `K K` | `PUSH rs` | push rs onto stack |
| `K S` | `MOV rd, rs` | rd ← rs |
| `K R` | `POP rd` | rd ← pop stack (empty stack: runtime error) |

### Snare — arithmetic
| Sequence | Mnemonic | Effect |
|---|---|---|
| `S` | `ADD rd, rs` | rd ← rd + rs |
| `S S` | `SUB rd, rs` | rd ← rd − rs |
| `S K` | `MUL rd, rs` | rd ← rd × rs |
| `S R` | `DIV rd, rs` | rd ← rd ÷ rs (integer, truncate toward zero; ÷0: runtime error) |
| `S C` | `MOD rd, rs` | rd ← rd mod rs (÷0: runtime error) |

### Ride — I/O
| Sequence | Mnemonic | Effect |
|---|---|---|
| `R` | `OUTN rs` | print rs as a decimal number |
| `R R` | `OUTC rs` | print rs as a character (Unicode code point) |
| `R K` | `IN rd` | pause; user **taps a number in binary** — snare=1, hat=0, MSB first — and a **crash submits** it into rd (see §7) |
| `R S` | `TONE rs` | emit a tone: rs interpreted as a MIDI note number |

### Crash — structure & tests
| Sequence | Mnemonic | Effect |
|---|---|---|
| `C` | `REPEAT_START imm8` | open a block, play it imm8 times (0 = skip block) |
| `C C` | `REPEAT_END` | close the innermost open block |
| `C K` | `REPEAT_WHILE rs` | open a block, replay while rs ≠ 0 (checked at each iteration start) |
| `C R` | `HALT` | stop execution |
| `C S` | `SKIPZ rs` | skip next measure if rs = 0 |
| `C S S` | `SKIPNZ rs` | skip next measure if rs ≠ 0 |
| `C S K` | `SKIPLT rd, rs` | skip next measure if rd < rs |
| `C S R` | `SKIPGE rd, rs` | skip next measure if rd ≥ rs |

**Crash + snare = a test.** All four conditionals open with that pair; the third
hit picks the comparison.

Repeat blocks are Cadence's repeat signs — structured, properly nested, no raw
jumps. Falling off the last measure without `HALT` also ends the program.

### Control-flow rules (precise)

1. `REPEAT_END` pairs with the nearest unmatched opener (`REPEAT_START` or
   `REPEAT_WHILE`). Blocks nest. An unmatched opener or end is a syntax error.
2. Reaching `REPEAT_END` jumps back to its opener, which re-decides:
   `REPEAT_START n` counts down its remaining plays; `REPEAT_WHILE rs` re-reads
   the register. When the opener declines, execution continues at the measure
   after the `END`.
3. A skip instruction skips the **next code measure**. Groove measures are
   transparent to control flow — a comment can't be a branch target.
4. If the measure being skipped is an opener, the **entire block** through its
   matching `REPEAT_END` is skipped.
5. `REPEAT_START 1` is Cadence's curly braces: a block that plays exactly once,
   existing so a skip can jump over several measures as a unit (§6.6).

---

## 6. Programming Cadence — the opcodes in action

Examples are written one bar per line: `bar N: MNEMONIC operands  ; comment`.
The mnemonics are a spec-writing convenience only — no text format exists; every
line below *is* a measure of drums. Immediates live in the operand field
(steps 9–16), register picks in the tom field (steps 5–8).

### 6.1 Two measures under the microscope

`LOADI R1, 72` — kick downbeat, high tom, and the binary rhythm of 72:

```
Step:        1  2  3  4 | 5  6  7  8 | 9 10 11 12 13 14 15 16
Crash        .  .  .  . | .  .  .  . | .  .  .  .  .  .  .  .
Ride         .  .  .  . | .  .  .  . | .  .  .  .  .  .  .  .
Tom 1        .  .  .  . | X  .  .  . | .  .  .  .  .  .  .  .
Tom 2        .  .  .  . | .  .  .  . | .  .  .  .  .  .  .  .
Tom 3        .  .  .  . | .  .  .  . | .  .  .  .  .  .  .  .
Floor Tom    .  .  .  . | .  .  .  . | .  .  .  .  .  .  .  .
Snare        .  .  .  . | .  .  .  . | .  X  .  .  X  .  .  .
Closed Hat   .  .  .  . | .  .  .  . | X  .  X  X  .  X  X  X
Kick         X  .  .  . | .  .  .  . | .  .  .  .  .  .  .  .
                          ↑ R1         0  1  0  0  1  0  0  0  = 72
```

`SUB R1, R2` — two snares open the bar, then a two-tom register phrase:

```
Step:        1  2  3  4 | 5  6  7  8 | 9 10 11 12 13 14 15 16
Snare        X  X  .  . | .  .  .  . | .  .  .  .  .  .  .  .
Tom 1        .  .  .  . | X  .  .  . | .  .  .  .  .  .  .  .
Tom 2        .  .  .  . | .  .  X  . | .  .  .  .  .  .  .  .
             (S S = SUB)  (rd=R1)(rs=R2)   (operand unused)
```

### 6.2 Data: load, copy, swap

```
bar 1: LOADI R1, 10     ; K     — R1 ← 10
bar 2: MOV   R2, R1     ; K S   — R2 ← 10 (R1 keeps its value)
```

The stack turns two pushes and two pops into a swap:

```
bar 1: PUSH R1          ; K K   — stack: [R1]
bar 2: PUSH R2          ; K K   — stack: [R1, R2]  (R2 on top)
bar 3: POP  R1          ; K R   — R1 ← old R2  (pop takes the top)
bar 4: POP  R2          ; K R   — R2 ← old R1  — swapped
```

### 6.3 Arithmetic: chaining through a scratch register

Arithmetic ops read both registers and write the first, so you compute by
reusing a scratch register. `(3 + 4) × 5`:

```
bar 1: LOADI R1, 3
bar 2: LOADI R2, 4
bar 3: ADD   R1, R2     ; S     — R1 = 7
bar 4: LOADI R2, 5      ;         reuse R2
bar 5: MUL   R1, R2     ; S K   — R1 = 35
bar 6: OUTN  R1         ;         prints 35
```

`DIV` and `MOD` split a number apart — the tens and ones of 42:

```
bar 1: LOADI R1, 42
bar 2: MOV   R3, R1     ;         keep a copy
bar 3: LOADI R2, 10
bar 4: DIV   R1, R2     ; S R   — R1 = 4  (tens)
bar 5: MOD   R3, R2     ; S C   — R3 = 2  (ones)
```

### 6.4 I/O: one value, three lenses

```
bar 1: LOADI R1, 65
bar 2: OUTN  R1         ; R     — prints "65"
bar 3: OUTC  R1         ; R R   — prints "A"   (same value as a character)
bar 4: TONE  R1         ; R S   — plays MIDI note 65 (the F above middle C)
```

Echo — the shortest interactive program:

```
bar 1: IN   R1          ; R K   — machine pauses; you drum a number in binary
                        ;         (snare=1, hat=0), a crash submits it
bar 2: OUTN R1          ;         plays it back
```

### 6.5 Loops are repeat signs

**Fixed count.** `REPEAT_START n` plays its block n times — a `for` loop whose
count sits in the operand field:

```
bar 1: LOADI R1, 33          ; '!'
bar 2: REPEAT_START 5        ; C     — open block, 5 plays
bar 3:   OUTC R1
bar 4: REPEAT_END            ; C C   — output: !!!!!
```

A count of 0 skips the block — playing something zero times.

**Condition.** `REPEAT_WHILE rs` re-reads the register at the top of every
pass. Here is the countdown core actually executing, with R1 starting at 3
(R2 holds 1):

```
bar 3: REPEAT_WHILE R1   ; R1=3, nonzero → enter
bar 4:   OUTN R1         ;   prints 3
bar 5:   SUB  R1, R2     ;   R1 = 2
bar 6: REPEAT_END        ; jump back to bar 3
bar 3: REPEAT_WHILE R1   ; R1=2 → enter … prints 2 … then 1 …
bar 3: REPEAT_WHILE R1   ; R1=0 → jump PAST bar 6
bar 7: HALT
```

The body must change the register, or you've written a beat that loops forever —
sometimes that's the point (see the truth machine below).

**Nesting.** A 3×3 square of stars:

```
bar 1: LOADI R1, 42          ; '*'
bar 2: LOADI R2, 10          ; newline
bar 3: REPEAT_START 3        ; rows
bar 4:   REPEAT_START 3      ;   columns
bar 5:     OUTC R1
bar 6:   REPEAT_END
bar 7:   OUTC R2             ;   end the row
bar 8: REPEAT_END
```

### 6.6 Conditionals: the art of the skip

There is no `if` instruction — there are four skips. A skip blinds the machine
for exactly one code measure:

```
bar 7: SKIPZ R1     ; C S   — is R1 zero? then…
bar 8: OUTN  R1     ;         …this bar never happens
bar 9: …            ; execution resumes here either way
```

**If/else with one-bar branches** — an even/odd detector:

```
bar 1: IN     R1         ;         read a number
bar 2: LOADI  R2, 2
bar 3: MOD    R1, R2     ; S C   — R1 = 0 if even, 1 if odd
bar 4: SKIPNZ R1         ; C S S — odd? skip the "even" load
bar 5: LOADI  R3, 69     ;         'E'
bar 6: SKIPZ  R1         ; C S   — even? skip the "odd" load
bar 7: LOADI  R3, 79     ;         'O'
bar 8: OUTC   R3         ;         exactly one branch ran
```

**Comparisons** work the same way with two registers. `max` in two bars:

```
bar 1: SKIPGE R1, R2     ; C S R — already R1 ≥ R2? skip the fix
bar 2: MOV    R1, R2     ;         R1 = max(R1, R2)
```

(`SKIPLT`/`SKIPGE` cover `<` and `≥` directly; get `>` and `≤` by swapping the
operands.)

**Multi-measure branches.** When a branch needs several bars, wrap it in
`REPEAT_START 1` — the block plays once and, by control-flow rule 4, a skip
jumps the *whole block*:

```
bar  1: SKIPZ R1          ; R1 = 0 → skip the entire then-block
bar  2: REPEAT_START 1    ; {
bar  3:   OUTN R1
bar  4:   TONE R1
bar  5: REPEAT_END        ; }
bar  6: SKIPNZ R1         ; R1 ≠ 0 → skip the entire else-block
bar  7: REPEAT_START 1    ; {
bar  8:   LOADI R2, 63    ;   '?'
bar  9:   OUTC  R2
bar 10: REPEAT_END        ; }
```

**Gotcha:** the else-test at bar 6 reads R1 *after* the then-block ran. If a
branch modifies its own condition register, `MOV` it to a scratch register
first and test that.

### 6.7 Full programs

**Countdown (prints 5 4 3 2 1)**

| Bar | Instruction | Hits |
|---|---|---|
| 1 | `LOADI R1, 5` | K@1 · T1@5 · operand `00000101` (S@14, S@16) |
| 2 | `LOADI R2, 1` | K@1 · T2@5 · operand `00000001` (S@16) |
| 3 | `REPEAT_WHILE R1` | C@1 K@3 · T1@5 |
| 4 | `OUTN R1` | R@1 · T1@5 |
| 5 | `SUB R1, R2` | S@1 S@2 · T1@5 · T2@7 |
| 6 | `REPEAT_END` | C@1 C@2 |
| 7 | `HALT` | C@1 R@4 |

**Truth machine**

Input 0 → print `0` once and halt. Input 1 → print `1` forever.

| Bar | Instruction | Hits |
|---|---|---|
| 1 | `IN R1` | R@1 K@3 · T1@5 |
| 2 | `REPEAT_WHILE R1` | C@1 K@3 · T1@5 |
| 3 | `OUTN R1` | R@1 · T1@5 |
| 4 | `REPEAT_END` | C@1 C@2 |
| 5 | `OUTN R1` | R@1 · T1@5 |
| 6 | `HALT` | C@1 R@4 |

If the input is 1, bars 2–4 loop forever printing `1`. If it is 0, the while block
never runs and bar 5 prints `0`. Six measures.

**Hello World**

`Hello, World!` is 13 characters × (`LOADI` + `OUTC`) + `HALT` = **27 measures**.
At 120 BPM that is a 54-second drum solo whose output is `Hello, World!`. Reusing
registers for repeated letters (`l`, `o`) gets it under 50 seconds. This is the
correct amount of ridiculous.

---

## 7. Input protocol

When `IN rd` executes, the machine pauses and listens. The user enters a number
**by drumming it**: snare = 1, closed hat = 0, MSB first, any number of bits;
a **crash submits** the value into `rd`. (A crash with no bits before it
submits 0.)

**Typed input is first-class.** Not everyone has a kit: the web IDE offers a
text field alongside the drum-input mode, and the CLI reads numbers from stdin.
Drummed input is the live-performance path, never a requirement — on a MIDI kit
you literally play your input; at a keyboard you type it. Both feed the same
`IN` instruction identically.

---

## 8. Audio format — the canonical source

- **Container:** WAV, 44.1 kHz, 16-bit PCM. This file *is* the program.
- **Rendering:** the toolchain renders programs from a fixed built-in sample kit
  (one canonical sample per symbol), at the project tempo, one hit per grid step.
- **Count-in handshake:** every rendered program begins with **four stick clicks
  on quarter notes** — one bar of count-in. The decoder derives tempo from the
  inter-click intervals and grid phase from the last click; the program's first
  measure starts on the next downbeat. Like a modem handshake, except it's a
  drummer counting off. Programs without a detectable count-in are rejected.

### Decoding pipeline

```
.wav → count-in detect → tempo + phase lock → onset detection (spectral flux)
     → per-onset classification → snap to 16th grid → measures → instructions → VM
```

Classification, in order of ambition:

1. **v1 — own files:** template matching (cross-correlation) against the exact
   built-in kit samples. Deterministic round-trip: anything the editor saved,
   the decoder reads back perfectly.
2. **v2 — clean e-kit / sample-based recordings:** band-energy and spectral-centroid
   heuristics (kick = low-band burst, snare = broadband + body, hats = high-band,
   toms by pitch band, cymbals by decay length), then quantize onsets to the grid.
3. **v3 — mic'd acoustic kit:** small trained classifier. Stretch goal.

Quantization tolerance: an onset within ±25% of a step's duration snaps to that
step; two same-instrument onsets snapping to one step is an error (flam), except
on closed hat where it's decoration anyway.

---

## 9. Turing-completeness sketch

Cadence has: arbitrary-precision registers (§3), `ADD`/`SUB`, zero tests
(`SKIPZ`/`SKIPNZ`), and while-loops (`REPEAT_WHILE`). Two registers used as
counters give increment, decrement, and test-for-zero — a two-counter Minsky
machine, which is Turing-complete. Structured control flow suffices by the
structured program theorem (sequence + selection + iteration). The stack is a
convenience, not load-bearing for the proof.

The bound that matters is register *width*: with fixed 32-bit registers the
machine would be finite-state. Arbitrary precision is therefore part of the
language definition, not an implementation detail.

---

## 10. Architecture & roadmap

TypeScript monorepo, one shared core:

```
cadence/
  packages/core/     types, measure parser, VM, wav encoder (sample kit), wav decoder
  apps/web/          Vite sequencer IDE — Web Audio playback, console pane, run/step,
                     tempo dial (execution speed / debug-by-ear)
  apps/cli/          `cadence run beat.wav`, `cadence check beat.wav`
  apps/vscode-ext/   custom editor: opening a Cadence .wav shows the sequencer webview
```

**Milestones**

1. **v1 — the loop closes:** web sequencer ⇄ VM ⇄ wav. Compose on the grid, run
   with live console output, *Save* renders a real audio file with count-in,
   *Open* decodes it back to the identical grid. Hello World demo-able end to end.
2. CLI (`cadence run`), making the language exist independent of its IDE.
3. VSCode extension (webview reuses the web sequencer).
4. Live recording: Web MIDI e-kit input → quantize to grid → measures.
5. Arbitrary clean-recording decode (heuristic classifier).

---

## 11. Open questions (deliberately deferred)

- **Rhythm as addressing mode** — the front-runner for v2. Opcode-field positions
  are currently free (performance freedom), but rhythm and instrument sequence are
  independent dimensions, so rhythm could carry meaning without disturbing the
  existing ISA. Leading proposal: last opcode hit on the "and" (step 3) = register
  form; syncopated (step 2 or 4) = immediate form, giving `ADDI/SUBI/MULI/SKIPLTI…`
  rd, imm8 for free. "Straight = registers, syncopated = immediate." Would shrink
  the countdown from 7 bars to 5. Deferred, not rejected.
- **Accent chords:** a crash struck *simultaneously* with an opcode hit as a
  modifier bit (e.g. "wide" variants). The one meaningful-chord idea worth keeping
  on the shelf.
- **1st/2nd endings** as if/else syntax sugar over skip instructions.
- **`CALL`/`RET`** — subroutines as named fills; the stack already supports it.
  The reserved sequences (`K C`, `R C`, longer runs) are the natural home.
- Negative/wide literals (sign convention, or a `LOADI-high-byte` variant).
- A `.cad` extension: still a real WAV, but with a metadata chunk caching the
  decoded program for fast loads. Audio stays canonical; the chunk is a hint.
- Velocity semantics: rejected for v1, revisit never (probably).
