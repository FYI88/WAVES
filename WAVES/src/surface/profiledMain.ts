import type { PolMode } from "../physics";
import type { Layer } from "../state/layers";
import { emtSolve, emtValidity, type EmtResult, type Validity } from "./emt";
import type { SurfaceMaterialId } from "./materials";
import type { ProfileParams } from "./profiles";
import { wallAt, type WallSpec } from "./rcwaJobs";

/* Profiled main wall: the lab profile carved in front of the first main
   layer, in that layer's material, exactly as the main cross-section draws
   it. The whole main stack stays behind the profile. Fast mode (EMT) runs
   inline; rigorous mode (RCWA) sends the same WallSpec to the worker.
   physics.ts is only reached through emtSolve / solveStack. */

type MatSpec = { material: SurfaceMaterialId; customEps: number; customSigma: number };

const AIR: MatSpec = { material: "custom", customEps: 1, customSigma: 0 };

function matSpec(l: Layer): MatSpec {
  return l.mat === "air" ? AIR : { material: l.mat as SurfaceMaterialId, customEps: l.eps, customSigma: l.sigma };
}

/** Main stack + lab profile as a WallSpec (profile in the first layer's material). */
export function mainWallSpec(profile: ProfileParams, layers: Layer[]): WallSpec {
  const head = layers.length ? matSpec(layers[0]) : AIR;
  return { profile, ...head, below: layers.map((l) => ({ ...matSpec(l), cm: l.thickness })) };
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
