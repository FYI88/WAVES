import { MATERIALS, complexPermittivity, cx, materialProps, type Cx, type ItuMaterialId } from "../physics";

/* Materials available for the profiled region. ITU-R P.2040 Table 3 lists
   metal as ε′ = 1, σ = 10⁷ S/m (1–100 GHz); it is added here without touching
   physics.ts. */

export type SurfaceMaterialId = ItuMaterialId | "metal" | "custom";

export const SURFACE_MATERIAL_IDS: SurfaceMaterialId[] = [
  ...(Object.keys(MATERIALS) as ItuMaterialId[]),
  "metal",
  "custom",
];

export const METAL = { epsR: 1, sigma: 1e7, fMin: 1, fMax: 100, tint: "#c9d2dc" } as const;

export function surfaceEpsSigma(id: SurfaceMaterialId, fGHz: number, customEps: number, customSigma: number) {
  if (id === "metal") return { epsR: METAL.epsR, sigma: METAL.sigma };
  return materialProps(id, fGHz, customEps, customSigma);
}

export function surfaceEta(id: SurfaceMaterialId, fGHz: number, customEps = 4, customSigma = 0): Cx {
  const { epsR, sigma } = surfaceEpsSigma(id, fGHz, customEps, customSigma);
  return complexPermittivity(epsR, sigma, fGHz);
}

export const surfaceTint = (id: SurfaceMaterialId) =>
  id === "metal" ? METAL.tint : id === "custom" ? "#8b7cff" : MATERIALS[id].tint;

export const AIR_ETA: Cx = cx(1, 0);
