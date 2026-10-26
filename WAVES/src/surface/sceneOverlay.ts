import type { ProfileParams } from "./profiles";

/* What the Surface lab hands to the main cross-section: its profile and the
   propagating orders. Directions come from the grating equation (Λ, f, θ),
   so they hold for the main stack too; efficiencies describe the lab wall
   and are only passed when the user asks for them. */

export interface SceneSurfaceOrder {
  m: number;
  angleDeg: number;
  /** NaN unless `efficiencies` is true */
  R: number;
  T: number;
}

/** Lab calculation settings, reused for the profiled main wall. */
export interface SurfaceCalc {
  mode: "fast" | "rigorous";
  harmonics: number;
  slices: number;
}

/** Which model produced the main R / T: flat stack, profiled EMT or profiled RCWA. */
export type RtSource = "flat" | "emt" | "rcwa";

export interface SceneRt {
  source: RtSource;
  /** rigorous result still computing (EMT shown meanwhile) */
  busy: boolean;
}

export interface SceneSurface {
  profile: ProfileParams;
  orders: SceneSurfaceOrder[];
  /** beam widths and labels from a rigorous result (lab wall, or main wall when rt.source is rcwa) */
  efficiencies: boolean;
  calc?: SurfaceCalc;
  /** set by the app: source of the R / T shown on the main view */
  rt?: SceneRt;
}

/** Attach the overlay to the scene parameters (unchanged when there is none). */
export function withSurface<T extends object>(params: T, surface: SceneSurface | null): T {
  return surface ? { ...params, surface } : params;
}
