import { DEFAULT_PROFILE, PROFILE_IDS, type ProfileId, type ProfileParams } from "./profiles";
import { SURFACE_MATERIAL_IDS, type SurfaceMaterialId } from "./materials";
import { NO_INCLUSIONS, type InclusionKind, type Inclusions } from "../media/mixing";
import { NO_FOG, type Fog } from "../media/fog";
import { decodeShare, shareHashOf } from "../share";

/* Surface lab state that is saved locally and carried in share links (v2).
   Everything read back (storage or link) goes through sanitizeLab, with the
   same ranges as the lab controls. */

export interface LabLayer {
  material: SurfaceMaterialId;
  cm: number;
  customEps: number;
  customSigma: number;
}

export type LabMode = "fast" | "rigorous";
/** variable swept by the lab chart */
export type SweepAxis = "angle" | "freq";

export interface LabState {
  profile: ProfileParams;
  material: SurfaceMaterialId;
  customEps: number;
  customSigma: number;
  below: LabLayer[];
  inclusions: Inclusions;
  /** −1: bubbles in the profile, otherwise index of the host flat layer */
  incTarget: number;
  fog: Fog;
  mode: LabMode;
  harmonics: number;
  slices: number;
  axis: SweepAxis;
  /** draw the lab profile and its order directions in the main cross-section */
  showInMain: boolean;
  /** use the lab wall's rigorous efficiencies for those beams (off by default) */
  mainEfficiencies: boolean;
}

export const LAB_MAX_BELOW = 4;
export const LAB_STORAGE_KEY = "waves:lab:v1";

export const DEFAULT_LAB: LabState = {
  profile: { ...DEFAULT_PROFILE, id: "square", period: 4, depth: 2 },
  material: "concrete",
  customEps: 4,
  customSigma: 0.05,
  below: [{ material: "concrete", cm: 15, customEps: 4, customSigma: 0.05 }],
  inclusions: NO_INCLUSIONS,
  incTarget: -1,
  fog: NO_FOG,
  mode: "fast",
  harmonics: 10,
  slices: 16,
  axis: "angle",
  showInMain: true,
  mainEfficiencies: false,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

const MODES: readonly LabMode[] = ["fast", "rigorous"];
const AXES: readonly SweepAxis[] = ["angle", "freq"];
const KINDS: readonly InclusionKind[] = ["air", "water"];

/** Clamp an untrusted lab payload into shape; null when it is not an object. */
export function sanitizeLab(raw: unknown): LabState | null {
  if (!isObj(raw)) return null;
  const d = DEFAULT_LAB;
  const p = isObj(raw.profile) ? raw.profile : {};
  const profile: ProfileParams = {
    id: pick<ProfileId>(p.id, PROFILE_IDS, d.profile.id),
    period: num(p.period, 0.2, 30, d.profile.period),
    depth: num(p.depth, 0.05, 15, d.profile.depth),
    fill: num(p.fill, 0.05, 1, d.profile.fill),
    top: num(p.top, 0, 1, d.profile.top),
    steps: int(p.steps, 2, 12, d.profile.steps),
    corr: num(p.corr, 0.05, 10, d.profile.corr),
    seed: int(p.seed, 1, 99, d.profile.seed),
  };
  const below: LabLayer[] = Array.isArray(raw.below)
    ? raw.below
        .filter(isObj)
        .slice(0, LAB_MAX_BELOW)
        .map((l) => ({
          material: pick<SurfaceMaterialId>(l.material, SURFACE_MATERIAL_IDS, "concrete"),
          cm: num(l.cm, 0.1, 60, 10),
          customEps: num(l.customEps, 1, 30, 4),
          customSigma: num(l.customSigma, 0.0001, 10, 0.05),
        }))
    : d.below.map((l) => ({ ...l }));
  const inc = isObj(raw.inclusions) ? raw.inclusions : {};
  const fog = isObj(raw.fog) ? raw.fog : {};
  return {
    profile,
    material: pick<SurfaceMaterialId>(raw.material, SURFACE_MATERIAL_IDS, d.material),
    customEps: num(raw.customEps, 1, 30, d.customEps),
    customSigma: num(raw.customSigma, 0.0001, 10, d.customSigma),
    below,
    inclusions: {
      kind: pick<InclusionKind>(inc.kind, KINDS, d.inclusions.kind),
      fraction: num(inc.fraction, 0, 0.6, d.inclusions.fraction),
      diameterMm: num(inc.diameterMm, 0.1, 30, d.inclusions.diameterMm),
      tempC: num(inc.tempC, 0, 40, d.inclusions.tempC),
    },
    incTarget: int(raw.incTarget, -1, below.length - 1, -1),
    fog: {
      lwc: num(fog.lwc, 0, 1, d.fog.lwc),
      tempC: num(fog.tempC, -8, 30, d.fog.tempC),
      toWallM: num(fog.toWallM, 1, 2000, d.fog.toWallM),
      fromWallM: num(fog.fromWallM, 1, 2000, d.fog.fromWallM),
    },
    mode: pick<LabMode>(raw.mode, MODES, d.mode),
    harmonics: int(raw.harmonics, 2, 20, d.harmonics),
    slices: int(raw.slices, 4, 40, d.slices),
    axis: pick<SweepAxis>(raw.axis, AXES, d.axis),
    showInMain: bool(raw.showInMain, d.showInMain),
    mainEfficiencies: bool(raw.mainEfficiencies, d.mainEfficiencies),
  };
}

/** Lab state from a `#s=` share link, or null when the link has none. */
export function labFromHash(locationHash: string): LabState | null {
  const h = shareHashOf(locationHash);
  if (!h) return null;
  const payload = decodeShare(h);
  if (!payload || payload.lab === undefined) return null;
  return sanitizeLab(payload.lab);
}

/** Boot state: a share link wins over saved storage, as for the main simulator. */
export function loadLab(): LabState {
  try {
    const shared = labFromHash(window.location.hash);
    if (shared) return shared;
  } catch {
    /* malformed hash: fall through to storage */
  }
  try {
    const raw = window.localStorage.getItem(LAB_STORAGE_KEY);
    if (raw) return sanitizeLab(JSON.parse(raw)) ?? DEFAULT_LAB;
  } catch {
    /* storage unavailable or corrupt */
  }
  return DEFAULT_LAB;
}

export function saveLab(state: LabState): void {
  try {
    window.localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: state simply isn't persisted */
  }
}

let snapshot: LabState | null = null;

/** Called by the lab on every change so the share button can include it. */
export function setLabSnapshot(state: LabState): void {
  snapshot = state;
}

/** Lab state for a share link; undefined while the lab is untouched, which keeps links short. */
export function labForShare(): LabState | undefined {
  if (!snapshot) return undefined;
  return JSON.stringify(snapshot) === JSON.stringify(DEFAULT_LAB) ? undefined : snapshot;
}
