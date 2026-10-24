import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { drawSpatialScene, type SceneOptions } from "./spatialScene";
import { drawWaveRays } from "./waveRays";
import { decodeShare, encodeShare, shareHashOf } from "./share";
import { readPerf, recordFrame, resetPerf } from "./perf";
import { PerfHud } from "./PerfHud";
import {
  C0,
  CUSTOM_SWATCH,
  CUSTOM_TINT,
  DEG,
  MATERIALS,
  MATERIAL_IDS,
  brewsterDeg,
  complexPermittivity,
  computeStackSweep,
  k0Of,
  materialProps,
  sqrtC,
  stackFieldAbs,
  stackMode,
  sub,
  cx,
  type Cx,
  type MaterialId,
  type PolMode,
  type Sweep,
} from "./physics";

/* ════════════════════════════════════════════════════════════════════════
   Layer model — air | L1 … LN | air
   ════════════════════════════════════════════════════════════════════════ */

type LayerMat = MaterialId | "air";
const LAYER_MATS: LayerMat[] = ["air", ...MATERIAL_IDS];
const AIR_SWATCH = "linear-gradient(135deg, rgba(150,220,255,.55), rgba(150,220,255,.12) 60%, rgba(255,255,255,.35))";
const AIR_TINT = "#8fd8ff";
const MAX_LAYERS = 6;

interface Layer {
  id: string;
  mat: LayerMat;
  thickness: number; // cm
  eps: number; // custom ε′
  sigma: number; // custom σ
  customMode: CustomMode; // how the custom medium is edited
}

type CustomMode = "eps" | "nk";

const newId = () => Math.random().toString(36).slice(2, 10);
const mkLayer = (mat: LayerMat, thickness: number, eps = 4, sigma = 0.05): Layer => ({ id: newId(), mat, thickness, eps, sigma, customMode: "eps" });

/** refractive index n − jκ from custom ε′, σ at f */
function nkOf(eps: number, sigma: number, f: number): { n: number; k: number } {
  const epp = (17.98 * sigma) / f;
  const mod = Math.hypot(eps, epp);
  const n = Math.sqrt((mod + eps) / 2);
  return { n, k: n > 1e-12 ? epp / (2 * n) : 0 };
}

/** custom ε′, σ from refractive index n − jκ at f */
function epsSigmaOfNK(n: number, k: number, f: number): { eps: number; sigma: number } {
  return { eps: n * n - k * k, sigma: (2 * n * k * f) / 17.98 };
}

function layerEpsSigma(l: Layer, f: number) {
  if (l.mat === "air") return { epsR: 1, sigma: 0 };
  return materialProps(l.mat, f, l.eps, l.sigma);
}
const matTint = (m: LayerMat) => (m === "air" ? AIR_TINT : m === "custom" ? CUSTOM_TINT : MATERIALS[m].tint);
const matSwatch = (m: LayerMat) => (m === "air" ? AIR_SWATCH : m === "custom" ? CUSTOM_SWATCH : MATERIALS[m].swatch);

interface SimState {
  layers: Layer[];
  sel: number;
  freq: number; // GHz
  angle: number; // deg
  pol: PolMode;
}

interface LayerRes {
  eta: Cx;
  epsR: number;
  sigma: number;
  epsI: number;
  tanD: number;
  thetaT: number;
  nRe: number;
  alphaDbM: number;
  lossDb: number;
  lambda: number;
  brewster: number;
  brewsterLossless: number;
  inRange: boolean;
  absorbed: number;
  fluxIn: number;
}

interface Results {
  R: number;
  T: number;
  A: number;
  RdB: number;
  TdB: number;
  layers: LayerRes[];
  etas: Cx[];
  ds: number[];
  totalCm: number;
  lambda0: number;
}

function computeResults(s: SimState): Results {
  const th = s.angle * DEG;
  const sn = Math.sin(th);
  const k0 = k0Of(s.freq);
  const lambda0 = C0 / (s.freq * 1e9);
  const etas: Cx[] = [];
  const ds: number[] = [];
  const pre = s.layers.map((l) => {
    const { epsR, sigma } = layerEpsSigma(l, s.freq);
    const eta = complexPermittivity(epsR, sigma, s.freq);
    etas.push(eta);
    ds.push(l.thickness / 100);
    return { l, epsR, sigma, eta };
  });
  const st = stackMode(etas, ds, s.freq, th, s.pol);
  const layers: LayerRes[] = pre.map(({ l, epsR, sigma, eta }, i) => {
    const root = sqrtC(sub(eta, cx(sn * sn)));
    const nC = sqrtC(eta);
    const def = l.mat === "air" || l.mat === "custom" ? null : MATERIALS[l.mat];
    return {
      eta,
      epsR,
      sigma,
      epsI: -eta.im,
      tanD: -eta.im / epsR,
      thetaT: Math.atan2(sn, Math.abs(root.re)) / DEG,
      nRe: nC.re,
      alphaDbM: 20 * Math.LOG10E * k0 * Math.abs(nC.im),
      lossDb: 20 * Math.LOG10E * k0 * Math.abs(root.im) * (l.thickness / 100),
      lambda: lambda0 / nC.re,
      brewster: l.mat === "air" ? NaN : brewsterDeg(eta),
      brewsterLossless: Math.atan(Math.sqrt(epsR)) / DEG,
      inRange: def ? s.freq >= def.fMin && s.freq <= def.fMax : true,
      absorbed: st.absorb[i] ?? 0,
      fluxIn: st.fluxIn[i] ?? 0,
    };
  });
  return {
    R: st.R,
    T: st.T,
    A: st.A,
    RdB: 10 * Math.log10(Math.max(st.R, 1e-30)),
    TdB: 10 * Math.log10(Math.max(st.T, 1e-30)),
    layers,
    etas,
    ds,
    totalCm: s.layers.reduce((a, l) => a + l.thickness, 0),
    lambda0,
  };
}

type TemplateId = "single" | "glazing" | "partition" | "cavity" | "plastered" | "door";
const TEMPLATES: Record<TemplateId, () => Layer[]> = {
  single: () => [mkLayer("concrete", 20)],
  glazing: () => [mkLayer("glass", 0.4), mkLayer("air", 1.6), mkLayer("glass", 0.4)],
  partition: () => [mkLayer("plasterboard", 1.3), mkLayer("air", 7), mkLayer("plasterboard", 1.3)],
  cavity: () => [mkLayer("brick", 10), mkLayer("air", 5), mkLayer("brick", 10)],
  plastered: () => [mkLayer("plasterboard", 1.3), mkLayer("concrete", 18), mkLayer("plasterboard", 1.3)],
  door: () => [mkLayer("plywood", 0.6), mkLayer("wood", 2.8), mkLayer("plywood", 0.6)],
};

/* ════════════════════════════════════════════════════════════════════════
   i18n
   ════════════════════════════════════════════════════════════════════════ */

type Lang = "fr" | "en";

const en = {
  sub: "Wave & Wall Simulator",
  school: "ENSA · GSR1",
  madeBy: "Made by",
  author: "CHETAINE YOUNES",
  tagline: "EM reflection & transmission through multilayer walls",
  parameters: "Parameters",
  material: "Wall material",
  thickness: "Thickness",
  frequency: "Frequency",
  angle: "Incidence angle",
  polarization: "Polarization",
  avg: "Average",
  teHint: "⊥ · s",
  tmHint: "∥ · p",
  avgHint: "unpolarized",
  play: "Play",
  pause: "Pause",
  present: "Present",
  exitPresent: "Exit",
  helpTitle: "Keyboard shortcuts",
  helpClose: "Close",
  scPlay: "Play / pause",
  scAngle: "Incidence angle ±0.5°",
  scLayer: "Select layer",
  scView: "Section / Spatial view",
  scDisplay: "Curves / Crests / Both",
  scHelp: "This shortcuts panel",
  share: "Share",
  shareTitle: "Copy a link to this exact setup",
  copied: "Copied ✓",
  exportCsv: "CSV",
  exportCsvTitle: "Download this chart's data as CSV",
  brewsterJump: "θ → θB",
  brewsterJumpTitle: "Set the angle to Brewster (TM only)",
  brewsterNa: "Brewster exists in TM polarization only",
  reflected: "Reflected",
  transmitted: "Transmitted",
  absorbed: "Absorbed",
  incident: "Incident",
  energy: "Energy budget",
  energyNote: "R + T + A = 100 %",
  thetaT: "Angle in layer",
  thetaTSub: "in the wall · exits at {v}° (Snell)",
  brewster: "Brewster angle",
  brewsterSub: "TM only · lossless √ε′ → {v}°",
  epsR: "Permittivity ε′",
  epsRSub: "ε″ = {v}",
  sigma: "Conductivity σ",
  tanD: "Loss tangent",
  tanDSub: "tan δ = ε″ / ε′",
  atten: "Attenuation",
  attenSub: "{v} dB across this layer",
  tdb: "Transmission",
  tdbSub: "reflection {v} dB",
  index: "Refractive index",
  indexSub: "λ wall {a} · λ₀ {b}",
  chartAngle: "R / T vs incidence angle",
  chartAngleHint: "Click or drag to set the angle",
  chartField: "Field profile |E(z)|",
  chartFieldHint: "Tangential field, normalized to the incident wave",
  reset: "Reset",
  air: "AIR",
  wallLabel: "WALL",
  outOfRange: "Outside ITU-R validity ({a}–{b} GHz) · extrapolated",
  inRange: "ITU-R P.2040 · valid {a}–{b} GHz",
  customRange: "User-defined constants",
  presets: "Scenarios",
  epsCustom: "Permittivity ε′",
  modeEps: "ε′ · σ",
  modeNK: "n · κ",
  sigmaCustom: "Conductivity σ",
  model:
    "Model: ITU-R P.2040 §3 — stack of homogeneous layers in free space (stable transfer recursion), complex permittivity η = ε′ − j·17.98·σ/f, Snell’s law and complex Fresnel coefficients with multiple internal reflections.",
  shortcuts: "Space play/pause · ←/→ angle · ↑↓ layer · V view · 1/2/3 display · P present · L language · T theme · ? shortcuts",
  theme: "Toggle theme",
  language: "Language",
  about: "About",
  aboutTitle: "About WaveS",
  repo: "Source code on GitHub",
  repoTitle: "Open the GitHub repository in a new tab",
  contactTitle: "Send an email",
  authorLabel: "Author",
  schoolLabel: "School",
  contactLabel: "Contact",
  modelLabel: "Model",
  emailSchool: "Institutional",
  emailPersonal: "Personal",
  modelNote:
    "Stack of homogeneous layers in free space, solved with a stable transfer recursion. Complex permittivity, Snell’s law and complex Fresnel coefficients with multiple internal reflections.",
  linear: "Lin",
  db: "dB",
  angleShort: "θ",
  normal: "normal",
  layersN: "{n} layers",
  layer1: "1 layer",
  reflShort: "Refl.",
  clickLayer: "Click a layer to edit it",
  tabStack: "Layers",
  tabWave: "Wave",
  stack: "Layer stack · air on both sides",
  airShort: "AIR",
  moveUp: "Move left (towards source)",
  moveDown: "Move right (towards receiver)",
  duplicate: "Duplicate layer",
  remove: "Remove layer",
  maxLayers: "Maximum {n} layers",
  addLayer: "Add a layer",
  editing: "Selected layer",
  airNote: "Free space · ε′ = 1, σ = 0",
  statsFor: "Layer · {m} · {d} cm",
  moreProps: "Material properties",
  templateNames: {
    single: "Concrete wall",
    glazing: "Double glazing",
    partition: "Stud partition",
    cavity: "Cavity brick",
    plastered: "Plastered concrete",
    door: "Wooden door",
  } as Record<TemplateId, string>,
  materials: {
    concrete: "Concrete",
    brick: "Brick",
    plasterboard: "Plasterboard",
    wood: "Wood",
    glass: "Glass",
    chipboard: "Chipboard",
    plywood: "Plywood",
    marble: "Marble",
    custom: "Custom",
    air: "Air gap",
  } as Record<LayerMat, string>,
  presetNames: {
    wifi24: "Wi-Fi 2.4 GHz · cavity brick",
    wifi5: "Wi-Fi 5 GHz · stud partition",
    lte: "5G 3.5 GHz · plastered concrete",
    mmw: "5G 28 GHz · double glazing",
    brewster: "Brewster · glass, TM",
  } as Record<string, string>,
};

type Dict = typeof en;

