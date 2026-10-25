import { ONE, add, div, mul, scale, sqrtC, sub, type Cx } from "../physics";
import { waterPermittivity } from "./water";

/* Inclusions (bubbles) inside a wall layer, homogenised with the Maxwell
   Garnett mixing rule. Valid for small, dilute, roughly spherical inclusions:
   diameter ≪ wavelength in the host and volume fraction ≲ 0.5. */

export type InclusionKind = "air" | "water";

export interface Inclusions {
  kind: InclusionKind;
  /** volume fraction 0–1 */
  fraction: number;
  /** bubble diameter in mm */
  diameterMm: number;
  /** water temperature in °C */
  tempC: number;
}

export const NO_INCLUSIONS: Inclusions = { kind: "air", fraction: 0, diameterMm: 2, tempC: 20 };

/** ε_eff = ε_h (ε_i + 2ε_h + 2f(ε_i − ε_h)) / (ε_i + 2ε_h − f(ε_i − ε_h)) */
export function maxwellGarnett(host: Cx, inclusion: Cx, fraction: number): Cx {
  const f = Math.min(1, Math.max(0, fraction));
  if (f === 0) return host;
  if (f === 1) return inclusion;
  const delta = sub(inclusion, host);
  const base = add(inclusion, scale(host, 2));
  return mul(host, div(add(base, scale(delta, 2 * f)), sub(base, scale(delta, f))));
}

export const inclusionEta = (kind: InclusionKind, fGHz: number, tempC: number): Cx =>
  kind === "air" ? ONE : waterPermittivity(fGHz, tempC);

/** Host permittivity with its inclusions mixed in (unchanged when fraction is 0). */
export function mixedEta(host: Cx, inc: Inclusions, fGHz: number): Cx {
  if (!(inc.fraction > 0)) return host;
  return maxwellGarnett(host, inclusionEta(inc.kind, fGHz, inc.tempC), inc.fraction);
}

export type MixValidity = "ok" | "marginal" | "invalid";

/** Rates the homogenisation: size versus wavelength in the host, and dilution. */
export function inclusionValidity(host: Cx, inc: Inclusions, fGHz: number): MixValidity {
  if (!(inc.fraction > 0)) return "ok";
  const n = Math.max(1, sqrtC(host).re);
  const lambdaMm = 299.792458 / fGHz / n;
  const r = inc.diameterMm / lambdaMm;
  if (r >= 0.25) return "invalid";
  if (r >= 0.1 || inc.fraction > 0.5) return "marginal";
  return "ok";
}
