import { MATERIALS, CUSTOM_TINT, type MaterialId } from "../physics";

/** Helpers shared by the canvas renderers (waveRays, spatialScene) and the UI. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const SANS = '"Inter Tight", system-ui, sans-serif';
/** The single tint used for air layers across the renderers and the UI. */
export const AIR_TINT = "#83c6dd";

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** "#rrggbb" + opacity (clamped to 0..1) -> "rgba(r,g,b,a)" */
export const rgba = (hex: string, opacity: number) => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${clamp(opacity, 0, 1)})`;
};

/** Linear blend of two "#rrggbb" colors: t = 0 -> a, t = 1 -> b. */
export const mix = (a: string, b: string, t: number) => {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  return "#" + [16, 8, 0].map(shift => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t).toString(16).padStart(2, "0")).join("");
};

export const tintOf = (material: MaterialId | "air") => material === "air" ? AIR_TINT : material === "custom" ? CUSTOM_TINT : MATERIALS[material].tint;