const fr: Dict = {
  sub: "Simulateur onde & paroi",
  school: "ENSA · GSR1",
  madeBy: "Réalisé par",
  author: "CHETAINE YOUNES",
  tagline: "Réflexion et transmission EM à travers des parois multicouches",
  parameters: "Paramètres",
  material: "Matériau du mur",
  thickness: "Épaisseur",
  frequency: "Fréquence",
  angle: "Angle d’incidence",
  polarization: "Polarisation",
  avg: "Moyenne",
  teHint: "⊥ · s",
  tmHint: "∥ · p",
  avgHint: "non polarisée",
  play: "Lecture",
  pause: "Pause",
  present: "Présenter",
  exitPresent: "Quitter",
  helpTitle: "Raccourcis clavier",
  helpClose: "Fermer",
  scPlay: "Lecture / pause",
  scAngle: "Angle d'incidence ±0,5°",
  scLayer: "Choisir la couche",
  scView: "Vue Coupe / Spatial",
  scDisplay: "Courbes / Crêtes / Les deux",
  scHelp: "Ce panneau",
  share: "Partager",
  shareTitle: "Copier un lien vers ce réglage exact",
  copied: "Copié ✓",
  exportCsv: "CSV",
  exportCsvTitle: "Télécharger les données du graphique en CSV",
  brewsterJump: "θ → θB",
  brewsterJumpTitle: "Régler l'angle sur Brewster (TM uniquement)",
  brewsterNa: "Brewster n'existe qu'en polarisation TM",
  reflected: "Réfléchie",
  transmitted: "Transmise",
  absorbed: "Absorbée",
  incident: "Incidente",
  energy: "Bilan d’énergie",
  energyNote: "R + T + A = 100 %",
  thetaT: "Angle dans la couche",
  thetaTSub: "dans le mur · ressort à {v}° (Snell)",
  brewster: "Angle de Brewster",
  brewsterSub: "TM uniquement · sans pertes √ε′ → {v}°",
  epsR: "Permittivité ε′",
  epsRSub: "ε″ = {v}",
  sigma: "Conductivité σ",
  tanD: "Tangente de pertes",
  tanDSub: "tan δ = ε″ / ε′",
  atten: "Atténuation",
  attenSub: "{v} dB dans cette couche",
  tdb: "Transmission",
  tdbSub: "réflexion {v} dB",
  index: "Indice de réfraction",
  indexSub: "λ mur {a} · λ₀ {b}",
  chartAngle: "R / T selon l’angle d’incidence",
  chartAngleHint: "Cliquez ou glissez pour régler l’angle",
  chartField: "Profil du champ |E(z)|",
  chartFieldHint: "Champ tangentiel, normalisé à l’onde incidente",
  reset: "Réinitialiser",
  air: "AIR",
  wallLabel: "MUR",
  outOfRange: "Hors validité ITU-R ({a}–{b} GHz) · extrapolé",
  inRange: "ITU-R P.2040 · valide {a}–{b} GHz",
  customRange: "Constantes définies par l’utilisateur",
  presets: "Scénarios",
  epsCustom: "Permittivité ε′",
  modeEps: "ε′ · σ",
  modeNK: "n · κ",
  sigmaCustom: "Conductivité σ",
  model:
    "Modèle : ITU-R P.2040 §3 — empilement de couches homogènes dans l’air (récursion de transfert stable), permittivité complexe η = ε′ − j·17,98·σ/f, loi de Snell et coefficients de Fresnel complexes avec réflexions internes multiples.",
  shortcuts: "Espace lecture/pause · ←/→ angle · ↑↓ couche · V vue · 1/2/3 affichage · P présentation · L langue · T thème · ? raccourcis",
  theme: "Changer de thème",
  language: "Langue",
  about: "À propos",
  aboutTitle: "À propos de WaveS",
  repo: "Code source sur GitHub",
  repoTitle: "Ouvrir le dépôt GitHub dans un nouvel onglet",
  contactTitle: "Envoyer un email",
  authorLabel: "Auteur",
  schoolLabel: "École",
  contactLabel: "Contact",
  modelLabel: "Modèle",
  emailSchool: "Institutionnel",
  emailPersonal: "Personnel",
  modelNote:
    "Empilement de couches homogènes dans l’air, résolu par une récursion de transfert stable. Permittivité complexe, loi de Snell et coefficients de Fresnel complexes avec réflexions internes multiples.",
  linear: "Lin",
  db: "dB",
  angleShort: "θ",
  normal: "normale",
  layersN: "{n} couches",
  layer1: "1 couche",
  reflShort: "Réfl.",
  clickLayer: "Cliquez une couche pour l’éditer",
  tabStack: "Couches",
  tabWave: "Onde",
  stack: "Empilement · air des deux côtés",
  airShort: "AIR",
  moveUp: "Déplacer à gauche (vers la source)",
  moveDown: "Déplacer à droite (vers le récepteur)",
  duplicate: "Dupliquer la couche",
  remove: "Supprimer la couche",
  maxLayers: "Maximum {n} couches",
  addLayer: "Ajouter une couche",
  editing: "Couche sélectionnée",
  airNote: "Vide · ε′ = 1, σ = 0",
  statsFor: "Couche · {m} · {d} cm",
  moreProps: "Propriétés du matériau",
  templateNames: {
    single: "Mur béton",
    glazing: "Double vitrage",
    partition: "Cloison placo",
    cavity: "Brique à lame d’air",
    plastered: "Béton enduit",
    door: "Porte en bois",
  } as Record<TemplateId, string>,
  materials: {
    concrete: "Béton",
    brick: "Brique",
    plasterboard: "Plaque de plâtre",
    wood: "Bois",
    glass: "Verre",
    chipboard: "Aggloméré",
    plywood: "Contreplaqué",
    marble: "Marbre",
    custom: "Personnalisé",
    air: "Lame d’air",
  },
  presetNames: {
    wifi24: "Wi-Fi 2,4 GHz · brique à lame d’air",
    wifi5: "Wi-Fi 5 GHz · cloison placo",
    lte: "5G 3,5 GHz · béton enduit",
    mmw: "5G 28 GHz · double vitrage",
    brewster: "Brewster · verre, TM",
  },
};

const DICTS: Record<Lang, Dict> = { fr, en };

const REPO_URL = "https://github.com/FYI88/WAVES";
const CONTACT_EMAILS = [
  { labelKey: "emailSchool", address: "chetaine.younes@etu.uae.ac.ma" },
  { labelKey: "emailPersonal", address: "youneschetaine@gmail.com" },
] as const;

const tpl = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

function makeFmt(lang: Lang) {
  const loc = lang === "fr" ? "fr-FR" : "en-US";
  const num = (v: number, digits = 1) =>
    Number.isFinite(v)
      ? v.toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "∞";
  const sig = (v: number, digits = 3) => {
    if (!Number.isFinite(v)) return "∞";
    if (v === 0) return "0";
    const abs = Math.abs(v);
    if (abs >= 1e4 || abs < 1e-3) {
      const e = Math.floor(Math.log10(abs));
      const m = v / Math.pow(10, e);
      return `${m.toLocaleString(loc, { maximumFractionDigits: 2 })}×10${superscript(e)}`;
    }
    return v.toLocaleString(loc, { maximumSignificantDigits: digits });
  };
  const len = (m: number) => {
    if (!Number.isFinite(m)) return "∞";
    if (m < 0.01) return `${num(m * 1000, m < 0.001 ? 2 : 1)} mm`;
    if (m < 1) return `${num(m * 100, m < 0.1 ? 2 : 1)} cm`;
    if (m < 1000) return `${num(m, m < 10 ? 2 : 1)} m`;
    return `${num(m / 1000, 1)} km`;
  };
  const pct = (v: number) => {
    const p = v * 100;
    return num(p, p < 0.1 && p > 0 ? 3 : p < 10 ? 2 : 1);
  };
  return { num, sig, len, pct };
}

