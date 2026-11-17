import { type Cx, type PolMode } from "../physics";
import { type ProfileParams } from "./profiles";
import { surfaceEta, type SurfaceMaterialId } from "./materials";
import { mixedEta, worstInclusionValidity, type Inclusions, type InclusionTarget, type MixValidity } from "../media/mixing";
import {
  rcwaAngleSweep,
  rcwaFreqSweep,
  rcwaInputFor,
  solveRcwaMode,
  type ProfiledWall,
  type RcwaResult,
  type RcwaSweep,
} from "./rcwa";

/* Serializable job descriptions shared by the worker and its synchronous
   fallback. Materials travel as ids so a frequency sweep re-evaluates the
   ITU-R dispersion law at every frequency. */

export interface WallSpec {
  profile: ProfileParams;
  material: SurfaceMaterialId;
  customEps: number;
  customSigma: number;
  /** Main-wall air, matching coatings and ideal inserts are excluded. */
  excludeInclusions?: boolean;
  below: { material: SurfaceMaterialId; cm: number; customEps: number; customSigma: number; excludeInclusions?: boolean }[];
  /** optional bubbles: profile (−1), backing index, or each host (all) */
  inclusions?: Inclusions;
  inclusionTarget?: InclusionTarget;
}

export function wallAt(spec: WallSpec, fGHz: number): ProfiledWall & { mixValidity: MixValidity } {
  const hosts: Cx[] = [];
  const mix = (eta: Cx, index: number, excluded = false) => {
    if (!spec.inclusions || excluded || !(spec.inclusionTarget === "all" || spec.inclusionTarget === index)) return eta;
    hosts.push(eta);
    return mixedEta(eta, spec.inclusions, fGHz);
  };
  const eta = mix(surfaceEta(spec.material, fGHz, spec.customEps, spec.customSigma), -1, spec.excludeInclusions);
  const below = spec.below.map((l, i) => ({ cm: l.cm, eta: mix(surfaceEta(l.material, fGHz, l.customEps, l.customSigma), i, l.excludeInclusions) }));
  return {
    profile: spec.profile,
    eta,
    below,
    mixValidity: spec.inclusions ? worstInclusionValidity(hosts, spec.inclusions, fGHz) : "ok",
  };
}

interface JobBase {
  id: number;
  wall: WallSpec;
  pol: PolMode;
  harmonics: number;
  slices: number;
}

export type RcwaJob =
  | (JobBase & { kind: "point"; fGHz: number; thetaDeg: number })
  | (JobBase & { kind: "angle"; fGHz: number; angles: number[] })
  | (JobBase & { kind: "freq"; thetaDeg: number; freqs: number[] });

export type RcwaReply =
  | { id: number; ok: true; result: RcwaResult | RcwaSweep }
  | { id: number; ok: false; error: string };

export function runJob(job: RcwaJob): RcwaResult | RcwaSweep {
  if (job.kind === "point") {
    return solveRcwaMode(rcwaInputFor(wallAt(job.wall, job.fGHz), job.fGHz, job.thetaDeg, job.pol, job.harmonics, job.slices));
  }
  if (job.kind === "angle") {
    return rcwaAngleSweep(wallAt(job.wall, job.fGHz), job.fGHz, job.pol, job.angles, job.harmonics, job.slices);
  }
  const wall = job.wall;
  return rcwaFreqSweep((f) => wallAt(wall, f), job.thetaDeg, job.pol, job.freqs, job.harmonics, job.slices);
}
