import { DEG, abs2, cx, solveStack, sqrtC, sub, type Cx, type Pol, type PolMode } from "../physics";
import { emtStack, type FlatLayer } from "./emt";
import type { ProfileParams } from "./profiles";

/* Order-0 path of the wave inside a profiled wall, for the lab detail view.
   The profiled region is the EMT graded stack; each flat layer is one segment.
   Same quantities the main cross-section uses for its internal reflections:
   net forward flux in / out of each segment, refraction angle, and the power
   sent back at the segment's right-hand interface (generalised reflection
   coefficient from solveStack, which already includes everything behind it).
   Illustrative: R and T shown elsewhere stay the coherent totals. */

export interface DetailSegment {
  /** profiled region, or flat layer `index` */
  kind: "profile" | "layer";
  index: number;
  /** net forward power flux entering / leaving the segment (incident = 1) */
  fluxIn: number;
  fluxOut: number;
  /** order-0 refraction angle in the segment, degrees */
  thetaDeg: number;
  /** real refractive index (draws the compressed wavelength) */
  n: number;
  /** power reflected back at the segment's right-hand interface */
  back: number;
}

function angleIn(eta: Cx, sn: number): number {
  const root = sqrtC(sub(eta, cx(sn * sn)));
  return Math.atan2(sn, Math.abs(root.re)) / DEG;
}

export function detailPaths(
  profile: ProfileParams,
  eta: Cx,
  below: FlatLayer[],
  fGHz: number,
  thetaDeg: number,
  pol: PolMode,
  slices = 24,
): DetailSegment[] {
  const th = Math.min(89.9, Math.max(0, Math.abs(thetaDeg))) * DEG;
  const sn = Math.sin(th);
  const pols: Pol[] = pol === "AVG" ? ["TE", "TM"] : [pol];
  const runs = pols.map((p) => {
    const s = emtStack(profile, eta, below, p, slices);
    if (!s.etas.length) return [] as DetailSegment[];
    const sol = solveStack(s.etas, s.ds, fGHz, th, p);
    const nProfile = profile.depth > 0 ? (profile.id === "flat" ? 1 : Math.max(1, Math.round(slices))) : 0;
    const groups: { kind: DetailSegment["kind"]; index: number; a: number; b: number }[] = [];
    if (nProfile > 0) groups.push({ kind: "profile", index: -1, a: 0, b: nProfile });
    below.forEach((_, k) => groups.push({ kind: "layer", index: k, a: nProfile + k, b: nProfile + k + 1 }));
    return groups.map((g) => {
      // medium m of solveStack is etas[m − 1]; rho[m] sits on its right-hand boundary
      const rep = s.etas[Math.floor((g.a + g.b - 1) / 2)];
      const fluxIn = sol.fluxIn[g.a];
      const fluxOut = sol.fluxIn[g.b];
      return {
        kind: g.kind,
        index: g.index,
        fluxIn,
        fluxOut,
        thetaDeg: angleIn(rep, sn),
        n: Math.max(1, sqrtC(rep).re),
        back: Math.max(0, fluxOut) * abs2(sol.rho[g.b]),
      };
    });
  });
  if (runs.length === 1) return runs[0];
  const [a, b] = runs;
  return a.map((s, i) => ({
    ...s,
    fluxIn: (s.fluxIn + b[i].fluxIn) / 2,
    fluxOut: (s.fluxOut + b[i].fluxOut) / 2,
    back: (s.back + b[i].back) / 2,
  }));
}