function superscript(n: number): string {
  const map: Record<string, string> = {
    "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return String(n).split("").map((c) => map[c] ?? c).join("");
}

/* ════════════════════════════════════════════════════════════════════════
   Theme palette (canvas)
   ════════════════════════════════════════════════════════════════════════ */

type Theme = "dark" | "light";

interface Palette {
  dark: boolean;
  bg0: string;
  bg1: string;
  dot: string;
  grid: string;
  gridStrong: string;
  ink: string;
  muted: string;
  faint: string;
  inc: string;
  ref: string;
  tra: string;
  abs: string;
  acc: string;
  label: string;
  labelBorder: string;
}

const PALETTES: Record<Theme, Palette> = {
  dark: {
    dark: true,
    bg0: "#0a1420",
    bg1: "#080e17",
    dot: "rgba(180,205,225,0.06)",
    grid: "rgba(180,205,225,0.07)",
    gridStrong: "rgba(180,205,225,0.16)",
    ink: "#edf4fc",
    muted: "#b4c3d5",
    faint: "#94a6bc",
    inc: "#55dbf5",
    ref: "#ff9586",
    tra: "#79e2bc",
    abs: "#edc17f",
    acc: "#55dbf5",
    label: "rgba(12,21,33,0.94)",
    labelBorder: "rgba(180,205,225,0.16)",
  },
  light: {
    dark: false,
    bg0: "#f6f9fc",
    bg1: "#edf2f6",
    dot: "rgba(22,41,57,0.08)",
    grid: "rgba(22,41,57,0.07)",
    gridStrong: "rgba(22,41,57,0.16)",
    ink: "#162939",
    muted: "#40596e",
    faint: "#50687c",
    inc: "#55dbf5",
    ref: "#ff9586",
    tra: "#79e2bc",
    abs: "#8d5b13",
    acc: "#006b86",
    label: "rgba(255,255,255,0.94)",
    labelBorder: "rgba(22,41,57,0.12)",
  },
};

const withAlpha = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/* Canvas palette: the scene draws from these per-theme constants only.
   DOM accents live in the CSS --om-* tokens; the two are kept in sync by
   hand, but the canvas must never depend on a stale DOM read. */
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '"Inter Tight", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

/* ════════════════════════════════════════════════════════════════════════
   Procedural wall textures
   ════════════════════════════════════════════════════════════════════════ */

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTexture(id: MaterialId, dark: boolean): HTMLCanvasElement {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  if (!g) return c;
  const rnd = mulberry(id.length * 977 + id.charCodeAt(0) * 31);
  const dim = dark ? 0.82 : 1;
  const shade = (r: number, gg: number, b: number, a = 1) =>
    `rgba(${Math.round(r * dim)},${Math.round(gg * dim)},${Math.round(b * dim)},${a})`;

  switch (id) {
    case "concrete": {
      g.fillStyle = shade(140, 143, 151);
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 1400; i++) {
        const v = 90 + rnd() * 110;
        g.fillStyle = shade(v, v, v + 6, 0.35 + rnd() * 0.4);
        const sz = rnd() < 0.9 ? 1 : 2;
        g.fillRect(rnd() * S, rnd() * S, sz, sz);
      }
      for (let i = 0; i < 14; i++) {
        const v = 100 + rnd() * 60;
        g.fillStyle = shade(v, v - 2, v - 6, 0.55);
        g.beginPath();
        g.ellipse(rnd() * S, rnd() * S, 2 + rnd() * 5, 1.5 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "brick": {
      g.fillStyle = shade(214, 200, 184);
      g.fillRect(0, 0, S, S);
      const bh = 32;
      const bw = 64;
      for (let row = 0; row < S / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < S / bw + 1; col++) {
          const x = col * bw + off;
          const y = row * bh;
          const r = 170 + rnd() * 40;
          g.fillStyle = shade(r, 70 + rnd() * 20, 46 + rnd() * 14);
          g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
          for (let k = 0; k < 60; k++) {
            g.fillStyle = shade(255, 210, 180, rnd() * 0.12);
            g.fillRect(x + 2 + rnd() * (bw - 4), y + 2 + rnd() * (bh - 4), 1.5, 1.5);
            g.fillStyle = shade(60, 20, 10, rnd() * 0.18);
            g.fillRect(x + 2 + rnd() * (bw - 4), y + 2 + rnd() * (bh - 4), 1.5, 1.5);
          }
        }
      }
      break;
    }
    case "plasterboard": {
      g.fillStyle = shade(236, 230, 216);
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 700; i++) {
        g.fillStyle = shade(170, 160, 140, rnd() * 0.25);
        g.fillRect(rnd() * S, rnd() * S, 1, 1);
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = shade(255, 255, 250, 0.4);
        g.beginPath();
        g.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.2, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "wood": {
      g.fillStyle = shade(170, 114, 64);
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 26; i++) {
        const x0 = (i / 26) * S + rnd() * 3;
        const amp = 1.5 + rnd() * 3;
        g.strokeStyle = shade(90, 52, 24, 0.18 + rnd() * 0.25);
        g.lineWidth = 0.6 + rnd() * 1.4;
        g.beginPath();
        for (let y = 0; y <= S; y += 4) {
          const x = x0 + Math.sin((y / S) * Math.PI * 2 + i) * amp;
          if (y === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }
    case "glass": {
      g.fillStyle = dark ? "rgba(110,205,230,0.30)" : "rgba(120,205,228,0.38)";
      g.fillRect(0, 0, S, S);
      g.strokeStyle = "rgba(255,255,255,0.18)";
      g.lineWidth = 6;
      for (let i = -2; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 48, S);
        g.lineTo(i * 48 + S, 0);
        g.stroke();
      }
      g.strokeStyle = "rgba(255,255,255,0.10)";
      g.lineWidth = 2;
      for (let i = -2; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 48 + 14, S);
        g.lineTo(i * 48 + 14 + S, 0);
        g.stroke();
      }
      break;
    }
    case "chipboard": {
      g.fillStyle = shade(204, 166, 112);
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 520; i++) {
        const t = rnd();
        g.fillStyle = t < 0.5 ? shade(150, 104, 56, 0.55) : shade(238, 210, 160, 0.6);
        g.save();
        g.translate(rnd() * S, rnd() * S);
        g.rotate(rnd() * Math.PI);
        g.fillRect(-2 - rnd() * 3, -0.8, 4 + rnd() * 5, 1.6);
        g.restore();
      }
      break;
    }
    case "plywood": {
      const plies = [
        [232, 198, 140],
        [196, 150, 92],
        [226, 186, 124],
        [184, 136, 80],
      ];
      const pw = S / 8;
      for (let i = 0; i < 8; i++) {
        const p = plies[i % plies.length];
        g.fillStyle = shade(p[0], p[1], p[2]);
        g.fillRect(i * pw, 0, pw, S);
        g.fillStyle = shade(120, 80, 40, 0.5);
        g.fillRect(i * pw, 0, 1, S);
        for (let k = 0; k < 10; k++) {
          g.fillStyle = shade(110, 70, 30, 0.12);
          g.fillRect(i * pw + 2 + rnd() * (pw - 4), 0, 0.8, S);
        }
      }
      break;
    }
    case "marble": {
      g.fillStyle = shade(240, 239, 234);
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 7; i++) {
        g.strokeStyle = shade(120, 120, 136, 0.18 + rnd() * 0.3);
        g.lineWidth = 0.6 + rnd() * 1.6;
        g.beginPath();
        let x = rnd() * S;
        let y = 0;
        g.moveTo(x, y);
        while (y < S) {
          const nx = x + (rnd() - 0.5) * 30;
          const ny = y + 10 + rnd() * 20;
          g.quadraticCurveTo(x + (rnd() - 0.5) * 30, (y + ny) / 2, nx, ny);
          x = nx;
          y = ny;
        }
        g.stroke();
      }
      for (let i = 0; i < 300; i++) {
        g.fillStyle = shade(180, 175, 170, rnd() * 0.15);
        g.fillRect(rnd() * S, rnd() * S, 1, 1);
      }
      break;
    }
    case "custom": {
      g.fillStyle = dark ? "rgba(60,48,130,0.85)" : "rgba(214,206,255,0.95)";
      g.fillRect(0, 0, S, S);
      const step = 16;
      for (let y = 0; y <= S; y += step) {
        for (let x = 0; x <= S; x += step) {
          const ox = (y / step) % 2 ? step / 2 : 0;
          g.fillStyle = dark ? "rgba(170,160,255,0.55)" : "rgba(106,88,245,0.45)";
          g.beginPath();
          g.arc(x + ox, y, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.strokeStyle = dark ? "rgba(140,130,255,0.18)" : "rgba(106,88,245,0.15)";
      g.lineWidth = 1;
      for (let y = 0; y <= S; y += step) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(S, y);
        g.stroke();
      }
      break;
    }
  }
  return c;
}

/* ════════════════════════════════════════════════════════════════════════
   Canvas helpers
   ════════════════════════════════════════════════════════════════════════ */

interface CanvasSize {
  w: number;
  h: number;
  dpr: number;
}

function cssZoom(): number {
  if (typeof document === "undefined") return 1;
  const z = parseFloat(getComputedStyle(document.body).zoom || "1");
  return z > 0 && Number.isFinite(z) ? z : 1;
}

/** Best-effort clipboard write with a legacy fallback (non-secure contexts). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Download helper for generated files (PNG snapshots, CSV tables). */
function downloadFile(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>, dprCap = 2): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      // getBoundingClientRect is already shrunk by page zoom: size the drawing
      // in layout px so zoom is a uniform optical shrink. The renderers (their
      // `compact` branches and absolute-px constants like lambdaPx) then behave
      // exactly as at zoom 1.
      const z = cssZoom();
      const w = r.width / z;
      const h = r.height / z;
      setSize((prev) =>
        prev.w === w && prev.h === h && prev.dpr === dpr
          ? prev
          : { w, h, dpr },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, dprCap]);
  return size;
}

/* ── Adaptive resolution ────────────────────────────────────────────────
   The target phone (Mali-G71 MP2) cannot hold 60 fps at DPR 2. Step the
   canvas backing resolution down when p95 frame time stays above 22 ms and
   back up after three comfortable windows. The last choice is remembered so
   the next launch starts at the right level. */
const DPR_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;
const DPR_STORAGE_KEY = "waves:dprCap";
const COARSE_POINTER = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

function storedDprCap(fallback: number): number {
  try {
    const raw = window.localStorage.getItem(DPR_STORAGE_KEY);
    const value = raw === null ? NaN : Number(raw);
    if ((DPR_STEPS as readonly number[]).includes(value)) return value;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

function useAdaptiveDprCap(): number {
  const [cap, setCap] = useState(() => storedDprCap(COARSE_POINTER ? 1.5 : 2));
  useEffect(() => {
    let goodWindows = 0;
    let settledAt = performance.now();
    const timer = window.setInterval(() => {
      if (performance.now() - settledAt < 3000) return;
      const { p95, idle } = readPerf();
      if (idle || p95 <= 0) {
        goodWindows = 0;
        return;
      }
      const index = (DPR_STEPS as readonly number[]).indexOf(cap);
      if (p95 > 22 && index > 0) {
        const next = DPR_STEPS[index - 1];
        setCap(next);
        try {
          window.localStorage.setItem(DPR_STORAGE_KEY, String(next));
        } catch {
          /* storage unavailable */
        }
        resetPerf();
        settledAt = performance.now();
        goodWindows = 0;
      } else if (p95 < 14) {
        goodWindows += 1;
        if (goodWindows >= 3 && index < DPR_STEPS.length - 1) {
          const next = DPR_STEPS[index + 1];
          setCap(next);
          try {
            window.localStorage.setItem(DPR_STORAGE_KEY, String(next));
          } catch {
            /* storage unavailable */
          }
          resetPerf();
          settledAt = performance.now();
          goodWindows = 0;
        }
      } else {
        goodWindows = 0;
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [cap]);
  return cap;
}

function prepCanvas(canvas: HTMLCanvasElement, size: CanvasSize) {
  const W = Math.max(1, Math.round(size.w * size.dpr));
  const H = Math.max(1, Math.round(size.h * size.dpr));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  return ctx;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  pal: Palette,
  color: string,
  align: "left" | "center" | "right" = "center",
) {
  ctx.font = `600 11px ${MONO}`;
  const tw = ctx.measureText(text).width;
  const pw = tw + 16;
  const ph = 22;
  let px = x - pw / 2;
  if (align === "left") px = x;
  if (align === "right") px = x - pw;
  ctx.save();
  roundRect(ctx, px, y - ph / 2, pw, ph, 11);
  ctx.fillStyle = pal.label;
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + 8, y + 0.5);
  ctx.restore();
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ════════════════════════════════════════════════════════════════════════
   Ray scene renderer
   ════════════════════════════════════════════════════════════════════════ */

interface SceneLayer {
  mat: LayerMat;
  cm: number;
  thetaT: number;
  nRe: number;
  absorbed: number;
  fluxIn: number;
  fluxOut: number;
  name: string;
}

interface SceneParams {
  etas: Cx[];
  ds: number[];
  theta: number;
  R: number;
  T: number;
  layers: SceneLayer[];
  sel: number;
  hover: number;
  freq: number;
  pol: PolMode;
  labels: { normal: string; tx: string; rx: string; refl: string };
}

interface SceneLayout {
  rects: { x0: number; x1: number; y0: number; y1: number }[];
  polygons?: { x: number; y: number }[][];
  tiles?: { x0: number; x1: number; y0: number; y1: number; index: number }[];
}

const hexRgb = (h: string) => {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixHex = (a: string, b: string, t: number) => {
  const A = hexRgb(a);
  const B = hexRgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

/** Draws a beam + oscillating field ribbon + moving wavefront crests; returns phase at the segment end. */

/* ════════════════════════════════════════════════════════════════════════
   Chart renderers
   ════════════════════════════════════════════════════════════════════════ */

const PAD = { l: 46, r: 16, t: 18, b: 34 };

function drawAxes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pal: Palette,
  xTicks: { v: number; label: string }[],
  yTicks: { v: number; label: string }[],
  xMap: (v: number) => number,
  yMap: (v: number) => number,
) {
  ctx.save();
  ctx.font = `500 10.5px ${MONO}`;
  ctx.fillStyle = pal.faint;
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of yTicks) {
    const y = Math.round(yMap(t.v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.fillText(t.label, PAD.l - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xTicks) {
    const x = Math.round(xMap(t.v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, h - PAD.b);
    ctx.stroke();
    ctx.fillText(t.label, x, h - PAD.b + 9);
  }
  ctx.restore();
}

function strokeCurve(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  ys: number[],
  color: string,
  width: number,
  pal: Palette,
  opts: { dash?: number[]; fillTo?: number; glow?: boolean; alpha?: number } = {},
) {
  if (xs.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.fillTo !== undefined) {
    const minY = Math.min(...ys);
    const g = ctx.createLinearGradient(0, minY, 0, opts.fillTo);
    g.addColorStop(0, withAlpha(color, pal.dark ? 0.26 : 0.18));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(xs[0], opts.fillTo);
    for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.lineTo(xs[xs.length - 1], opts.fillTo);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (opts.dash) ctx.setLineDash(opts.dash);
  if (opts.glow) {
    ctx.shadowColor = withAlpha(color, 0.7);
    ctx.shadowBlur = pal.dark ? 4 : 0;
  }
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.stroke();
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pal: Palette) {
  ctx.save();
  const rg = ctx.createRadialGradient(x, y, 0, x, y, 14);
  rg.addColorStop(0, withAlpha(color, 0.5));
  rg.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.dark ? "#0a0c16" : "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function tooltip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  lines: { text: string; color: string }[],
  pal: Palette,
) {
  ctx.save();
  ctx.font = `600 11px ${MONO}`;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l.text).width));
  const bw = tw + 22;
  const bh = lines.length * 17 + 12;
  let bx = x + 14;
  if (bx + bw > w - 8) bx = x - 14 - bw;
  const by = clamp(y - bh / 2, PAD.t, 9999);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 8;
  roundRect(ctx, bx, by, bw, bh, 10);
  ctx.fillStyle = pal.label;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = pal.labelBorder;
  ctx.stroke();
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(bx + 11, by + 14 + i * 17, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.ink;
    ctx.fillText(l.text, bx + 19, by + 14.5 + i * 17);
  });
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   Visual components
   ════════════════════════════════════════════════════════════════════════ */

function RayScene(props: {
  params: SceneParams;
  pal: Palette;
  playing: boolean;
  lang: Lang;
  fmtNum: (v: number, d?: number) => string;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const dprCap = useAdaptiveDprCap();
  const size = useCanvasSize(ref, dprCap);
  // the scenery never changes between frames, so it is painted once at panel
  // resolution instead of every frame at the reduced animation resolution
  const staticSize = useCanvasSize(backdropRef, 2.5);
  const [hover, setHover] = useState(-1);
  const [view, setView] = useState<"wave" | "spatial">("wave");
  const [display, setDisplay] = useState<SceneOptions["display"]>("both");
  const [reflections, setReflections] = useState(true);
  const [annotations, setAnnotations] = useState(true);
  const [orbit, setOrbit] = useState({ az: 0.45, el: 0.45 });
  const [speed, setSpeed] = useState(1);
  const live = useRef({ ...props, view, display, annotations, orbit, speed, hover, reflections });
  live.current = { ...props, view, display, annotations, orbit, speed, hover, reflections };
  const clock = useRef(0);
  const introStart = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const patterns = useRef(new Map<string, CanvasPattern | null>());
  const layout = useRef<SceneLayout>({ rects: [] });
  const french = props.lang === "fr";

  // keyboard bridge: App owns the global shortcuts, RayScene owns view/display
  // state — "waves:set-view"/"waves:set-display" events connect the two
  useEffect(() => {
    const onView = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "wave" || v === "spatial") setView(v);
      else setView((cur) => (cur === "wave" ? "spatial" : "wave"));
    };
    const onDisplay = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d === "field" || d === "fronts" || d === "both") setDisplay(d);
    };
    window.addEventListener("waves:set-view", onView);
    window.addEventListener("waves:set-display", onDisplay);
    return () => {
      window.removeEventListener("waves:set-view", onView);
      window.removeEventListener("waves:set-display", onDisplay);
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();
    let previous: typeof live.current | null = null;
    if (introStart.current === null) introStart.current = last;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = now - last;
      const dt = Math.min(0.05, elapsed / 1000);
      last = now;
      if (document.hidden) return;
      const cur = live.current;
      const moving = cur.playing && !motionPreference.matches;
      const intro = motionPreference.matches ? 1 : Math.min(1, (now - (introStart.current ?? now)) / 1000);
      if (!moving && intro === 1 && previous === cur) return;
      previous = cur;
      if (moving) clock.current += dt * cur.speed;
      const ctx = prepCanvas(canvas, size);
      if (!ctx) return;
      const pats = cur.params.layers.map((layer) => {
        if (layer.mat === "air") return null;
        const key = `${layer.mat}-${cur.pal.dark}`;
        if (!patterns.current.has(key)) patterns.current.set(key, ctx.createPattern(makeTexture(layer.mat, cur.pal.dark), "repeat"));
        return patterns.current.get(key) ?? null;
      });
      const parameters = { ...cur.params, hover: cur.hover };
      layout.current = cur.view === "spatial"
        ? drawSpatialScene(ctx, size.w, size.h, clock.current, intro, parameters, cur.pal, pats, cur.fmtNum, { display: cur.display, annotations: cur.annotations, az: cur.orbit.az, el: cur.orbit.el, lang: cur.lang, shadows: !COARSE_POINTER })
        : drawWaveRays(ctx, size.w, size.h, clock.current, parameters, cur.pal, cur.fmtNum, { display: cur.display, reflections: cur.reflections, annotations: cur.annotations, lang: cur.lang, lowPower: COARSE_POINTER, shadows: !COARSE_POINTER, layer: "animated" });
      recordFrame(elapsed, { dpr: size.dpr, width: canvas.width, height: canvas.height });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  // Scenery pass: grid, slabs, tiles, labels and the ruler. Repainted only
  // when the setup, the theme or the hover/selection changes, at up to 2.5x
  // device pixels so the small type stays crisp on a 1080p panel.
  useEffect(() => {
    const canvas = backdropRef.current;
    if (!canvas || staticSize.w === 0) return;
    const ctx = prepCanvas(canvas, staticSize);
    if (!ctx) return;
    if (view !== "wave") {
      ctx.clearRect(0, 0, staticSize.w, staticSize.h);
      return;
    }
    drawWaveRays(ctx, staticSize.w, staticSize.h, 0, { ...props.params, hover }, props.pal, props.fmtNum, {
      display,
      reflections,
      annotations,
      lang: props.lang,
      lowPower: COARSE_POINTER,
      shadows: !COARSE_POINTER,
      layer: "static",
    });
  }, [staticSize, view, props.params, props.pal, props.lang, props.fmtNum, annotations, hover, display, reflections]);

  const hit = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const z = cssZoom();
    const point = { x: (event.clientX - bounds.left) / z, y: (event.clientY - bounds.top) / z };
    const tile = layout.current.tiles?.find(item => point.x >= item.x0 && point.x <= item.x1 && point.y >= item.y0 && point.y <= item.y1);
    if (tile) return tile.index;
    const polygons = layout.current.polygons;
    if (polygons) {
      for (let index = polygons.length - 1; index >= 0; index--) {
        const polygon = polygons[index];
        let inside = false;
        for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
          const left = polygon[current];
          const right = polygon[previous];
          if ((left.y > point.y) !== (right.y > point.y) && point.x < (right.x - left.x) * (point.y - left.y) / (right.y - left.y) + left.x) inside = !inside;
        }
        if (inside) return index;
      }
      return -1;
    }
    return layout.current.rects.findIndex(rect => point.x >= rect.x0 - 3 && point.x <= rect.x1 + 3 && point.y >= rect.y0 - 6 && point.y <= rect.y1 + 4);
  };

  return <>
    <canvas ref={backdropRef} className="om-canvas om-canvas-backdrop" aria-hidden="true" />
    <canvas
      ref={ref}
      className={`om-canvas ${hover >= 0 ? "is-pointer" : ""}`}
      aria-label={french ? "Simulation : onde incidente, milieux, réflexion et transmission. Sélectionnez un milieu dans la liste pour le modifier." : "Simulation: incident wave, media, reflection and transmission. Select a medium in the layer list to edit it."}
      role="img"
      onPointerMove={event => {
        setHover(hit(event));
        const d = drag.current;
        if (d && view === "spatial") {
          const dx = (event.clientX - d.x) / cssZoom();
          const dy = (event.clientY - d.y) / cssZoom();
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) {
            setOrbit(o => ({
              // bounded orbit: the painter's renderer has no backface
              // culling, so free spinning shows mirrored color soup
              az: clamp(o.az + dx * 0.005, -0.35, 1.15),
              el: clamp(o.el + dy * 0.004, 0.15, 0.85),
            }));
            d.x = event.clientX;
            d.y = event.clientY;
          }
        }
      }}
      onPointerLeave={() => { setHover(-1); drag.current = null; }}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerUp={event => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          const index = hit(event);
          if (index >= 0) props.onSelect(index);
        }
      }}
    />
    <div className="om-scene-toolbar" data-view={view} aria-label={french ? "Affichage de la simulation" : "Simulation display"}>
      <div className="om-view-modes" role="group" aria-label={french ? "Vue" : "View"}>
        <button type="button" aria-pressed={view === "wave"} className={view === "wave" ? "is-on" : ""} onClick={() => setView("wave")}>{french ? "Coupe" : "Section"}</button>
        <button type="button" aria-pressed={view === "spatial"} className={view === "spatial" ? "is-on" : ""} onClick={() => setView("spatial")}>Spatial</button>
      </div>
      {view === "wave" && <>
        <div className="om-view-modes" role="group" aria-label={french ? "Dessin des ondes" : "Wave drawing"}>
          {(["field", "fronts", "both"] as const).map(mode => <button key={mode} type="button" aria-pressed={display === mode} className={display === mode ? "is-on" : ""} onClick={() => setDisplay(mode)}>{mode === "field" ? (french ? "Courbes" : "Curves") : mode === "fronts" ? (french ? "Crêtes" : "Crests") : (french ? "Les deux" : "Both")}</button>)}
        </div>
        <label className="om-scene-camera om-field-envelope"><input type="checkbox" checked={reflections} onChange={event => setReflections(event.target.checked)} /><span>{french ? "Reflets internes" : "Internal reflections"}</span></label>
      </>}
      {view === "spatial" && <>
        <div className="om-view-modes" role="group" aria-label={french ? "Visualisation des ondes" : "Wave visualization"}>
          {(["field", "fronts", "both"] as const).map(mode => <button key={mode} type="button" aria-pressed={display === mode} className={display === mode ? "is-on" : ""} onClick={() => setDisplay(mode)}>{mode === "field" ? (french ? "Champ" : "Field") : mode === "fronts" ? (french ? "Fronts" : "Fronts") : (french ? "Les deux" : "Both")}</button>)}
        </div>
        <button type="button" className="om-scene-toggle" onClick={() => setOrbit({ az: 0.45, el: 0.45 })}>{french ? "Recentrer" : "Reset view"}</button>
      </>}
      <button type="button" className="om-scene-toggle" aria-pressed={annotations} onClick={() => setAnnotations(value => !value)}>{french ? "Repères" : "Labels"}</button>
      <button type="button" className="om-scene-toggle om-scene-speed" aria-label={french ? `Vitesse visuelle : ${speed} fois. Changer la vitesse.` : `Visual speed: ${speed} times. Change speed.`} onClick={() => setSpeed(value => value === 0.5 ? 1 : value === 1 ? 2 : 0.5)}>{props.fmtNum(speed, speed === 0.5 ? 1 : 0)}×</button>
      <button
        type="button"
        className="om-scene-toggle"
        title={french ? "Télécharger la scène en image PNG" : "Download the scene as a PNG image"}
        aria-label={french ? "Télécharger la scène en image PNG" : "Download the scene as a PNG image"}
        onClick={() => {
          const canvas = ref.current;
          if (!canvas || canvas.width < 2) return;
          // the live canvases are transparent (stage colour comes from CSS):
          // composite scenery + waves over the stage colour so the file looks
          // like the app, and take the size from the sharper scenery layer
          const scenery = backdropRef.current;
          const out = document.createElement("canvas");
          out.width = Math.max(canvas.width, scenery?.width ?? 0);
          out.height = Math.max(canvas.height, scenery?.height ?? 0);
          const octx = out.getContext("2d");
          if (!octx) return;
          octx.fillStyle = props.pal.bg0;
          octx.fillRect(0, 0, out.width, out.height);
          if (scenery && view === "wave") octx.drawImage(scenery, 0, 0, out.width, out.height);
          octx.drawImage(canvas, 0, 0, out.width, out.height);
          const a = document.createElement("a");
          a.download = `waves-${props.params.freq}GHz-${props.params.theta}deg-${props.params.pol}-${view}.png`;
          a.href = out.toDataURL("image/png");
          a.click();
        }}
      >
        PNG
      </button>
    </div>
  </>;
}

function AngleChart(props: {
  sweep: Sweep;
  pol: PolMode;
  angle: number;
  brewster: number;
  pal: Palette;
  labels: { R: string; T: string };
  onAngle: (a: number) => void;
  fmtNum: (v: number, d?: number) => string;
}) {
  const { sweep, pol, angle, brewster, pal, labels, onAngle, fmtNum } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const xMap = useCallback((a: number) => PAD.l + (a / 90) * (size.w - PAD.l - PAD.r), [size.w]);
  const yMap = useCallback((v: number) => PAD.t + (1 - v) * (size.h - PAD.t - PAD.b), [size.h]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const ctx = prepCanvas(canvas, size);
    if (!ctx) return;
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    drawAxes(
      ctx, w, h, pal,
      [0, 15, 30, 45, 60, 75, 90].map((v) => ({ v, label: `${v}°` })),
      [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, label: `${v * 100}%` })),
      xMap, yMap,
    );
    const xs = sweep.ang.map(xMap);
    const pick = (mode: PolMode) => {
      if (mode === "TE") return { R: sweep.Rte, T: sweep.Tte };
      if (mode === "TM") return { R: sweep.Rtm, T: sweep.Ttm };
      return {
        R: sweep.Rte.map((v, i) => (v + sweep.Rtm[i]) / 2),
        T: sweep.Tte.map((v, i) => (v + sweep.Ttm[i]) / 2),
      };
    };
    const ghosts: PolMode[] = pol === "AVG" ? ["TE", "TM"] : [pol === "TE" ? "TM" : "TE"];
    for (const gm of ghosts) {
      const gd = pick(gm);
      strokeCurve(ctx, xs, gd.R.map(yMap), pal.ref, 1.2, pal, { dash: [3, 4], alpha: 0.4 });
      strokeCurve(ctx, xs, gd.T.map(yMap), pal.tra, 1.2, pal, { dash: [3, 4], alpha: 0.4 });
    }
    const main = pick(pol);
    const base = yMap(0);
    strokeCurve(ctx, xs, main.T.map(yMap), pal.tra, 2.4, pal, { fillTo: base, glow: true });
    strokeCurve(ctx, xs, main.R.map(yMap), pal.ref, 2.4, pal, { fillTo: base, glow: true });

    // Brewster marker (selected layer)
    const bx = xMap(brewster);
    if (brewster >= 0) {
    ctx.save();
    ctx.strokeStyle = withAlpha(pal.acc, 0.8);
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(bx, PAD.t);
    ctx.lineTo(bx, h - PAD.b);
    ctx.stroke();
    ctx.restore();
    pill(ctx, `θB ${fmtNum(brewster, 1)}°`, bx, PAD.t + 12, pal, pal.acc);
    }

    const interp = (arr: number[], a: number) => {
      const i = clamp(a / 0.5, 0, arr.length - 1);
      const i0 = Math.floor(i);
      const i1 = Math.min(arr.length - 1, i0 + 1);
      return arr[i0] + (arr[i1] - arr[i0]) * (i - i0);
    };

    // current angle
    const cxp = xMap(angle);
    ctx.save();
    const lg = ctx.createLinearGradient(0, PAD.t, 0, h - PAD.b);
    lg.addColorStop(0, withAlpha(pal.inc, 0));
    lg.addColorStop(0.5, withAlpha(pal.inc, 0.8));
    lg.addColorStop(1, withAlpha(pal.inc, 0.2));
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cxp, PAD.t);
    ctx.lineTo(cxp, h - PAD.b);
    ctx.stroke();
    ctx.restore();
    dot(ctx, cxp, yMap(interp(main.R, angle)), pal.ref, pal);
    dot(ctx, cxp, yMap(interp(main.T, angle)), pal.tra, pal);

    if (hover !== null) {
      const hx = xMap(hover);
      ctx.save();
      ctx.strokeStyle = pal.gridStrong;
      ctx.beginPath();
      ctx.moveTo(hx, PAD.t);
      ctx.lineTo(hx, h - PAD.b);
      ctx.stroke();
      ctx.restore();
      const rv = interp(main.R, hover);
      const tv = interp(main.T, hover);
      tooltip(ctx, hx, yMap((rv + tv) / 2), w, [
        { text: `θ  ${fmtNum(hover, 1)}°`, color: pal.inc },
        { text: `${labels.R}  ${fmtNum(rv * 100, 1)} %`, color: pal.ref },
        { text: `${labels.T}  ${fmtNum(tv * 100, 1)} %`, color: pal.tra },
      ], pal);
    }
  }, [sweep, pol, angle, brewster, pal, size, hover, xMap, yMap, labels, fmtNum]);

  const angleFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / cssZoom();
    const a = ((x - PAD.l) / Math.max(1, size.w - PAD.l - PAD.r)) * 90;
    return Math.round(clamp(a, 0, 89) * 2) / 2;
  };

  return (
    <canvas
      ref={ref}
      className="om-canvas om-canvas-interactive"
      role="img"
      aria-label="Reflection and transmission versus incidence angle"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onAngle(angleFromEvent(e));
      }}
      onPointerMove={(e) => {
        const a = angleFromEvent(e);
        setHover(a);
        if (dragging.current) onAngle(a);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null);
      }}
    />
  );
}

