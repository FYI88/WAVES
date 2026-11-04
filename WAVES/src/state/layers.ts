import { C0, CUSTOM_SWATCH, MATERIALS, MATERIAL_IDS, materialProps, type MaterialId } from "../physics";
import { tintOf } from "../render/util";

/* ════════════════════════════════════════════════════════════════════════
   Layer model — air | L1 … LN | air
   ════════════════════════════════════════════════════════════════════════ */

export type LayerMat = MaterialId | "air";
export const LAYER_MATS: LayerMat[] = ["air", ...MATERIAL_IDS];
export const AIR_SWATCH = "linear-gradient(135deg, rgba(150,220,255,.55), rgba(150,220,255,.12) 60%, rgba(255,255,255,.35))";
export const MAX_LAYERS = 6;

export interface Layer {
  id: string;
  mat: LayerMat;
  thickness: number; // cm
  eps: number; // custom ε′
  sigma: number; // custom σ
  customMode: CustomMode; // how the custom medium is edited
  matching?: boolean; // ideal matching coating, electrically a custom medium
  matchingDesign?: "quarter-wave-live"; // absent: fixed numerical snapshot
}

export type CustomMode = "eps" | "nk";

export const newId = () => Math.random().toString(36).slice(2, 10);
export const mkLayer = (mat: LayerMat, thickness: number, eps = 4, sigma = 0.05): Layer => ({ id: newId(), mat, thickness, eps, sigma, customMode: "eps" });

/** Normal-incidence, lossless matching estimate; not an optimizer for a lossy stack.
 * Keep the thickness within the editor range using an odd quarter-wave multiple. */
export function quarterWaveMatch(n1: number, n2: number, fGHz: number): { eps: number; cm: number; order: number } | null {
  if (![n1, n2, fGHz].every((v) => Number.isFinite(v) && v > 0)) return null;
  const eps = n1 * n2;
  const quarter = (100 * C0) / (fGHz * 1e9 * 4 * Math.sqrt(eps));
  if (eps < 1 || eps > 30 || !Number.isFinite(quarter) || quarter <= 0) return null;
  const multiple = Math.max(1, 2 * Math.ceil((0.1 / quarter - 1) / 2) + 1);
  const cm = quarter * multiple;
  return cm <= 100 ? { eps, cm, order: multiple } : null;
}

/** Insert a coating at a boundary without replacing either neighbouring material. */
export function insertMatchingLayer(layers: Layer[], slot: number, fGHz: number): Layer[] | null {
  if (layers.length >= MAX_LAYERS || !Number.isInteger(slot) || slot < 0 || slot > layers.length) return null;
  if ([layers[slot - 1], layers[slot]].some((l) => l && (l.matching || l.matchingDesign))) return null;
  const index = (l: Layer | undefined) => {
    if (!l) return 1;
    const { epsR, sigma } = layerEpsSigma(l, fGHz);
    return nkOf(epsR, sigma, fGHz).n;
  };
  const n1 = index(layers[slot - 1]), n2 = index(layers[slot]);
  if (Math.abs(n1 - n2) < 1e-6) return null;
  const match = quarterWaveMatch(n1, n2, fGHz);
  if (!match) return null;
  const coating: Layer = { ...mkLayer("custom", match.cm, match.eps, 0), matching: true, matchingDesign: "quarter-wave-live" };
  return [...layers.slice(0, slot), coating, ...layers.slice(slot)];
}

/** refractive index n − jκ from custom ε′, σ at f */
export function nkOf(eps: number, sigma: number, f: number): { n: number; k: number } {
  const epp = (17.98 * sigma) / f;
  const mod = Math.hypot(eps, epp);
  const n = Math.sqrt((mod + eps) / 2);
  return { n, k: n > 1e-12 ? epp / (2 * n) : 0 };
}

/** custom ε′, σ from refractive index n − jκ at f */
export function epsSigmaOfNK(n: number, k: number, f: number): { eps: number; sigma: number } {
  return { eps: n * n - k * k, sigma: (2 * n * k * f) / 17.98 };
}

export function layerEpsSigma(l: Layer, f: number) {
  if (l.mat === "air") return { epsR: 1, sigma: 0 };
  return materialProps(l.mat, f, l.eps, l.sigma);
}
/** Layer tint: the same lookup as the canvas renderers (single AIR_TINT). */
export const matTint = (m: LayerMat) => tintOf(m);
export const matSwatch = (m: LayerMat) => (m === "air" ? AIR_SWATCH : m === "custom" ? CUSTOM_SWATCH : MATERIALS[m].swatch);

export type TemplateId = "single" | "glazing" | "partition" | "cavity" | "plastered" | "door";
export const TEMPLATES: Record<TemplateId, () => Layer[]> = {
  single: () => [mkLayer("concrete", 20)],
  glazing: () => [mkLayer("glass", 0.4), mkLayer("air", 1.6), mkLayer("glass", 0.4)],
  partition: () => [mkLayer("plasterboard", 1.3), mkLayer("air", 7), mkLayer("plasterboard", 1.3)],
  cavity: () => [mkLayer("brick", 10), mkLayer("air", 5), mkLayer("brick", 10)],
  plastered: () => [mkLayer("plasterboard", 1.3), mkLayer("concrete", 18), mkLayer("plasterboard", 1.3)],
  door: () => [mkLayer("plywood", 0.6), mkLayer("wood", 2.8), mkLayer("plywood", 0.6)],
};
