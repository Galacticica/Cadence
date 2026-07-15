/**
 * The Cadence CLI (SPEC milestone 2): the language existing independent of
 * its IDE.
 *
 *   cadence run beat.wav     decode → parse → execute (stdin feeds IN)
 *   cadence check beat.wav   decode → parse → report errors with bar numbers
 *
 * Batch mode runs at unlimited speed with audio off (SPEC §2).
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  decode,
  DecodeError,
  formatError,
  parse,
  run,
  RuntimeError,
  type Program,
} from "@cadence/core";
import { loadKit } from "@cadence/kit";

const USAGE = `cadence — programs are drum performances

usage:
  cadence run <program.wav>     decode and execute (stdin feeds IN)
  cadence check <program.wav>   syntax-check, report errors with bar numbers
`;

function loadProgram(path: string): { program: Program; bpm: number; bars: number } {
  const kit = loadKit();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    console.error(`cadence: cannot read ${path}`);
    process.exit(1);
  }
  try {
    const { grid, bpm } = decode(bytes, {
      sampleRate: kit.sampleRate,
      samples: kit.samples,
    });
    return { program: parse(grid), bpm, bars: grid.length };
  } catch (err) {
    if (err instanceof DecodeError) {
      console.error(`cadence: ${path}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

function check(path: string): void {
  const { program, bpm, bars } = loadProgram(path);
  for (const e of program.errors) console.error(`${path}: ${formatError(e)}`);
  if (program.errors.length > 0) process.exit(1);
  const code = program.lines.filter((l) => l.kind === "code").length;
  console.log(
    `${path}: ok — ${bars} bars (${code} code, ${bars - code} groove) at ♩=${Math.round(bpm)}`,
  );
}

async function runProgram(path: string): Promise<void> {
  const { program } = loadProgram(path);
  if (program.errors.length > 0) {
    for (const e of program.errors) console.error(`${path}: ${formatError(e)}`);
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const gen = run(program);
  try {
    let result = gen.next();
    while (!result.done) {
      const e = result.value;
      if (e.type === "outN") process.stdout.write(`${e.value} `);
      else if (e.type === "outC") process.stdout.write(String.fromCodePoint(e.codepoint));
      else if (e.type === "tone") process.stdout.write(`♪${e.midi} `);
      else if (e.type === "input") {
        const answer = await rl.question(process.stdin.isTTY ? `IN → R${e.reg}: ` : "");
        let value = 0n;
        try {
          value = BigInt(answer.trim() || "0");
        } catch {
          console.error(`cadence: not a number: ${answer.trim()} (using 0)`);
        }
        result = gen.next(value);
        continue;
      }
      result = gen.next();
    }
    process.stdout.write("\n");
  } catch (err) {
    if (err instanceof RuntimeError) {
      process.stdout.write("\n");
      console.error(`cadence: runtime error — ${err.message}`);
      process.exit(2);
    }
    throw err;
  } finally {
    rl.close();
  }
}

const [command, file] = process.argv.slice(2);
if (command === "run" && file) {
  await runProgram(file);
} else if (command === "check" && file) {
  check(file);
} else {
  console.error(USAGE);
  process.exit(command === undefined ? 0 : 1);
}