function FieldChart(props: {
  etas: Cx[];
  ds: number[];
  freq: number;
  angle: number;
  pol: PolMode;
  scaleMode: "lin" | "db";
  pal: Palette;
  bands: { tint: string; label: string; air: boolean }[];
  labels: { air: string };
  fmtNum: (v: number, d?: number) => string;
}) {
  const { etas, ds, freq, angle, pol, scaleMode, pal, bands, labels, fmtNum } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const [hover, setHover] = useState<number | null>(null);

  const domain = useMemo(() => {
    const d = ds.reduce((a, b) => a + b, 0);
    const lam = C0 / (freq * 1e9);
    const air = Math.max(0.5 * d, Math.min(1.5 * lam, 3 * d + 0.02));
    return { d, zMin: -air, zMax: d + air };
  }, [ds, freq]);

  const samples = useMemo(() => {
    const n = Math.max(600, Math.round((size.w || 600) * 5));
    const f = stackFieldAbs(etas, ds, freq, angle * DEG, pol);
    const z: number[] = [];
    const e: number[] = [];
    for (let i = 0; i <= n; i++) {
      const zz = domain.zMin + ((domain.zMax - domain.zMin) * i) / n;
      z.push(zz);
      e.push(f(zz));
    }
    return { z, e, f };
  }, [etas, ds, freq, domain, angle, pol, size.w]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const ctx = prepCanvas(canvas, size);
    if (!ctx) return;
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    const { zMin, zMax, d } = domain;
    const xMap = (z: number) => PAD.l + ((z - zMin) / (zMax - zMin)) * (w - PAD.l - PAD.r);

    const vals = scaleMode === "db"
      ? samples.e.map((v) => Math.max(-80, 20 * Math.log10(Math.max(v, 1e-6))))
      : samples.e;
    const vMax = Math.max(...vals);
    const vMin = Math.min(...vals);
    let yLo: number;
    let yHi: number;
    let yTicks: number[];
    if (scaleMode === "db") {
      yHi = Math.max(10, Math.ceil((vMax + 3) / 10) * 10);
      yLo = Math.min(-20, Math.floor((vMin - 3) / 10) * 10);
      const span = yHi - yLo;
      const st = span > 60 ? 20 : 10;
      yTicks = [];
      for (let v = yLo; v <= yHi + 0.01; v += st) yTicks.push(v);
    } else {
      yLo = 0;
      yHi = Math.max(1.25, Math.ceil(vMax * 1.12 * 4) / 4);
      const st = yHi > 1.6 ? 0.5 : 0.25;
      yTicks = [];
      for (let v = 0; v <= yHi + 1e-9; v += st) yTicks.push(v);
    }
    const yMap = (v: number) => PAD.t + (1 - (v - yLo) / (yHi - yLo)) * (h - PAD.t - PAD.b);

    const N = bands.length;
    const zs = [0];
    ds.forEach((v, k) => zs.push(zs[k] + v));
    const wx0 = xMap(0);
    const wx1 = xMap(d);
    const colorOf = (r: number) =>
      r < 0 ? pal.inc : r >= N ? pal.tra : bands[r].air ? mixHex(pal.inc, pal.tra, 0.5) : pal.abs;
    const regionOf = (z: number) => {
      if (z < 0) return -1;
      if (z >= d) return N;
      let r = 0;
      while (r < N - 1 && z >= zs[r + 1]) r++;
      return r;
    };
    ctx.save();
    bands.forEach((b, k) => {
      const a = xMap(zs[k]);
      const c = xMap(zs[k + 1]);
      const al = b.air ? 0.45 : 1;
      const wg = ctx.createLinearGradient(a, 0, c, 0);
      wg.addColorStop(0, withAlpha(b.tint, (pal.dark ? 0.24 : 0.3) * al));
      wg.addColorStop(1, withAlpha(b.tint, (pal.dark ? 0.1 : 0.16) * al));
      ctx.fillStyle = wg;
      ctx.fillRect(a, PAD.t, Math.max(1, c - a), h - PAD.t - PAD.b);
      ctx.strokeStyle = withAlpha(b.tint, 0.75);
      ctx.lineWidth = 1;
      ctx.setLineDash(b.air ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(Math.round(a) + 0.5, PAD.t);
      ctx.lineTo(Math.round(a) + 0.5, h - PAD.b);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = withAlpha(bands[N - 1]?.tint ?? pal.abs, 0.75);
    ctx.beginPath();
    ctx.moveTo(Math.round(wx1) - 0.5, PAD.t);
    ctx.lineTo(Math.round(wx1) - 0.5, h - PAD.b);
    ctx.stroke();
    ctx.restore();

    // x ticks in cm
    const spanCm = (zMax - zMin) * 100;
    const raw = spanCm / 6;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepCm = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
    const xTicks: { v: number; label: string }[] = [];
    for (let c = Math.ceil((zMin * 100) / stepCm) * stepCm; c <= zMax * 100 + 1e-9; c += stepCm) {
      xTicks.push({ v: c / 100, label: `${fmtNum(c, stepCm < 1 ? 1 : 0)}` });
    }
    drawAxes(
      ctx, w, h, pal, xTicks,
      yTicks.map((v) => ({ v, label: scaleMode === "db" ? `${v}` : fmtNum(v, v % 1 === 0 ? 0 : 2) })),
      xMap, yMap,
    );
    ctx.save();
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = pal.faint;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("z (cm)", w - PAD.r, h - 2);
    ctx.restore();

    // reference |E| = 1
    const yRef = yMap(scaleMode === "db" ? 0 : 1);
    ctx.save();
    ctx.strokeStyle = withAlpha(pal.inc, 0.45);
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(PAD.l, yRef);
    ctx.lineTo(w - PAD.r, yRef);
    ctx.stroke();
    ctx.restore();

    const xs = samples.z.map(xMap);
    const ys = vals.map(yMap);
    // one coloured segment per region (air | layers | air)
    let start = 0;
    let cur = regionOf(samples.z[0]);
    for (let k = 1; k <= xs.length; k++) {
      const r = k < xs.length ? regionOf(samples.z[k]) : Infinity;
      if (r !== cur) {
        const b = Math.min(k, xs.length - 1);
        if (b > start) {
          strokeCurve(ctx, xs.slice(start, b + 1), ys.slice(start, b + 1), colorOf(cur), 1.8, pal, {
            fillTo: yMap(yLo),
            glow: true,
          });
        }
        start = Math.max(0, k - 1);
        cur = r;
      }
    }

    // region labels
    ctx.save();
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = pal.muted;
    ctx.fillText(labels.air, (PAD.l + wx0) / 2, PAD.t + 6);
    ctx.fillText(labels.air, (wx1 + w - PAD.r) / 2, PAD.t + 6);
    bands.forEach((b, k) => {
      const a = xMap(zs[k]);
      const c = xMap(zs[k + 1]);
      if (c - a < 22) return;
      ctx.fillStyle = b.air ? pal.muted : pal.ink;
      ctx.fillText(c - a > 70 ? b.label : `L${k + 1}`, (a + c) / 2, PAD.t + 6);
    });
    ctx.restore();

    if (hover !== null) {
      const z = zMin + ((hover - PAD.l) / (w - PAD.l - PAD.r)) * (zMax - zMin);
      if (z >= zMin && z <= zMax) {
        const v = samples.f(z);
        const yy = scaleMode === "db" ? yMap(Math.max(-80, 20 * Math.log10(Math.max(v, 1e-6)))) : yMap(v);
        ctx.save();
        ctx.strokeStyle = pal.gridStrong;
        ctx.beginPath();
        ctx.moveTo(hover, PAD.t);
        ctx.lineTo(hover, h - PAD.b);
        ctx.stroke();
        ctx.restore();
        const col = colorOf(regionOf(z));
        dot(ctx, hover, yy, col, pal);
        tooltip(ctx, hover, yy, w, [
          { text: `z  ${fmtNum(z * 100, 2)} cm`, color: col },
          { text: `|E|  ${fmtNum(v, 3)}  (${fmtNum(20 * Math.log10(Math.max(v, 1e-9)), 1)} dB)`, color: col },
        ], pal);
      }
    }
  }, [samples, domain, scaleMode, pal, bands, ds, size, hover, labels, fmtNum]);

  return (
    <canvas
      ref={ref}
      className="om-canvas om-canvas-interactive"
      role="img"
      aria-label="Field magnitude profile through the wall"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHover((e.clientX - r.left) / cssZoom());
      }}
      onPointerLeave={() => setHover(null)}
    />
  );
}

