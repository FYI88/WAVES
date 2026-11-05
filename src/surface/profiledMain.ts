import type { PolMode } from "../physics";
import { expandLayers, type Layer, type PhysicalLayer } from "../state/layers";
import { isInclusionHost } from "../state/inclusions";
import type { Inclusions } from "../media/mixing";
import { emtSolve, emtValidity, type EmtResult, type Validity } from "./emt";
import type { SurfaceMaterialId } from "./materials";
import type { ProfileParams } from "./profiles";
import { wallAt, type WallSpec } from "./rcwaJobs";

/* Profiled main wall: the lab profile carved in front of the first main
   layer, in that layer's material, exactly as the main cross-section draws
   it. The whole main stack stays behind the profile. Fast mode (EMT) runs
   inline; rigorous mode (RCWA) sends the same WallSpec to the worker.
   physics.ts is only reached through emtSolve / solveStack. */

type MatSpec = { material: SurfaceMaterialId; customEps: number; customSigma: number; excludeInclusions?: boolean };

const AIR: MatSpec = { material: "custom", customEps: 1, customSigma: 0 };

function matSpec(l: PhysicalLayer, mixing: boolean): MatSpec {
  return { ...(l.mat === "air" ? AIR : { material: l.mat as SurfaceMaterialId, customEps: l.eps, customSigma: l.sigma }),
    ...(mixing && !isInclusionHost(l) ? { excludeInclusions: true } : {}) };
}

/** Main stack + lab profile as a WallSpec (profile in the first layer's material). */
export function mainWallSpec(profile: ProfileParams, layers: Layer[], inclusions?: Inclusions | null): WallSpec {
  const physical = expandLayers(layers);
  const head = physical.length ? matSpec(physical[0], !!inclusions) : { ...AIR, ...(inclusions ? { excludeInclusions: true } : {}) };
  return { profile, ...head, below: physical.map((l) => ({ ...matSpec(l, !!inclusions), cm: l.thickness })),
    ...(inclusions ? { inclusions, inclusionTarget: "all" as const } : {}) };
}

/** Zeroth-order (specular) R / T / A of the profiled main wall. */
export function mainEmt(spec: WallSpec, fGHz: number, thetaDeg: number, pol: PolMode, slices = 24): EmtResult {
  const wall = wallAt(spec, fGHz);
  return emtSolve(spec.profile, wall.eta, wall.below, fGHz, thetaDeg, pol, slices);
}

/** Same validity rule as the lab's fast mode. */
export function mainEmtValidity(spec: WallSpec, fGHz: number, thetaDeg: number): Validity {
  if (spec.profile.id === "flat") return "ok";
  return emtValidity(spec.profile.period, fGHz, thetaDeg, wallAt(spec, fGHz).eta);
}
