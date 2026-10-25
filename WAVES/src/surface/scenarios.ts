import { DEFAULT_PROFILE, type ProfileParams } from "./profiles";
import type { SurfaceMaterialId } from "./materials";
import { blazeDepthCm, littrowDeg } from "./grating";

export type ScenarioId = "crenele" | "triangles" | "halfCircles" | "blazed";

export interface LabScenario {
  id: ScenarioId;
  name: { fr: string; en: string };
  note: { fr: string; en: string };
  profile: ProfileParams;
  material: SurfaceMaterialId;
  below: { material: SurfaceMaterialId; cm: number }[];
  fGHz: number;
  thetaDeg: number;
}

const BLAZE_F = 10;
const BLAZE_PERIOD = 3;
const BLAZE_ANGLE = littrowDeg(BLAZE_F, BLAZE_PERIOD, -1);

export const LAB_SCENARIOS: LabScenario[] = [
  {
    id: "crenele",
    name: { fr: "Mur crénelé", en: "Castellated wall" },
    note: { fr: "Créneaux en béton · Λ 4 cm · h 2 cm · 5 GHz", en: "Concrete castellation · Λ 4 cm · h 2 cm · 5 GHz" },
    profile: { ...DEFAULT_PROFILE, id: "square", period: 4, depth: 2, fill: 0.5 },
    material: "concrete",
    below: [{ material: "concrete", cm: 15 }],
    fGHz: 5,
    thetaDeg: 30,
  },
  {
    id: "triangles",
    name: { fr: "Mur à triangles", en: "Triangular wall" },
    note: { fr: "Brique à pointes · Λ 3 cm · h 1,5 cm · 10 GHz", en: "Ridged brick · Λ 3 cm · h 1.5 cm · 10 GHz" },
    profile: { ...DEFAULT_PROFILE, id: "triangle", period: 3, depth: 1.5 },
    material: "brick",
    below: [{ material: "brick", cm: 8 }],
    fGHz: 10,
    thetaDeg: 20,
  },
  {
    id: "halfCircles",
    name: { fr: "Mur à demi-cercles", en: "Half-circle wall" },
    note: { fr: "Bosses en béton (h = Λ/2) · Λ 4 cm · 8 GHz", en: "Concrete bumps (h = Λ/2) · Λ 4 cm · 8 GHz" },
    profile: { ...DEFAULT_PROFILE, id: "bumps", period: 4, depth: 2 },
    material: "concrete",
    below: [{ material: "concrete", cm: 10 }],
    fGHz: 8,
    thetaDeg: 25,
  },
  {
    id: "blazed",
    name: { fr: "Réseau blazé métallique", en: "Blazed metal grating" },
    note: {
      fr: "Dents de scie en métal · Littrow ordre −1 · 10 GHz",
      en: "Metal sawtooth · Littrow order −1 · 10 GHz",
    },
    profile: { ...DEFAULT_PROFILE, id: "sawtooth", period: BLAZE_PERIOD, depth: blazeDepthCm(BLAZE_PERIOD, BLAZE_ANGLE) },
    material: "metal",
    below: [],
    fGHz: BLAZE_F,
    thetaDeg: BLAZE_ANGLE,
  },
];