/* ════════════════════════════════════════════════════════════════════════
   UI primitives
   ════════════════════════════════════════════════════════════════════════ */

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  log?: boolean;
  unit: string;
  digits: number;
  accent: string;
  onChange: (v: number) => void;
  ticks?: { v: number; label: string; tone?: "acc" }[];
  hint?: ReactNode;
  fmtNum: (v: number, d?: number) => string;
  icon?: ReactNode;
}) {
  const { label, value, min, max, step, log, unit, digits, accent, onChange, ticks, hint, fmtNum, icon } = props;
  const toPos = (v: number) =>
    log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  const fromPos = (p: number) => {
    const v = log ? min * Math.pow(max / min, p) : min + p * (max - min);
    const q = Math.round(v / step) * step;
    return clamp(Number(q.toFixed(6)), min, max);
  };
  const pos = clamp(toPos(value), 0, 1);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(",", "."));
    if (Number.isFinite(v)) onChange(clamp(Number((Math.round(v / step) * step).toFixed(6)), min, max));
    setDraft(null);
  };

  return (
    <div className="om-slider" style={{ "--acc": accent, "--pf": pos } as CSSProperties}>
      <div className="om-slider-head">
        <label className="om-label">
          {icon}
          {label}
        </label>
        <div className="om-value">
          <input
            className="om-value-input"
            inputMode="decimal"
            aria-label={label}
            value={draft ?? fmtNum(value, digits)}
            onFocus={(e) => {
              setDraft(fmtNum(value, digits));
              requestAnimationFrame(() => e.target.select());
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
            style={{ width: `${Math.max(3, (draft ?? fmtNum(value, digits)).length) + 0.5}ch` }}
          />
          <span className="om-unit">{unit}</span>
        </div>
      </div>
      <div className="om-range-wrap">
        <input
          type="range"
          className="om-range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(pos * 1000)}
          aria-label={label}
          aria-valuetext={`${fmtNum(value, digits)} ${unit}`}
          onChange={(e) => onChange(fromPos(Number(e.target.value) / 1000))}
          onKeyDown={(e) => {
            if (log && (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowDown")) {
              e.preventDefault();
              const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : -1;
              onChange(fromPos(clamp(pos + dir * 0.01, 0, 1)));
            }
          }}
        />
        <span className="om-bubble">
          {fmtNum(value, digits)} {unit}
        </span>
      </div>
      {ticks && (
        <div className="om-ticks">
          {ticks.map((t) => (
            <button
              key={`${t.label}-${t.v}`}
              type="button"
              className={`om-tick ${t.tone === "acc" ? "om-tick-acc" : ""} ${Math.abs(t.v - value) < step * 0.75 ? "is-on" : ""}`}
              style={{ left: `${clamp(toPos(t.v), 0, 1) * 100}%` }}
              onClick={() => onChange(clamp(t.v, min, max))}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {hint && <div className="om-hint">{hint}</div>}
    </div>
  );
}

function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode; sub?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel: string;
}) {
  const { value, options, onChange, size = "md", ariaLabel } = props;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className={`om-seg om-seg-${size}`}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--n": options.length, "--i": idx } as CSSProperties}
    >
      <span className="om-seg-thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`om-seg-btn ${o.value === value ? "is-on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          <span className="om-seg-label">{o.label}</span>
          {o.sub && <span className="om-seg-sub">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function Ring({ value, color }: { value: number; color: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg className="om-ring" viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} className="om-ring-track" />
      <circle
        cx="38"
        cy="38"
        r={r}
        className="om-ring-val"
        style={{ stroke: color, strokeDasharray: `${clamp(value, 0, 1) * c} ${c}` }}
      />
    </svg>
  );
}

function Logo() {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <span className="om-logo om-logo-fallback" aria-hidden>
        OM
      </span>
    );
  }
  return <img className="om-logo" src="logo.png" alt="" aria-hidden onError={() => setOk(false)} />;
}

const Icon = {
  play: (
    <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" /></svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden><rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" /></svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>
  ),
  thick: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="18" rx="1.5" /><path d="M3 12h4M17 12h4M5 10l-2 2 2 2M19 10l2 2-2 2" /></svg>
  ),
  freq: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 12c1.5-5 3-5 4.5 0s3 5 4.5 0 2-6 3.5 0 2 6 3.5 0 2-4 4-0" /></svg>
  ),
  angle: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20h16M4 20 16 6" /><path d="M10 20a6 6 0 0 0-1.6-4.2" /></svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" /></svg>
  ),
  pol: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  up: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
  ),
  down: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.1 3.29 9.42 7.86 10.95.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.35.95.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.67.8.56A11.53 11.53 0 0 0 23.5 12C23.5 5.74 18.27.5 12 .5Z" /></svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4.5 7.5 7.5 5.5 7.5-5.5" /></svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17h.01" strokeLinecap="round" /></svg>
  ),
};

