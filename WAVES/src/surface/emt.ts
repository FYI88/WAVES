import { DEG, ONE, add, cx, div, scale, solveStack, sqrtC, type Cx, type Pol, type PolMode } from "../physics";
import { fillAt, type ProfileParams } from "./profiles";
import { lambdaCm } from "./grating";

/* ════════════════════════════════════════════════════════════════════════
   Fast mode — zeroth-order effective-medium theory.
   Each horizontal slice of the profile is replaced by a homogeneous layer
   (TE: arithmetic mean of ε, TM: harmonic mean) and the resulting graded
   stack is solved with the existing, unchanged solveStack. Exact for the
   flat profile; accurate when Λ ≪ λ. Diffraction needs RCWA.
   ════════════════════════════════════════════════════════════════════════ */

export interface FlatLayer {
  eta: Cx;
  /** thickness in cm */
  cm: number;
}

export function emtSliceEps(fill: number, eta: Cx, pol: Pol): Cx {
  const f = Math.min(1, Math.max(0, fill));
  if (pol === "TE") return add(scale(eta, f), cx(1 - f));
  return div(ONE, add(scale(div(ONE, eta), f), cx(1 - f)));
}

export function emtStack(
  profile: ProfileParams,
  eta: Cx,
  below: FlatLayer[],
  pol: Pol,
  slices = 24,
): { etas: Cx[]; ds: number[] } {
  const etas: Cx[] = [];
  const ds: number[] = [];
  if (profile.depth > 0) {
    if (profile.id === "flat") {
      etas.push(eta);
      ds.push(profile.depth / 100);
    } else {
      const n = Math.max(1, Math.round(slices));
      for (let i = 0; i < n; i++) {
        etas.push(emtSliceEps(fillAt(profile, (i + 0.5) / n), eta, pol));
        ds.push(profile.depth / n / 100);
      }
    }
  }
  for (const layer of below) {
    etas.push(layer.eta);
    ds.push(layer.cm / 100);
  }
  return { etas, ds };
}

export interface EmtResult {
  R: number;
  T: number;
  A: number;
}

export function emtSolve(
  profile: ProfileParams,
  eta: Cx,
  below: FlatLayer[],
  fGHz: number,
  thetaDeg: number,
  pol: PolMode,
  slices = 24,
): EmtResult {
  const th = Math.min(89.9, Math.max(0, Math.abs(thetaDeg))) * DEG;
  const one = (p: Pol): EmtResult => {
    const s = emtStack(profile, eta, below, p, slices);
    if (!s.etas.length) return { R: 0, T: 1, A: 0 };
    const sol = solveStack(s.etas, s.ds, fGHz, th, p);
    return { R: sol.R, T: sol.T, A: sol.A };
  };
  if (pol !== "AVG") return one(pol);
  const a = one("TE");
  const b = one("TM");
  return { R: (a.R + b.R) / 2, T: (a.T + b.T) / 2, A: (a.A + b.A) / 2 };
}

export type Validity = "ok" | "marginal" | "invalid";

/**
 * EMT is reliable when no diffraction order propagates, even inside the
 * densest material: Λ·(n + sin θ) < λ₀. Below 0.3 of that limit it is good.
 */
export function emtValidity(periodCm: number, fGHz: number, thetaDeg: number, eta: Cx): Validity {
  const n = Math.max(1, sqrtC(eta).re);
  const r = (periodCm * (n + Math.abs(Math.sin(thetaDeg * DEG)))) / lambdaCm(fGHz);
  return r < 0.3 ? "ok" : r < 1 ? "marginal" : "invalid";
}
