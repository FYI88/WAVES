import { cx, type Cx } from "../physics";

/**
 * Complex relative permittivity of liquid water, double-Debye model used by
 * ITU-R P.840 (clouds and fog). Returned in the project convention
 * η = ε′ − jε″.
 */
export function waterPermittivity(fGHz: number, tempC = 20): Cx {
  const f = Math.max(1e-6, fGHz);
  const theta = 300 / (tempC + 273.15);
  const e0 = 77.66 + 103.3 * (theta - 1);
  const e1 = 0.0671 * e0;
  const e2 = 3.52;
  const fp = 20.2 - 146 * (theta - 1) + 316 * (theta - 1) ** 2;
  const fs = 39.8 * fp;
  const rp = 1 + (f / fp) ** 2;
  const rs = 1 + (f / fs) ** 2;
  const epsRe = (e0 - e1) / rp + (e1 - e2) / rs + e2;
  const epsIm = (f * (e0 - e1)) / (fp * rp) + (f * (e1 - e2)) / (fs * rs);
  return cx(epsRe, -epsIm);
}