function Eq({ tex }: { tex: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import("katex/dist/katex.min.css");
    import("katex").then(({ default: katex }) => {
      if (!alive) return;
      setHtml(katex.renderToString(tex, { throwOnError: false, displayMode: true }));
    });
    return () => {
      alive = false;
    };
  }, [tex]);

  if (!html) return <div className="om-eq om-eq-pending" aria-hidden />;
  return <div className="om-eq" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Stat(props: { label: string; value: string; unit?: string; sub?: string; tone?: string; delay: number }) {
  return (
    <div className="om-stat om-enter" style={{ "--d": `${props.delay}ms`, "--tone": props.tone ?? "var(--om-ink)" } as CSSProperties}>
      <div className="om-stat-label">{props.label}</div>
      <div className="om-stat-value">
        <span>{props.value}</span>
        {props.unit && <small>{props.unit}</small>}
      </div>
      {props.sub && <div className="om-stat-sub">{props.sub}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   App
   ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_STATE: SimState = {
  layers: TEMPLATES.glazing(),
  sel: 0,
  freq: 5,
  angle: 35,
  pol: "TE",
};

const STORAGE_KEY = "onde-mur:v2";
const STORAGE_VERSION = 1;

interface Persisted {
  /** payload version; absent on payloads saved before versioning (treated as v1) */
  v?: number;
  sim: SimState;
  lang: Lang;
  theme: Theme;
}

function defaultPersisted(): Persisted {
  const sysTheme: Theme =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const sysLang: Lang =
    typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
  return { sim: DEFAULT_STATE, lang: sysLang, theme: sysTheme };
}

/** Clamp/validate an untrusted payload (storage or share-link) into shape. */
function sanitizePersisted(p: Partial<Persisted>, fallback: Persisted): Persisted {
  const s = (p.sim ?? {}) as Partial<SimState>;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;
  const layers = Array.isArray(s.layers)
    ? s.layers
        .slice(0, MAX_LAYERS)
        .filter((l) => l && LAYER_MATS.includes(l.mat))
        .map((l) => ({
          id: typeof l.id === "string" && l.id ? l.id : newId(),
          mat: l.mat,
          thickness: num(l.thickness, 0.1, 100, 10),
          eps: num(l.eps, 1, 30, 4),
          sigma: num(l.sigma, 0.0001, 10, 0.05),
          customMode: (l.customMode === "nk" ? "nk" : "eps") as CustomMode,
        }))
    : [];
  const ls = layers.length ? layers : fallback.sim.layers;
  return {
    sim: {
      layers: ls,
      sel: Math.round(num(s.sel, 0, ls.length - 1, 0)),
      freq: num(s.freq, 0.5, 40, fallback.sim.freq),
      angle: num(s.angle, 0, 89, fallback.sim.angle),
      pol: s.pol === "TE" || s.pol === "TM" || s.pol === "AVG" ? s.pol : fallback.sim.pol,
    },
    lang: p.lang === "fr" || p.lang === "en" ? p.lang : fallback.lang,
    theme: p.theme === "dark" || p.theme === "light" ? p.theme : fallback.theme,
  };
}

function loadPersisted(): Persisted {
  const fallback = defaultPersisted();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    // payloads stamped with an unknown future version are rejected outright —
    // silently mis-loading a newer shape would corrupt the simulation state
    if (typeof p.v === "number" && p.v !== STORAGE_VERSION) return fallback;
    return sanitizePersisted(p, fallback);
  } catch {
    return fallback;
  }
}

/** Boot state: a `#s=` share-link wins over saved storage. */
function loadInitial(): Persisted {
  try {
    const hash = shareHashOf(window.location.hash);
    if (hash) {
      const shared = decodeShare(hash);
      if (shared) {
        return sanitizePersisted(
          {
            v: shared.v,
            sim: shared.sim as unknown as SimState,
            lang: shared.lang as Lang,
            theme: shared.theme as Theme,
          },
          defaultPersisted(),
        );
      }
    }
  } catch {
    /* malformed hash — fall through to storage */
  }
  return loadPersisted();
}

function bandName(f: number): string {
  if (f < 1) return "UHF";
  if (f < 2) return "L";
  if (f < 4) return "S";
  if (f < 8) return "C";
  if (f < 12) return "X";
  if (f < 18) return "Ku";
  if (f < 27) return "K";
  return "Ka";
}

/* ── Crash guard: a render error must never leave a blank page ──────────
   Catches anything thrown below it (broken persisted state shapes, canvas
   failures, …) and offers reload + saved-state reset. Self-styled inline so
   it paints even if styles.css failed to load. */
interface BoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("[WaveS] render crash captured:", error);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const fr = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr");
    const reload = () => window.location.reload();
    const reset = () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      window.location.reload();
    };
    const box: CSSProperties = {
      position: "fixed",
      inset: 0,
      zIndex: 10000,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 24,
      textAlign: "center",
      background: "#080e17",
      color: "#edf4fc",
      fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif",
    };
    const btn: CSSProperties = {
      padding: "10px 18px",
      borderRadius: 10,
      border: "1px solid #41536a",
      background: "#142131",
      color: "#edf4fc",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
    };
    return (
      <div style={box} role="alert">
        <div style={{ fontSize: 12, letterSpacing: ".3em", color: "#94a6bc" }}>WAVES</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {fr ? "L'application a rencontré un problème" : "The app ran into a problem"}
        </div>
        <div style={{ fontSize: 13, color: "#b4c3d5", maxWidth: 440 }}>
          {fr
            ? "Vos réglages sauvegardés sont peut-être en cause : réinitialisez-les ou rechargez simplement la page."
            : "Your saved settings may be at fault: reset them or just reload the page."}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" style={btn} onClick={reload}>
            {fr ? "Recharger" : "Reload"}
          </button>
          <button type="button" style={{ ...btn, borderColor: "#55dbf5", color: "#55dbf5" }} onClick={reset}>
            {fr ? "Réinitialiser mes réglages" : "Reset my settings"}
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const initial = useMemo(loadInitial, []);
  const [sim, setSim] = useState<SimState>(initial.sim);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [playing, setPlaying] = useState(true);
  const [fieldScale, setFieldScale] = useState<"lin" | "db">("lin");
  const [flash, setFlash] = useState(0);
  const [present, setPresent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [perfOn, setPerfOn] = useState(() => {
    try {
      return localStorage.getItem("waves:perf") === "1" || new URLSearchParams(window.location.search).get("perf") === "1";
    } catch {
      return false;
    }
  });
  const copyTimer = useRef(0);
  const buildTaps = useRef({ count: 0, at: 0 });
  const presentRef = useRef(present);
  presentRef.current = present;
  const buildInfo = useMemo(() => {
    const ua = navigator.userAgent;
    const android = /Android\s+([\d.]+)/.exec(ua)?.[1];
    const chromium = /(?:Chrome|CriOS)\/(\d+)/.exec(ua)?.[1];
    const engine = chromium ? `${/;\s*wv\)/.test(ua) ? "WebView" : "Chrome"} ${chromium}` : "Web";
    return [`v${__APP_VERSION__}`, __BUILD_SHA__, android ? `Android ${android}` : null, engine].filter(Boolean).join(" · ");
  }, []);
  // true only when entering present mode requested fullscreen itself, so
  // leaving never kicks the user out of a pre-existing (F11) fullscreen
  const fsByUs = useRef(false);

  const setPresentFull = useCallback((on: boolean) => {
    setPresent(on);
    try {
      if (on) {
        if (!document.fullscreenElement) {
          fsByUs.current = true;
          const p = document.documentElement.requestFullscreen() as Promise<void> | undefined;
          if (p && typeof p.catch === "function") p.catch(() => { fsByUs.current = false; });
        }
      } else if (fsByUs.current && document.fullscreenElement) {
        fsByUs.current = false;
        const p = document.exitFullscreen() as Promise<void> | undefined;
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {
      /* fullscreen unavailable — present mode still works windowed */
    }
  }, []);

  const onBuildTap = () => {
    const now = performance.now();
    const taps = buildTaps.current;
    if (now - taps.at > 900) taps.count = 0;
    taps.at = now;
    taps.count += 1;
    if (taps.count < 5) return;
    taps.count = 0;
    setPerfOn((value) => {
      const next = !value;
      try {
        localStorage.setItem("waves:perf", next ? "1" : "0");
      } catch {
        /* storage unavailable: keep the session toggle */
      }
      return next;
    });
  };

  // the browser eats Esc to leave fullscreen first: sync present mode with it
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) {
        fsByUs.current = false;
        setPresent(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const t = DICTS[lang];
  const fmt = useMemo(() => makeFmt(lang), [lang]);
  const pal = PALETTES[theme];

  const update = useCallback(<K extends "freq" | "angle" | "pol">(k: K, v: SimState[K]) => {
    setSim((s) => (s[k] === v ? s : { ...s, [k]: v }));
  }, []);
  const patchLayer = useCallback((patch: Partial<Layer>) => {
    setSim((s) => ({ ...s, layers: s.layers.map((l, i) => (i === s.sel ? { ...l, ...patch } : l)) }));
  }, []);
  const select = useCallback((i: number) => setSim((s) => (s.sel === i ? s : { ...s, sel: i })), []);
  const addLayer = () =>
    setSim((s) => {
      if (s.layers.length >= MAX_LAYERS) return s;
      const layers = [...s.layers];
      layers.splice(s.sel + 1, 0, mkLayer("plasterboard", 1.3));
      return { ...s, layers, sel: s.sel + 1 };
    });
  const dupLayer = (i: number) =>
    setSim((s) => {
      if (s.layers.length >= MAX_LAYERS) return s;
      const layers = [...s.layers];
      layers.splice(i + 1, 0, { ...s.layers[i], id: newId() });
      return { ...s, layers, sel: i + 1 };
    });
  const removeLayer = (i: number) =>
    setSim((s) => {
      if (s.layers.length <= 1) return s;
      const layers = s.layers.filter((_, k) => k !== i);
      return { ...s, layers, sel: clamp(s.sel > i ? s.sel - 1 : s.sel, 0, layers.length - 1) };
    });
  const moveLayer = (i: number, dir: -1 | 1) =>
    setSim((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.layers.length) return s;
      const layers = [...s.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...s, layers, sel: s.sel === i ? j : s.sel === j ? i : s.sel };
    });
  const applyTemplate = (id: TemplateId) => {
    setSim((s) => ({ ...s, layers: TEMPLATES[id](), sel: 0 }));
    setFlash((f) => f + 1);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, sim, lang, theme }));
    } catch {
      /* storage unavailable — state simply isn't persisted */
    }
  }, [sim, lang, theme]);

  // keep the address bar shareable: the URL hash always encodes the current
  // setup, so copying the URL (or the Share button) captures this exact state
  useEffect(() => {
    try {
      window.history.replaceState(null, "", `#s=${encodeShare(sim, lang, theme)}`);
    } catch {
      /* sandboxed/file contexts — sharing still works via the copy button */
    }
  }, [sim, lang, theme]);

  // apply share-links that arrive without a reload (pasted into this tab,
  // back/forward between two shared URLs)
  useEffect(() => {
    const onHash = () => {
      const h = shareHashOf(window.location.hash);
      if (!h) return;
      const shared = decodeShare(h);
      if (!shared) return;
      const next = sanitizePersisted(
        {
          v: shared.v,
          sim: shared.sim as unknown as SimState,
          lang: shared.lang as Lang,
          theme: shared.theme as Theme,
        },
        defaultPersisted(),
      );
      setSim(next.sim);
      setLang(next.lang);
      setTheme(next.theme);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const shareUrl = () =>
    `${window.location.origin}${window.location.pathname}#s=${encodeShare(sim, lang, theme)}`;

  const share = async () => {
    setCopied(await copyText(shareUrl()));
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const downloadBlob = (text: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    downloadFile(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const downloadSweepCsv = () => {
    const sep = lang === "fr" ? ";" : ",";
    const head = ["angle_deg", "R_TE", "T_TE", "R_TM", "T_TM", "R_AVG", "T_AVG"].join(sep);
    const lines = sweep.ang.map((a, i) =>
      [
        fmt.num(a, 1),
        sweep.Rte[i],
        sweep.Tte[i],
        sweep.Rtm[i],
        sweep.Ttm[i],
        (sweep.Rte[i] + sweep.Rtm[i]) / 2,
        (sweep.Tte[i] + sweep.Ttm[i]) / 2,
      ]
        .map((v, k) => (k === 0 ? v : fmt.num(v as number, 6)))
        .join(sep),
    );
    downloadBlob([head, ...lines].join("\n"), `waves-sweep-${sim.freq}GHz-${sim.pol}.csv`);
  };

  const downloadFieldCsv = () => {
    // same z-domain as FieldChart (air margins around the stack), n = 1000
    const d = res.ds.reduce((a, b) => a + b, 0);
    const lam = C0 / (sim.freq * 1e9);
    const air = Math.max(0.5 * d, Math.min(1.5 * lam, 3 * d + 0.02));
    const zMin = -air;
    const zMax = d + air;
    const n = 1000;
    const f = stackFieldAbs(res.etas, res.ds, sim.freq, sim.angle * DEG, sim.pol);
    const sep = lang === "fr" ? ";" : ",";
    const head = ["z_cm", "E_lin", "E_dB"].join(sep);
    const lines: string[] = [];
    for (let i = 0; i <= n; i++) {
      const z = zMin + ((zMax - zMin) * i) / n;
      const v = f(z);
      lines.push(
        [fmt.num(z * 100, 4), fmt.num(v, 6), fmt.num(20 * Math.log10(Math.max(v, 1e-9)), 3)].join(sep),
      );
    }
    downloadBlob([head, ...lines].join("\n"), `waves-field-${sim.freq}GHz-${sim.angle}deg-${sim.pol}.csv`);
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = "WaveS";
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape always works, even when a button is focused (it never
      // activates controls natively, unlike Space/arrows which do)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === "Escape") {
        if (showAbout) setShowAbout(false);
        else if (showHelp) setShowHelp(false);
        else setPresentFull(false);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "?") {
        setShowHelp((v) => !v);
      } else if (e.key === "l" || e.key === "L") {
        setLang((l) => (l === "fr" ? "en" : "fr"));
      } else if (e.key === "t" || e.key === "T") {
        setTheme((th) => (th === "dark" ? "light" : "dark"));
      } else if (e.key === "p" || e.key === "P") {
        setPresentFull(!presentRef.current);
      } else if (e.key === "v" || e.key === "V") {
        window.dispatchEvent(new CustomEvent("waves:set-view", { detail: "toggle" }));
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        window.dispatchEvent(
          new CustomEvent("waves:set-display", { detail: e.key === "1" ? "field" : e.key === "2" ? "fronts" : "both" }),
        );
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = e.key === "ArrowRight" ? 0.5 : -0.5;
        setSim((s) => ({ ...s, angle: clamp(Math.round((s.angle + d) * 2) / 2, 0, 89) }));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSim((s) => ({ ...s, sel: clamp(s.sel + (e.key === "ArrowUp" ? -1 : 1), 0, s.layers.length - 1) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp, showAbout, setPresentFull]);

  const res = useMemo(() => computeResults(sim), [sim]);
  const sweep = useMemo(() => computeStackSweep(res.etas, res.ds, sim.freq), [res.etas, res.ds, sim.freq]);

  const selL = sim.layers[sim.sel] ?? sim.layers[0];
  const selR = res.layers[sim.sel] ?? res.layers[0];
  const selDef = selL.mat === "air" || selL.mat === "custom" ? null : MATERIALS[selL.mat];
  const matName = (m: LayerMat) => t.materials[m];

  const sceneParams: SceneParams = {
    etas: res.etas,
    ds: res.ds,
    theta: sim.angle,
    R: res.R,
    T: res.T,
    layers: sim.layers.map((l, i) => ({
      mat: l.mat,
      cm: l.thickness,
      thetaT: res.layers[i].thetaT,
      nRe: res.layers[i].nRe,
      absorbed: res.layers[i].absorbed,
      fluxIn: res.layers[i].fluxIn,
      fluxOut: i + 1 < sim.layers.length ? res.layers[i + 1].fluxIn : res.T,
      name: matName(l.mat),
    })),
    sel: sim.sel,
    hover: -1,
    freq: sim.freq,
    pol: sim.pol,
    labels: { normal: t.normal, tx: "Tx", rx: "Rx", refl: t.reflShort },
  };

  const bands = useMemo(
    () => sim.layers.map((l) => ({ tint: matTint(l.mat), label: matName(l.mat).toUpperCase(), air: l.mat === "air" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sim.layers, lang],
  );

  const applyPreset = (key: string) => {
    let next: SimState;
    switch (key) {
      case "wifi24":
        next = { ...sim, layers: TEMPLATES.cavity(), sel: 0, freq: 2.4, angle: 0, pol: "AVG" };
        break;
      case "wifi5":
        next = { ...sim, layers: TEMPLATES.partition(), sel: 0, freq: 5.5, angle: 30, pol: "AVG" };
        break;
      case "lte":
        next = { ...sim, layers: TEMPLATES.plastered(), sel: 1, freq: 3.5, angle: 20, pol: "TE" };
        break;
      case "mmw":
        next = { ...sim, layers: TEMPLATES.glazing(), sel: 0, freq: 28, angle: 45, pol: "AVG" };
        break;
      default: {
        const base: SimState = { ...sim, layers: [mkLayer("glass", 1)], sel: 0, freq: 5, pol: "TM" };
        const b = computeResults(base).layers[0].brewster;
        next = { ...base, angle: Math.round(b * 2) / 2 };
      }
    }
    setSim(next);
    setFlash((f) => f + 1);
  };

  const freqHint = (
    <>
      <span className="om-chip-mini">{bandName(sim.freq)}</span>
      λ₀ = {fmt.len(res.lambda0)}
    </>
  );

  const rangeNote =
    selL.mat === "air"
      ? t.airNote
      : selDef
        ? selR.inRange
          ? tpl(t.inRange, { a: fmt.sig(selDef.fMin), b: fmt.sig(selDef.fMax) })
          : tpl(t.outOfRange, { a: fmt.sig(selDef.fMin), b: fmt.sig(selDef.fMax) })
        : t.customRange;
  const formula =
    selL.mat === "air"
      ? "ε′ = 1 · σ = 0"
      : selDef
        ? `ε′ = ${fmt.sig(selDef.a, 4)} · σ = ${fmt.sig(selDef.c, 4)}·f^${fmt.sig(selDef.d, 4)} S/m`
        : `ε′ = ${fmt.sig(selL.eps, 4)} · σ = ${fmt.sig(selL.sigma, 3)} S/m`;

  const polLabel = sim.pol === "AVG" ? t.avg : sim.pol;
  const full = sim.layers.length >= MAX_LAYERS;

  const setMaterial = (m: LayerMat) => {
    if (m === selL.mat) return;
    if (m === "custom") {
      const cur = layerEpsSigma(selL, sim.freq);
      patchLayer({ mat: m, eps: clamp(Number(cur.epsR.toFixed(2)), 1, 30), sigma: clamp(Number(cur.sigma.toPrecision(3)), 0.0001, 10) });
    } else patchLayer({ mat: m });
  };

  return (
    <div className="om" data-theme={theme} data-present={present ? "true" : "false"}>

      <header className="om-top om-enter" style={{ "--d": "0ms" } as CSSProperties}>
        <div className="om-brand">
          <Logo />
          <div className="om-brand-text">
            <span className="om-school">{t.school}</span>
            <h1>WaveS</h1>
            <p>
              {t.madeBy} <strong>{t.author}</strong>
              <span className="om-dot-sep" />
              <span className="om-brand-tag">{t.sub}</span>
            </p>
          </div>
        </div>
        <div className="om-top-actions">
          <Segmented<Lang>
            size="sm"
            ariaLabel={t.language}
            value={lang}
            onChange={setLang}
            options={[
              { value: "fr", label: "FR" },
              { value: "en", label: "EN" },
            ]}
          />
          <a
            className="om-icon-btn om-icon-link"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.repo}
            title={t.repoTitle}
          >
            {Icon.github}
          </a>
          <button
            type="button"
            className="om-icon-btn"
            aria-label={t.about}
            title={t.about}
            onClick={() => setShowAbout(true)}
          >
            {Icon.info}
          </button>
          <button
            type="button"
            className="om-icon-btn"
            aria-label={t.theme}
            title={t.theme}
            onClick={() => setTheme((th) => (th === "dark" ? "light" : "dark"))}
          >
            <span className={`om-swap ${theme === "dark" ? "is-a" : "is-b"}`}>
              <span>{Icon.moon}</span>
              <span>{Icon.sun}</span>
            </span>
          </button>
          <button
            type="button"
            className={`om-presentbtn ${copied ? "is-on" : ""}`}
            onClick={share}
            title={t.shareTitle}
          >
            {copied ? t.copied : t.share}
          </button>
          <button
            type="button"
            className={`om-presentbtn ${present ? "is-on" : ""}`}
            onClick={() => setPresentFull(!presentRef.current)}
            aria-pressed={present}
            title={present ? t.exitPresent : t.present}
          >
            {present ? t.exitPresent : t.present}
          </button>
          <button
            type="button"
            className={`om-play ${playing ? "is-playing" : ""}`}
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            <span className={`om-swap ${playing ? "is-b" : "is-a"}`}>
              <span>{Icon.play}</span>
              <span>{Icon.pause}</span>
            </span>
            <span className="om-play-label">{playing ? t.pause : t.play}</span>
          </button>
        </div>
      </header>

      <main className="om-layout">
        {/* ───────── Scene ───────── */}
        <section className="om-card om-scene om-enter" style={{ "--d": "60ms" } as CSSProperties}>
          <RayScene params={sceneParams} pal={pal} playing={playing} lang={lang} fmtNum={fmt.num} onSelect={select} />
          <div className="om-hud om-hud-tl">
            <span className="om-hud-chip">
              <span className="om-stackdots">
                {sim.layers.map((l) => (
                  <i key={l.id} style={{ background: matSwatch(l.mat) }} />
                ))}
              </span>
              {tpl(sim.layers.length > 1 ? t.layersN : t.layer1, { n: String(sim.layers.length) })}
            </span>
            <span className="om-hud-chip om-mono">{fmt.num(sim.freq, sim.freq < 10 ? 2 : 1)} GHz</span>
            <span className="om-hud-chip om-mono">{polLabel}</span>
          </div>
          <div className="om-hud om-hud-tr">
            <div className="om-hud-big" style={{ "--tone": "var(--om-ref)" } as CSSProperties}>
              <span className="om-hud-k">R</span>
              <span className="om-hud-v">{fmt.pct(res.R)}<small>%</small></span>
            </div>
            <div className="om-hud-big" style={{ "--tone": "var(--om-tra)" } as CSSProperties}>
              <span className="om-hud-k">T</span>
              <span className="om-hud-v">{fmt.pct(res.T)}<small>%</small></span>
            </div>
          </div>
          <div className="om-hud om-hud-bl">
            <span className="om-leg"><i style={{ background: "var(--om-inc)" }} />{t.incident}</span>
            <span className="om-leg"><i style={{ background: "var(--om-ref)" }} />{t.reflected}</span>
            <span className="om-leg"><i style={{ background: "var(--om-tra)" }} />{t.transmitted}</span>
            {res.A > 0.005 && <span className="om-leg"><i style={{ background: "var(--om-abs)" }} />{t.absorbed}</span>}
          </div>
          <div className="om-hud om-hud-br"><span className="om-hint">{t.clickLayer}</span></div>
          {!playing && <div className="om-paused-badge">{t.pause}</div>}
        </section>

        <div className="om-presentbar" aria-hidden={present ? undefined : true}>
          <div className="om-presentbar-group">
            <span className="om-presentbar-label om-mono">{fmt.num(sim.freq, 2)} GHz</span>
            <input
              type="range" className="om-range om-presentbar-range" min={0.5} max={40} step={0.1}
              value={sim.freq} aria-label={t.frequency}
              style={{ "--pf": Math.min(1, Math.max(0, (sim.freq - 0.5) / 39.5)) } as CSSProperties}
              onChange={(e) => update("freq", Number(e.target.value))} />
          </div>
          <div className="om-presentbar-group">
            <span className="om-presentbar-label om-mono">θ {fmt.num(sim.angle, 1)}°</span>
            <input
              type="range" className="om-range om-presentbar-range" min={0} max={89} step={0.5}
              value={sim.angle} aria-label={t.angle}
              style={{ "--pf": sim.angle / 89 } as CSSProperties}
              onChange={(e) => update("angle", Number(e.target.value))} />
          </div>
          <Segmented<PolMode>
            size="sm"
            ariaLabel={t.polarization}
            value={sim.pol}
            onChange={(v) => update("pol", v)}
            options={[
              { value: "TE", label: "TE" },
              { value: "TM", label: "TM" },
              { value: "AVG", label: t.avg },
            ]}
          />
          <button
            type="button"
            className={`om-play ${playing ? "is-playing" : ""}`}
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            <span className="om-play-label">{playing ? t.pause : t.play}</span>
          </button>
        </div>

        {/* ───────── Controls ───────── */}
        <aside className="om-card om-controls om-enter" style={{ "--d": "120ms" } as CSSProperties}>
          <div className="om-insp-h">
            {Icon.freq}
            {t.tabWave}
          </div>
            <div className="om-tabpanel" key="wave">
              <div className="om-group">
                <Slider label={t.frequency} icon={Icon.freq} value={sim.freq} min={0.5} max={40} step={0.01} log unit="GHz"
                  digits={2} accent="var(--om-inc)" onChange={(v) => update("freq", v)} fmtNum={fmt.num} hint={freqHint}
                  ticks={[0.5, 1, 2.4, 5, 10, 28, 40].map((v) => ({ v, label: fmt.sig(v) }))} />
              </div>
              <div className="om-group">
                <Slider label={t.angle} icon={Icon.angle} value={sim.angle} min={0} max={89} step={0.5} unit="°" digits={1}
                  accent="var(--om-ref)" onChange={(v) => update("angle", v)} fmtNum={fmt.num}
                  ticks={[
                    { v: 0, label: "0" },
                    { v: 30, label: "30" },
                    { v: 60, label: "60" },
                    { v: 89, label: "89" },
                    ...(Number.isFinite(selR.brewster) ? [{ v: Math.round(selR.brewster * 2) / 2, label: "θB", tone: "acc" as const }] : []),
                  ]} />
                {Number.isFinite(selR.brewster) && (
                  <div className="om-presets" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="om-preset"
                      title={sim.pol === "TM" ? t.brewsterJumpTitle : t.brewsterNa}
                      disabled={sim.pol !== "TM"}
                      style={sim.pol !== "TM" ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                      onClick={() => update("angle", Math.round(selR.brewster * 2) / 2)}
                    >
                      {t.brewsterJump} · {fmt.num(Math.round(selR.brewster * 2) / 2, 1)}°
                    </button>
                  </div>
                )}
              </div>
              <div className="om-group">
                <div className="om-label om-label-row">
                  {Icon.pol}
                  {t.polarization}
                </div>
                <Segmented<PolMode>
                  ariaLabel={t.polarization}
                  value={sim.pol}
                  onChange={(v) => update("pol", v)}
                  options={[
                    { value: "TE", label: "TE", sub: t.teHint },
                    { value: "TM", label: "TM", sub: t.tmHint },
                    { value: "AVG", label: t.avg, sub: t.avgHint },
                  ]}
                />
              </div>
              <div className="om-group">
                <div className="om-label om-label-row">
                  {Icon.spark}
                  {t.presets}
                </div>
                <div className="om-presets">
                  {Object.keys(t.presetNames).map((k) => (
                    <button key={k} type="button" className="om-preset" onClick={() => applyPreset(k)}>
                      {t.presetNames[k]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          <div className="om-insp-h">
            {Icon.layers}
            {t.tabStack}
            <span className="om-count">{sim.layers.length}</span>
          </div>
            <div className="om-tabpanel" key="stack">
              <div className="om-group">
                <div className="om-label om-label-row om-label-split">
                  <span>{t.stack}</span>
                  <span className="om-mono om-faint">{fmt.num(res.totalCm, res.totalCm < 10 ? 2 : 1)} cm · {sim.layers.length}/{MAX_LAYERS}</span>
                </div>
                <div className="om-strip" aria-hidden>
                  <span className="om-strip-air">{t.airShort}</span>
                  {sim.layers.map((l, i) => (
                    <span
                      key={l.id}
                      className={`om-strip-seg ${i === sim.sel ? "is-on" : ""} ${l.mat === "air" ? "is-air" : ""}`}
                      style={{ flexGrow: Math.max(0.6, Math.sqrt(l.thickness)), background: matSwatch(l.mat) }}
                      onClick={() => select(i)}
                    />
                  ))}
                  <span className="om-strip-air">{t.airShort}</span>
                </div>
                <ol className="om-layers">
                  {sim.layers.map((l, i) => {
                    const r = res.layers[i];
                    const on = i === sim.sel;
                    return (
                      <li key={l.id} className={`om-layer ${on ? "is-on" : ""}`} style={{ "--tint": matTint(l.mat) } as CSSProperties}>
                        <button type="button" className="om-layer-main" onClick={() => select(i)} aria-pressed={on}>
                          <span className="om-layer-idx">{i + 1}</span>
                          <span className="om-layer-sw" style={{ background: matSwatch(l.mat) }} />
                          <span className="om-layer-txt">
                            <b>{matName(l.mat)}</b>
                            <small className="om-mono">
                              {fmt.num(l.thickness, l.thickness < 1 ? 2 : 1)} cm · ε′ {fmt.num(r.epsR, 2)} · A {fmt.pct(r.absorbed)}%
                            </small>
                          </span>
                        </button>
                        <span className="om-layer-actions">
                          <button type="button" aria-label={t.moveUp} title={t.moveUp} disabled={i === 0} onClick={() => moveLayer(i, -1)}>{Icon.up}</button>
                          <button type="button" aria-label={t.moveDown} title={t.moveDown} disabled={i === sim.layers.length - 1} onClick={() => moveLayer(i, 1)}>{Icon.down}</button>
                          <button type="button" aria-label={t.duplicate} title={t.duplicate} disabled={full} onClick={() => dupLayer(i)}>{Icon.copy}</button>
                          <button type="button" aria-label={t.remove} title={t.remove} disabled={sim.layers.length <= 1} onClick={() => removeLayer(i)} className="is-danger">{Icon.trash}</button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <button type="button" className="om-add" onClick={addLayer} disabled={full}>
                  {Icon.plus}
                  {full ? tpl(t.maxLayers, { n: String(MAX_LAYERS) }) : t.addLayer}
                </button>
                <div className="om-templates">
                  {(Object.keys(TEMPLATES) as TemplateId[]).map((k) => (
                    <button key={k} type="button" className="om-preset" onClick={() => applyTemplate(k)}>
                      {t.templateNames[k]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="om-group om-editor" key={selL.id} style={{ "--tint": matTint(selL.mat) } as CSSProperties}>
                <div className="om-label om-label-row om-label-split">
                  <span>
                    <span className="om-layer-idx is-sm">{sim.sel + 1}</span>
                    {t.editing}
                  </span>
                  <span className="om-mono om-faint">{matName(selL.mat)}</span>
                </div>
                <div className="om-materials" role="radiogroup" aria-label={t.material}>
                  {LAYER_MATS.map((id) => {
                    const eps = id === "air" ? 1 : materialProps(id, sim.freq, selL.eps, selL.sigma).epsR;
                    const on = selL.mat === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`om-mat ${on ? "is-on" : ""} ${id === "custom" ? "is-wide" : ""}`}
                        onClick={() => setMaterial(id)}
                      >
                        <span className="om-mat-swatch" style={{ background: matSwatch(id) }} />
                        <span className="om-mat-name">{matName(id)}</span>
                        <span className="om-mat-eps">ε′ {fmt.num(eps, 2)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className={`om-collapse ${selL.mat === "custom" ? "is-open" : ""}`}>
                  <div className="om-collapse-inner">
                    <div className="om-custom">
                      <Segmented<CustomMode>
                        size="sm"
                        ariaLabel={t.epsCustom}
                        value={selL.customMode}
                        onChange={(v) => patchLayer({ customMode: v })}
                        options={[
                          { value: "eps", label: t.modeEps },
                          { value: "nk", label: t.modeNK },
                        ]}
                      />
                      {selL.customMode === "nk" ? (
                        <>
                          <Slider label="n" value={nkOf(selL.eps, selL.sigma, sim.freq).n} min={1} max={8} step={0.01} unit="" digits={3}
                            accent="var(--om-acc)" onChange={(v) => {
                              const k = nkOf(selL.eps, selL.sigma, sim.freq).k;
                              const c = epsSigmaOfNK(v, k, sim.freq);
                              patchLayer({ eps: clamp(Number(c.eps.toFixed(3)), 1, 30), sigma: Math.max(0, Number(c.sigma.toPrecision(3))) });
                            }} fmtNum={fmt.num} />
                          <Slider label="κ" value={nkOf(selL.eps, selL.sigma, sim.freq).k} min={0} max={3} step={0.001} unit="" digits={3}
                            accent="var(--om-acc)" onChange={(v) => {
                              const n = nkOf(selL.eps, selL.sigma, sim.freq).n;
                              const c = epsSigmaOfNK(n, v, sim.freq);
                              patchLayer({ eps: clamp(Number(c.eps.toFixed(3)), 1, 30), sigma: Math.max(0, Number(c.sigma.toPrecision(3))) });
                            }} fmtNum={fmt.num}
                            ticks={[
                              { v: 0, label: "0" },
                              { v: 0.01, label: "10⁻²" },
                              { v: 0.1, label: fmt.sig(0.1) },
                              { v: 1, label: "1" },
                            ]} />
                          <div className="om-hint"><span className="om-mono">ε′ {fmt.num(selL.eps, 2)} · σ {fmt.sig(selL.sigma, 3)} S/m</span></div>
                        </>
                      ) : (
                        <>
                          <Slider label={t.epsCustom} value={selL.eps} min={1} max={30} step={0.01} unit="" digits={2}
                            accent="var(--om-acc)" onChange={(v) => patchLayer({ eps: v })} fmtNum={fmt.num} />
                          <Slider label={t.sigmaCustom} value={selL.sigma} min={0.0001} max={10} step={0.0001} log unit="S/m" digits={4}
                            accent="var(--om-acc)" onChange={(v) => patchLayer({ sigma: v })} fmtNum={fmt.num}
                            ticks={[
                              { v: 0.001, label: "10⁻³" },
                              { v: 0.01, label: "10⁻²" },
                              { v: 0.1, label: fmt.sig(0.1) },
                              { v: 1, label: "1" },
                            ]} />
                          <div className="om-hint"><span className="om-mono">n {fmt.num(nkOf(selL.eps, selL.sigma, sim.freq).n, 3)} · κ {fmt.sig(nkOf(selL.eps, selL.sigma, sim.freq).k, 3)}</span></div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Slider label={t.thickness} icon={Icon.thick} value={selL.thickness} min={0.1} max={100} step={0.01} log unit="cm"
                  digits={2} accent="var(--om-abs)" onChange={(v) => patchLayer({ thickness: v })} fmtNum={fmt.num}
                  ticks={[0.1, 0.4, 1, 5, 20, 100].map((v) => ({ v, label: fmt.sig(v) }))} />
                <div className={`om-note ${selR.inRange ? "" : "is-warn"}`}>
                  <span className="om-note-icon">{selR.inRange ? Icon.info : Icon.warn}</span>
                  <span>
                    <span className="om-mono om-formula">{formula}</span>
                    <span className="om-note-text">{rangeNote}</span>
                  </span>
                </div>
                </div>
              </div>
          <button
            type="button"
            className="om-reset"
            onClick={() => {
              try {
                window.localStorage.removeItem(STORAGE_KEY);
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
          >
            {t.reset}
          </button>
        </aside>

        {/* ───────── Results ───────── */}
        <section className="om-results" key={`flash-${flash}`}>
          <div className="om-card om-hero om-enter" style={{ "--d": "180ms", "--tone": "var(--om-ref)" } as CSSProperties}>
            <Ring value={res.R} color="var(--om-ref)" />
            <div>
              <div className="om-hero-label">{t.reflected} · R</div>
              <div className="om-hero-value">
                {fmt.pct(res.R)}
                <small>%</small>
              </div>
              <div className="om-hero-sub om-mono">{fmt.num(res.RdB, 2)} dB</div>
            </div>
          </div>
          <div className="om-card om-hero om-enter" style={{ "--d": "230ms", "--tone": "var(--om-tra)" } as CSSProperties}>
            <Ring value={res.T} color="var(--om-tra)" />
            <div>
              <div className="om-hero-label">{t.transmitted} · T</div>
              <div className="om-hero-value">
                {fmt.pct(res.T)}
                <small>%</small>
              </div>
              <div className="om-hero-sub om-mono">{res.TdB < -150 ? "< −150" : fmt.num(res.TdB, 2)} dB</div>
            </div>
          </div>
          <div className="om-card om-budget om-enter" style={{ "--d": "280ms" } as CSSProperties}>
            <div className="om-budget-head">
              <span className="om-hero-label">{t.energy}</span>
              <span className="om-budget-note om-mono">{t.energyNote}</span>
            </div>
            <div className="om-bar" role="img" aria-label={`R ${fmt.pct(res.R)}%, A ${fmt.pct(res.A)}%, T ${fmt.pct(res.T)}%`}>
              <span style={{ width: `${res.R * 100}%`, background: "var(--om-ref)" }} />
              {res.layers.map((r, i) => (
                <span
                  key={sim.layers[i].id}
                  className="om-bar-abs"
                  title={`${i + 1} · ${matName(sim.layers[i].mat)} · ${fmt.pct(r.absorbed)} %`}
                  style={{ width: `${r.absorbed * 100}%`, "--tint": matTint(sim.layers[i].mat) } as CSSProperties}
                />
              ))}
              <span style={{ width: `${res.T * 100}%`, background: "var(--om-tra)" }} />
            </div>
            <div className="om-budget-legend">
              <div><i style={{ background: "var(--om-ref)" }} />{t.reflected}<b>{fmt.pct(res.R)} %</b></div>
              <div><i style={{ background: "var(--om-abs)" }} />{t.absorbed}<b>{fmt.pct(res.A)} %</b></div>
              <div><i style={{ background: "var(--om-tra)" }} />{t.transmitted}<b>{fmt.pct(res.T)} %</b></div>
            </div>
            {sim.layers.length > 1 && (
              <div className="om-budget-layers">
                {res.layers.map((r, i) => (
                  <button key={sim.layers[i].id} type="button" className={i === sim.sel ? "is-on" : ""} onClick={() => select(i)}
                    style={{ "--tint": matTint(sim.layers[i].mat) } as CSSProperties}>
                    <i />
                    <span>{i + 1} · {matName(sim.layers[i].mat)}</span>
                    <b className="om-mono">{fmt.pct(r.absorbed)} %</b>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="om-stats">
            <div className="om-stats-head">
              <span className="om-layer-idx is-sm" style={{ "--tint": matTint(selL.mat) } as CSSProperties}>{sim.sel + 1}</span>
              {tpl(t.statsFor, { m: matName(selL.mat), d: fmt.num(selL.thickness, selL.thickness < 1 ? 2 : 1) })}
            </div>
            <Stat delay={320} label={t.thetaT} value={fmt.num(selR.thetaT, 1)} unit="°" tone="var(--om-tra)"
              sub={tpl(t.thetaTSub, { v: fmt.num(sim.angle, 1) })} />
            <Stat delay={350} label={t.brewster} value={Number.isFinite(selR.brewster) ? fmt.num(selR.brewster, 1) : "—"} unit="°" tone="var(--om-acc)"
              sub={selL.mat === "air" ? t.airNote : tpl(t.brewsterSub, { v: fmt.num(selR.brewsterLossless, 1) })} />
            <details className="om-more">
              <summary>{t.moreProps}</summary>
              <div className="om-more-grid">
            <Stat delay={380} label={t.epsR} value={fmt.num(selR.epsR, 3)} sub={tpl(t.epsRSub, { v: fmt.sig(selR.epsI, 3) })} />
            <Stat delay={410} label={t.sigma} value={fmt.sig(selR.sigma, 3)} unit="S/m"
              sub={selDef ? `${fmt.sig(selDef.c, 4)} · f^${fmt.sig(selDef.d, 4)}` : selL.mat === "air" ? t.airNote : t.customRange} />
            <Stat delay={440} label={t.tanD} value={fmt.sig(selR.tanD, 3)} sub={t.tanDSub} tone="var(--om-abs)" />
            <Stat delay={470} label={t.atten} value={fmt.sig(selR.alphaDbM, 3)} unit="dB/m" tone="var(--om-abs)"
              sub={tpl(t.attenSub, { v: fmt.sig(selR.lossDb, 3) })} />
              </div>
            </details>
            <Stat delay={500} label={t.tdb} value={res.TdB < -150 ? "< −150" : fmt.num(res.TdB, 2)} unit="dB" tone="var(--om-tra)"
              sub={tpl(t.tdbSub, { v: fmt.num(res.RdB, 2) })} />
            <Stat delay={530} label={t.index} value={fmt.num(selR.nRe, 3)} tone="var(--om-inc)"
              sub={tpl(t.indexSub, { a: fmt.len(selR.lambda), b: fmt.len(res.lambda0) })} />
          </div>
        </section>

        {/* ───────── Charts ───────── */}
        <section className="om-charts">
          <div className="om-card om-chart om-enter" style={{ "--d": "380ms" } as CSSProperties}>
            <div className="om-chart-head">
              <div>
                <h2>{t.chartAngle}</h2>
                <p>{t.chartAngleHint}</p>
              </div>
              <div className="om-chart-legend">
                <span className="om-leg"><i style={{ background: "var(--om-ref)" }} />R</span>
                <span className="om-leg"><i style={{ background: "var(--om-tra)" }} />T</span>
                <span className="om-leg om-leg-dash"><i />{sim.pol === "AVG" ? "TE / TM" : sim.pol === "TE" ? "TM" : "TE"}</span>
                <button type="button" className="om-scene-toggle" title={t.exportCsvTitle} onClick={downloadSweepCsv}>
                  {t.exportCsv}
                </button>
              </div>
            </div>
            <div className="om-chart-body">
              <AngleChart
                sweep={sweep}
                pol={sim.pol}
                angle={sim.angle}
                brewster={Number.isFinite(selR.brewster) ? selR.brewster : -1}
                pal={pal}
                labels={{ R: "R", T: "T" }}
                onAngle={(a) => update("angle", a)}
                fmtNum={fmt.num}
              />
            </div>
          </div>
          <div className="om-card om-chart om-enter" style={{ "--d": "440ms" } as CSSProperties}>
            <div className="om-chart-head">
              <div>
                <h2>{t.chartField}</h2>
                <p>{t.chartFieldHint} · {polLabel}</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Segmented<"lin" | "db">
                  size="sm"
                  ariaLabel="Scale"
                  value={fieldScale}
                  onChange={setFieldScale}
                  options={[
                    { value: "lin", label: t.linear },
                    { value: "db", label: t.db },
                  ]}
                />
                <button type="button" className="om-scene-toggle" title={t.exportCsvTitle} onClick={downloadFieldCsv}>
                  {t.exportCsv}
                </button>
              </div>
            </div>
            <div className="om-chart-body">
              <FieldChart
                etas={res.etas}
                ds={res.ds}
                freq={sim.freq}
                angle={sim.angle}
                pol={sim.pol}
                scaleMode={fieldScale}
                pal={pal}
                bands={bands}
                labels={{ air: t.air }}
                fmtNum={fmt.num}
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="om-foot">
        <p>{t.model}</p>
        <p className="om-kbd">{t.shortcuts}</p>
      </footer>

      {showHelp && (
        <div className="om-help-backdrop" onClick={() => setShowHelp(false)}>
          <div
            className="om-help"
            role="dialog"
            aria-modal="true"
            aria-label={t.helpTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="om-help-head">
              <h2>{t.helpTitle}</h2>
              <button type="button" className="om-scene-toggle" onClick={() => setShowHelp(false)} autoFocus>
                {t.helpClose}
              </button>
            </div>
            <ul>
              {(
                [
                  ["Space", t.scPlay],
                  ["← →", t.scAngle],
                  ["↑ ↓", t.scLayer],
                  ["V", t.scView],
                  ["1 2 3", t.scDisplay],
                  ["P", t.present],
                  ["L", t.language],
                  ["T", t.theme],
                  ["?", t.scHelp],
                  ["Esc", t.exitPresent],
                ] as Array<[string, string]>
              ).map(([key, label]) => (
                <li key={key}>
                  <kbd>{key}</kbd>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showAbout && (
        <div className="om-help-backdrop" onClick={() => setShowAbout(false)}>
          <div
            className="om-about"
            role="dialog"
            aria-modal="true"
            aria-label={t.aboutTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="om-about-head">
              <span className="om-about-mark">
                <Logo />
              </span>
              <div className="om-about-id">
                <span className="om-about-kicker">{t.school}</span>
                <h2>WaveS</h2>
                <p>{t.tagline}</p>
              </div>
              <button
                type="button"
                className="om-about-close"
                aria-label={t.helpClose}
                title={t.helpClose}
                onClick={() => setShowAbout(false)}
                autoFocus
              >
                ×
              </button>
            </div>

            <div className="om-about-body">
              <div className="om-about-grid">
                <div className="om-about-cell">
                  <span className="om-about-label">{t.authorLabel}</span>
                  <strong>{t.author}</strong>
                </div>
                <div className="om-about-cell">
                  <span className="om-about-label">{t.schoolLabel}</span>
                  <strong>{t.school}</strong>
                </div>
              </div>

              <div className="om-about-block">
                <span className="om-about-label">{t.contactLabel}</span>
                <div className="om-mails">
                  {CONTACT_EMAILS.map((c) => (
                    <a key={c.address} className="om-mail" href={`mailto:${c.address}`} title={t.contactTitle}>
                      <span className="om-mail-icon">{Icon.mail}</span>
                      <span className="om-mail-addr">{c.address}</span>
                      <span className="om-mail-tag">{t[c.labelKey]}</span>
                    </a>
                  ))}
                </div>
              </div>

              <div className="om-model">
                <div className="om-model-head">
                  <span className="om-about-label">{t.modelLabel}</span>
                  <span className="om-model-ref">ITU-R P.2040 § 3</span>
                </div>
                <Eq tex={String.raw`\eta = \varepsilon' - j\,\frac{17.98\,\sigma}{f}`} />
                <Eq tex={String.raw`n_1 \sin\theta_1 = n_2 \sin\theta_2`} />
                <Eq tex={String.raw`r = \frac{\eta_2 \cos\theta_1 - \eta_1 \cos\theta_2}{\eta_2 \cos\theta_1 + \eta_1 \cos\theta_2}`} />
                <p className="om-model-note">{t.modelNote}</p>
              </div>

              <a className="om-about-repo" href={REPO_URL} target="_blank" rel="noopener noreferrer" title={t.repoTitle}>
                {Icon.github}
                <span>{t.repo}</span>
              </a>
              <button type="button" className="om-about-build" onClick={onBuildTap} title={buildInfo}>
                {buildInfo}
              </button>
              <label className="om-about-perf">
                <input
                  type="checkbox"
                  checked={perfOn}
                  onChange={(event) => {
                    const next = event.currentTarget.checked;
                    setPerfOn(next);
                    try {
                      localStorage.setItem("waves:perf", next ? "1" : "0");
                    } catch {
                      /* storage unavailable: keep the session toggle */
                    }
                  }}
                />
                <span>{lang === "fr" ? "HUD de performance" : "Performance HUD"}</span>
              </label>
            </div>
          </div>
        </div>
      )}
      <PerfHud enabled={perfOn} />
    </div>
  );
}

export default App;
