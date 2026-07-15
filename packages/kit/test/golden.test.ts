/**
 * Golden-file guard: examples/countdown.wav is a committed reference render.
 * If the kit samples or encoder ever drift, this test fails — protecting
 * every .wav program anyone has saved.
 *
 * (Self-seeding: the file is created on first run, then must stay identical.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assemble, decode, encode, type Instruction } from "@cadence/core";
import { loadKit } from "@cadence/kit";
import { COUNTDOWN, TRUTH_MACHINE } from "../../core/test/fixtures.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const GOLDENS: Record<string, Instruction[]> = {
  "countdown.wav": COUNTDOWN,
  "truth-machine.wav": TRUTH_MACHINE,
};

describe("golden renders", () => {
  for (const [name, instrs] of Object.entries(GOLDENS)) {
    it(`examples/${name} is byte-stable and decodes to its program`, () => {
      const goldenPath = join(repoRoot, "examples", name);
      const kit = loadKit();
      const grid = assemble(instrs);
      const fresh = encode(grid, kit, { bpm: 120 });

      if (!existsSync(goldenPath)) {
        mkdirSync(dirname(goldenPath), { recursive: true });
        writeFileSync(goldenPath, fresh);
      }
      const golden = readFileSync(goldenPath);
      expect(
        Buffer.from(fresh).equals(golden),
        "render drifted from the committed golden — kit bytes or encoder changed",
      ).toBe(true);

      const { grid: decoded, bpm } = decode(new Uint8Array(golden), kit);
      expect(decoded).toEqual(grid);
      expect(Math.round(bpm)).toBe(120);
    });
  }
});
