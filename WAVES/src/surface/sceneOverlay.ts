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

export interface SceneSurface {
  profile: ProfileParams;
  orders: SceneSurfaceOrder[];
  /** beam widths and labels from the lab wall's rigorous result */
  efficiencies: boolean;
}

/** Attach the overlay to the scene parameters (unchanged when there is none). */
export function withSurface<T extends object>(params: T, surface: SceneSurface | null): T {
  return surface ? { ...params, surface } : params;
}
