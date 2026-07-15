/**
 * Node loader: reads the frozen sample bytes from disk and decodes them with
 * core's own WAV reader (NOT any host audio API) so the PCM is byte-derived
 * identically everywhere. Used by the encoder, decoder, and CLI.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { join } from "node:path";
import { decodeWav, CANONICAL_SAMPLE_RATE } from "@cadence/core";
import { KIT_SYMBOLS, manifest, type KitSymbol } from "./manifest.js";

// Resolve the package's real location so the sample files are found even
// when this module is bundled into another app (e.g. the CLI's dist).
const kitDir = dirname(
  createRequire(import.meta.url).resolve("@cadence/kit/package.json"),
);

export interface LoadedKit {
  sampleRate: number;
  /** symbol → mono PCM in [-1, 1] */
  samples: Record<KitSymbol, Float32Array>;
  /** the pitched TONE instrument */
  tone: { samples: Float32Array; baseMidi: number };
}

let cached: LoadedKit | null = null;

function loadWav(relPath: string): Float32Array {
  const { samples, sampleRate } = decodeWav(readFileSync(join(kitDir, relPath)));
  if (sampleRate !== CANONICAL_SAMPLE_RATE) {
    throw new Error(`${relPath}: expected ${CANONICAL_SAMPLE_RATE} Hz, got ${sampleRate}`);
  }
  return samples;
}

/** Load (and memoize) the canonical kit. */
export function loadKit(): LoadedKit {
  if (cached) return cached;
  const samples = Object.fromEntries(
    KIT_SYMBOLS.map((sym) => [sym, loadWav(manifest.kit[sym].file)]),
  ) as Record<KitSymbol, Float32Array>;
  cached = {
    sampleRate: CANONICAL_SAMPLE_RATE,
    samples,
    tone: { samples: loadWav(manifest.tone.file), baseMidi: manifest.tone.baseMidi },
  };
  return cached;
}

export { KIT_SYMBOLS, manifest, type KitSymbol } from "./manifest.js";
