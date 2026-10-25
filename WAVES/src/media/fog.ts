import { waterPermittivity } from "./water";

/* Fog attenuation, ITU-R P.840: γ = K_l(f, T) · M  [dB/km]
   with M the liquid water density in g/m³ and
   K_l = 0.819 f / (ε″ (1 + η²)),  η = (2 + ε′) / ε″. */

export function fogKl(fGHz: number, tempC = 15): number {
  const w = waterPermittivity(fGHz, tempC);
  const epp = -w.im;
  const eta = (2 + w.re) / epp;
  return (0.819 * fGHz) / (epp * (1 + eta * eta));
}

export const fogDbPerKm = (fGHz: number, lwc: number, tempC = 15) => fogKl(fGHz, tempC) * Math.max(0, lwc);

export const fogLossDb = (fGHz: number, lwc: number, distanceM: number, tempC = 15) =>
  (fogDbPerKm(fGHz, lwc, tempC) * Math.max(0, distanceM)) / 1000;

/** Power factor 10^(−dB/10) over a path */
export const fogFactor = (fGHz: number, lwc: number, distanceM: number, tempC = 15) =>
  Math.pow(10, -fogLossDb(fGHz, lwc, distanceM, tempC) / 10);

export type FogPreset = "none" | "medium" | "thick";

/** Liquid water content, g/m³ (P.840 examples: ~300 m and ~50 m visibility) */
export const FOG_PRESETS: Record<FogPreset, number> = { none: 0, medium: 0.05, thick: 0.5 };

export interface Fog {
  lwc: number;
  tempC: number;
  /** source → wall distance, m */
  toWallM: number;
  /** wall → receiver distance, m */
  fromWallM: number;
}

export const NO_FOG: Fog = { lwc: 0, tempC: 15, toWallM: 10, fromWallM: 10 };

/** Link-level R and T including fog on the air paths. The wall R/T are unchanged. */
export function withFog(R: number, T: number, fog: Fog, fGHz: number) {
  const inPath = fogFactor(fGHz, fog.lwc, fog.toWallM, fog.tempC);
  const outPath = fogFactor(fGHz, fog.lwc, fog.fromWallM, fog.tempC);
  return { R: R * inPath * inPath, T: T * inPath * outPath, lossDb: fogLossDb(fGHz, fog.lwc, fog.toWallM + fog.fromWallM, fog.tempC) };
}
