/**
 * Typed view of manifest.json — the one contract that maps drum symbols to
 * sample files. Encoder, decoder, and the web app all derive from this, so
 * they can never disagree about which file is which symbol.
 */
import manifestJson from "../manifest.json";
import type { DrumSymbol } from "@cadence/core";

/** The 9 language symbols plus the count-in click (never a program symbol). */
export type KitSymbol = DrumSymbol | "CLICK";

export const KIT_SYMBOLS: readonly KitSymbol[] = [
  "K",
  "S",
  "H",
  "T1",
  "T2",
  "T3",
  "FT",
  "C",
  "R",
  "CLICK",
];

export interface KitManifest {
  format: { codec: string; sampleRate: number; bitDepth: number; channels: number };
  kit: Record<KitSymbol, { file: string }>;
  tone: { file: string; baseMidi: number };
}

export const manifest = manifestJson as unknown as KitManifest;
