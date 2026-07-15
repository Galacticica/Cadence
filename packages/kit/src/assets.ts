/**
 * Vite asset entry: symbol → bundled asset URL. The web app fetches these
 * URLs and decodes the SAME frozen bytes the encoder/decoder use.
 */
import kickUrl from "../samples/kick.wav?url";
import snareUrl from "../samples/snare.wav?url";
import hatUrl from "../samples/hat-closed.wav?url";
import tomHiUrl from "../samples/tom-hi.wav?url";
import tomMidUrl from "../samples/tom-mid.wav?url";
import tomLowUrl from "../samples/tom-low.wav?url";
import tomFloorUrl from "../samples/tom-floor.wav?url";
import crashUrl from "../samples/crash.wav?url";
import rideUrl from "../samples/ride.wav?url";
import stickUrl from "../samples/stick.wav?url";
import marimbaUrl from "../tone/marimba-c4.wav?url";
import type { KitSymbol } from "./manifest.js";

export const SAMPLE_URLS: Record<KitSymbol, string> = {
  K: kickUrl,
  S: snareUrl,
  H: hatUrl,
  T1: tomHiUrl,
  T2: tomMidUrl,
  T3: tomLowUrl,
  FT: tomFloorUrl,
  C: crashUrl,
  R: rideUrl,
  CLICK: stickUrl,
};

export const TONE_URL: string = marimbaUrl;

export { KIT_SYMBOLS, manifest, type KitSymbol } from "./manifest.js";
