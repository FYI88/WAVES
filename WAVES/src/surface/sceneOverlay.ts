import type { ProfileParams } from "./profiles";

/* What the Surface lab hands to the main cross-section: its profile, drawn on
   the wall face, and its calculation settings, reused for the profiled main
   wall. The main view keeps one reflected and one transmitted beam: the
   resultant R and T, summed over all diffraction orders. */

/** One diffraction order, drawn only when the user asks for the orders. */
export interface SceneSurfaceOrder {
  m: number;
  angleDeg: number;
  /** NaN when only the direction is known (grating equation) */
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
  /** extra beams for the diffracted orders (m ≠ 0); absent by default: only the summed R and T are drawn */
  orders?: SceneSurfaceOrder[];
  calc?: SurfaceCalc;
  /** set by the app: source of the R / T shown on the main view */
  rt?: SceneRt;
}

/** Attach the overlay to the scene parameters (unchanged when there is none). */
export function withSurface<T extends object>(params: T, surface: SceneSurface | null): T {
  return surface ? { ...params, surface } : params;
}
