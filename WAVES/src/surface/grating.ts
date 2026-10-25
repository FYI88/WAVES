import { DEG } from "../physics";

/* Grating equation for a 1D-periodic wall in air:
   sin θm = sin θi + m·λ₀/Λ  (same for reflected and transmitted orders,
   since the wall has air on both sides). */

export const lambdaCm = (fGHz: number) => 29.9792458 / fGHz;

export interface DiffractionOrder {
  m: number;
  sin: number;
  propagating: boolean;
  /** NaN when evanescent */
  angleDeg: number;
}

export function diffractionOrders(fGHz: number, thetaDeg: number, periodCm: number, maxOrder = 10): DiffractionOrder[] {
  const ratio = lambdaCm(fGHz) / periodCm;
  const s0 = Math.sin(thetaDeg * DEG);
  const out: DiffractionOrder[] = [];
  for (let m = -maxOrder; m <= maxOrder; m++) {
    const sin = s0 + m * ratio;
    const propagating = Math.abs(sin) < 1 - 1e-12;
    out.push({ m, sin, propagating, angleDeg: propagating ? Math.asin(sin) / DEG : NaN });
  }
  return out;
}

export const propagatingOrders = (fGHz: number, thetaDeg: number, periodCm: number, maxOrder = 10) =>
  diffractionOrders(fGHz, thetaDeg, periodCm, maxOrder).filter((o) => o.propagating);

/** Littrow angle (order m sent straight back to the source); NaN if impossible. */
export function littrowDeg(fGHz: number, periodCm: number, m = -1): number {
  const s = (-m * lambdaCm(fGHz)) / (2 * periodCm);
  return Math.abs(s) <= 1 ? Math.asin(s) / DEG : NaN;
}

/** Sawtooth depth whose facets face the source at the given angle. */
export const blazeDepthCm = (periodCm: number, blazeDeg: number) => periodCm * Math.tan(blazeDeg * DEG);
