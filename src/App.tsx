import {
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
  shortcuts: "Space play/pause · ↑↓ layer · L language · T theme",
  theme: "Toggle theme",
  language: "Language",
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
  shortcuts: "Espace lecture/pause · ↑↓ couche · L langue · T thème",
  theme: "Changer de thème",
  language: "Langue",
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
    inc: "#006b86",
    ref: "#b04438",
    tra: "#087453",
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

/* Canvas palette is resolved from the CSS theme variables once per theme
   change so the canvases and the DOM share one source of truth.
   PALETTES remains the fallback (first paint / no DOM). */
function readCssPalette(theme: Theme): Palette {
  const base = PALETTES[theme];
  if (typeof window === "undefined" || typeof document === "undefined") return base;
  const host = document.querySelector(".om");
  if (!host) return base;
  const cs = getComputedStyle(host);
  const v = (name: string, fb: string) => {
    const s = cs.getPropertyValue(name).trim();
    return s || fb;
  };
  return {
    ...base,
    bg0: v("--om-bg", base.bg0),
    ink: v("--om-ink", base.ink),
    muted: v("--om-ink-2", base.muted),
    faint: v("--om-ink-3", base.faint),
    inc: v("--om-inc", base.inc),
    ref: v("--om-ref", base.ref),
    tra: v("--om-tra", base.tra),
    abs: v("--om-abs", base.abs),
    acc: v("--om-inc", base.acc),
  };
}

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

function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      setSize((prev) =>
        prev.w === r.width && prev.h === r.height && prev.dpr === dpr
          ? prev
          : { w: r.width, h: r.height, dpr },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
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

/** distance from (px,py) along unit (dx,dy) to the canvas boundary */
function toEdge(px: number, py: number, dx: number, dy: number, w: number, h: number) {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (w - px) / dx);
  if (dx < -1e-9) t = Math.min(t, -px / dx);
  if (dy > 1e-9) t = Math.min(t, (h - py) / dy);
  if (dy < -1e-9) t = Math.min(t, -py / dy);
  return Math.max(0, Number.isFinite(t) ? t : 0);
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

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

interface WaveStyle {
  color: string;
  amp0: number;
  amp1: number;
  lam: number;
  a0: number;
  a1: number;
  te: boolean;
  tm: boolean;
}

/** Draws a beam + oscillating field ribbon + moving wavefront crests; returns phase at the segment end. */
function waveSeg(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  phase0: number,
  st: WaveStyle,
  wt: number,
  reveal: number,
  pal: Palette,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  const k = (2 * Math.PI) / st.lam;
  const endPhase = phase0 + k * L;
  const Lr = L * clamp(reveal, 0, 1);
  if (L < 0.5 || Lr < 0.5) return endPhase;
  const ux = dx / L;
  const uy = dy / L;
  const nx = -uy;
  const ny = ux;
  const ex = ax + ux * Lr;
  const ey = ay + uy * Lr;
  const ampAt = (s: number) => st.amp0 + (st.amp1 - st.amp0) * (s / L);
  const alAt = (s: number) => st.a0 + (st.a1 - st.a0) * (s / L);
  ctx.save();
  ctx.globalCompositeOperation = pal.dark ? "lighter" : "source-over";
  ctx.lineCap = "round";
  // soft beam
  const g = ctx.createLinearGradient(ax, ay, ex, ey);
  g.addColorStop(0, withAlpha(st.color, (pal.dark ? 0.13 : 0.1) * st.a0));
  g.addColorStop(1, withAlpha(st.color, (pal.dark ? 0.13 : 0.1) * alAt(Lr)));
  ctx.strokeStyle = g;
  ctx.lineWidth = 6 + 2.2 * Math.max(st.amp0, st.amp1);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // core ray
  const gc = ctx.createLinearGradient(ax, ay, ex, ey);
  gc.addColorStop(0, withAlpha(st.color, 0.55 * st.a0));
  gc.addColorStop(1, withAlpha(st.color, 0.55 * alAt(Lr)));
  ctx.strokeStyle = gc;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  // wavefront crest lines (move with the wave)
  const m0 = Math.ceil((phase0 - wt - Math.PI / 2) / (2 * Math.PI));
  for (let m = m0; m < m0 + 400; m++) {
    const s = (Math.PI / 2 + 2 * Math.PI * m - phase0 + wt) / k;
    if (s < 0) continue;
    if (s > Lr) break;
    const a = ampAt(s);
    const al = alAt(s);
    const px = ax + ux * s;
    const py = ay + uy * s;
    const half = a + 5;
    const lg = ctx.createLinearGradient(px - nx * half, py - ny * half, px + nx * half, py + ny * half);
    lg.addColorStop(0, withAlpha(st.color, 0));
    lg.addColorStop(0.5, withAlpha(st.color, 0.5 * al));
    lg.addColorStop(1, withAlpha(st.color, 0));
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px - nx * half, py - ny * half);
    ctx.lineTo(px + nx * half, py + ny * half);
    ctx.stroke();
    if (st.te) {
      // E out of the plane: ⊙ markers on the wavefront
      ctx.fillStyle = withAlpha(st.color, 0.9 * al);
      ctx.beginPath();
      ctx.arc(px, py, 1.6 + a * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(st.color, 0.45 * al);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, 3.6 + a * 0.12, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // in-plane oscillating field ribbon
  if (st.tm || !st.te) {
    const gr = ctx.createLinearGradient(ax, ay, ex, ey);
    gr.addColorStop(0, withAlpha(st.color, 0.95 * st.a0));
    gr.addColorStop(1, withAlpha(st.color, 0.95 * alAt(Lr)));
    for (const [lw, alpha] of [[5, 0.18], [1.7, 1]] as const) {
      ctx.strokeStyle = gr;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let s = 0; s <= Lr; s += 1.5) {
        const off = ampAt(s) * Math.sin(phase0 + k * s - wt);
        const px = ax + ux * s + nx * off;
        const py = ay + uy * s + ny * off;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    // TE only: a ribbon seen edge-on (thin envelope)
    ctx.strokeStyle = withAlpha(st.color, 0.35 * st.a0);
    ctx.lineWidth = 1;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      for (let s = 0; s <= Lr; s += 3) {
        const off = sgn * ampAt(s) * 0.35 * Math.abs(Math.sin(phase0 + k * s - wt));
        const px = ax + ux * s + nx * off;
        const py = ay + uy * s + ny * off;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
  return endPhase;
}

function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, pal: Palette) {
  ctx.save();
  ctx.globalCompositeOperation = pal.dark ? "lighter" : "source-over";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha("#ffffff", 0.9 * alpha));
  g.addColorStop(0.25, withAlpha(color, 0.75 * alpha));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAntenna(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, t: number, pal: Palette, alpha: number) {
  // ripples
  ctx.save();
  ctx.globalCompositeOperation = pal.dark ? "lighter" : "source-over";
  for (let k = 0; k < 4; k++) {
    const r = ((t * 46 + k * 22) % 88) + 10;
    const a = (1 - r / 98) * 0.55 * alpha;
    ctx.strokeStyle = withAlpha(pal.inc, a);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, r, ang - 0.55, ang + 0.55);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  // mast + base
  const base = y + 40;
  const mg = ctx.createLinearGradient(x, y, x, base);
  mg.addColorStop(0, pal.dark ? "#7f8ba6" : "#8a94aa");
  mg.addColorStop(1, withAlpha(pal.dark ? "#7f8ba6" : "#8a94aa", 0));
  ctx.strokeStyle = mg;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x - 3, y + 6);
  ctx.lineTo(x - 3, base);
  ctx.stroke();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // dish
  const dg = ctx.createLinearGradient(-14, -16, 4, 16);
  dg.addColorStop(0, pal.dark ? "#dfe7ff" : "#ffffff");
  dg.addColorStop(1, pal.dark ? "#5b6788" : "#b8c2d8");
  ctx.fillStyle = dg;
  ctx.strokeStyle = pal.dark ? "rgba(255,255,255,.55)" : "rgba(20,30,60,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1, -17);
  ctx.quadraticCurveTo(-17, 0, 1, 17);
  ctx.quadraticCurveTo(-9, 0, 1, -17);
  ctx.fill();
  ctx.stroke();
  // feed arm
  ctx.strokeStyle = pal.dark ? "rgba(220,230,255,.8)" : "rgba(40,50,80,.6)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(9, 0);
  ctx.moveTo(1, -14);
  ctx.lineTo(9, 0);
  ctx.lineTo(1, 14);
  ctx.stroke();
  ctx.restore();
  const pulse = 0.75 + 0.25 * Math.sin(t * 6);
  glowDot(ctx, x + Math.cos(ang) * 9, y + Math.sin(ang) * 9, 14 * pulse, pal.inc, alpha, pal);
}

function drawDetector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  power: number,
  color: string,
  t: number,
  pal: Palette,
  alpha: number,
) {
  const lvl = clamp(Math.sqrt(power), 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(ang);
  // halo
  const pr = 18 + 6 * Math.sin(t * 4) * lvl;
  const hg = ctx.createRadialGradient(0, 0, 4, 0, 0, pr + 14);
  hg.addColorStop(0, withAlpha(color, 0.35 * lvl + 0.05));
  hg.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(0, 0, pr + 14, 0, Math.PI * 2);
  ctx.fill();
  // body: horn receiver facing the incoming wave (−x local)
  const bg = ctx.createLinearGradient(-12, -12, 14, 12);
  bg.addColorStop(0, pal.dark ? "#2a3350" : "#ffffff");
  bg.addColorStop(1, pal.dark ? "#121829" : "#dfe5f1");
  ctx.fillStyle = bg;
  ctx.strokeStyle = withAlpha(color, 0.75);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-14, -13);
  ctx.lineTo(2, -6);
  ctx.lineTo(14, -6);
  ctx.lineTo(14, 6);
  ctx.lineTo(2, 6);
  ctx.lineTo(-14, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // level meter in the body
  for (let i = 0; i < 5; i++) {
    const on = lvl * 5 > i + 0.15;
    ctx.fillStyle = on ? color : withAlpha(color, 0.15);
    ctx.fillRect(3 + i * 2.2, 3 - (i + 1) * 1.6 + 1, 1.4, (i + 1) * 1.6 + 1);
  }
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  intro: number,
  p: SceneParams,
  pal: Palette,
  pats: (CanvasPattern | null)[],
  fmtNum: (v: number, d?: number) => string,
): SceneLayout {
  ctx.clearRect(0, 0, w, h);
  const compact = w < 560;
  const N = p.layers.length;
  const rev = ease(intro);
  const revIn = clamp(intro / 0.4, 0, 1);
  const revMid = clamp((intro - 0.38) / 0.25, 0, 1);
  const revOut = clamp((intro - 0.6) / 0.4, 0, 1);

  // ── backdrop: dot lattice + vignette + floor
  ctx.save();
  ctx.fillStyle = pal.dot;
  const gs = 24;
  for (let x = (w / 2) % gs; x < w; x += gs) for (let y = (h / 2) % gs; y < h; y += gs) ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
  ctx.restore();

  const top = compact ? 62 : 70;
  const bot = h - (compact ? 56 : 58);
  const dX = compact ? 14 : 24;
  const dY = compact ? 9 : 15;

  // floor perspective lines
  ctx.save();
  const fg = ctx.createLinearGradient(0, bot - 30, 0, h);
  fg.addColorStop(0, withAlpha(pal.acc, 0));
  fg.addColorStop(1, withAlpha(pal.acc, pal.dark ? 0.07 : 0.05));
  ctx.fillStyle = fg;
  ctx.fillRect(0, bot - 30, w, h - bot + 30);
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bot + 0.5);
  ctx.lineTo(w, bot + 0.5);
  ctx.stroke();
  ctx.restore();

  // ── geometry
  const totalCm = p.layers.reduce((a, l) => a + l.cm, 0);
  const minW = compact ? 12 : 16;
  let target = clamp(w * 0.08 + Math.sqrt(totalCm) * w * 0.024, w * 0.13, w * (compact ? 0.38 : 0.32));
  target = Math.max(target, N * minW + 4);
  const free = target - N * minW;
  const widths = p.layers.map((l) => minW + free * (totalCm > 0 ? l.cm / totalCm : 1 / N));
  const stackW = widths.reduce((a, b) => a + b, 0);
  const x0 = w * 0.5 - stackW / 2 - dX / 2;
  const xs = [x0];
  widths.forEach((wd, i) => xs.push(xs[i] + wd));
  const xEnd = xs[N];

  const th = p.theta * DEG;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const yHit = top + (bot - top) * 0.4;
  let drops = p.layers.map((l, i) => widths[i] * Math.tan(Math.min(l.thetaT, 80) * DEG));
  const dropSum = drops.reduce((a, b) => a + b, 0);
  const maxDrop = (bot - yHit) * 0.42;
  if (dropSum > maxDrop) drops = drops.map((d) => (d * maxDrop) / dropSum);
  const ys = [yHit];
  drops.forEach((d, i) => ys.push(ys[i] + d));
  const yExit = ys[N];

  const margin = compact ? 44 : 78;
  const lenTo = (fromX: number, fromY: number, dirX: number, dirY: number, xLim: number, yLim: number) => {
    const a = Math.abs(dirX) > 1e-6 ? Math.abs((xLim - fromX) / dirX) : Infinity;
    const b = Math.abs(dirY) > 1e-6 ? Math.abs((yLim - fromY) / dirY) : Infinity;
    return Math.max(20, Math.min(a, b));
  };
  const Lin = lenTo(x0, yHit, cs, sn, margin, top - 18);
  const srcX = x0 - cs * Lin;
  const srcY = yHit - sn * Lin;
  const refOff = p.theta < 3 ? 7 : 0;
  const Lr = lenTo(x0, yHit + refOff, cs, sn, margin, bot - 28);
  const refX = x0 - cs * Lr;
  const refY = yHit + refOff + sn * Lr;
  const Lt = lenTo(xEnd, yExit, cs, sn, w - margin, bot - 28);
  const rxX = xEnd + cs * Lt;
  const rxY = yExit + sn * Lt;

  // ── wave styling
  const A0 = compact ? 7 : 10;
  const lamAir = clamp(62 * Math.pow(2.4 / p.freq, 0.33), 18, 96);
  const wt = time * 2 * Math.PI * 0.9;
  const te = p.pol !== "TM";
  const tm = p.pol !== "TE";
  const pw = (v: number) => clamp(Math.sqrt(Math.max(0, v)), 0, 1.2);
  const alp = (v: number) => 0.18 + 0.82 * clamp(Math.sqrt(Math.max(0, v)), 0, 1);

  // ── slabs (back to front: right side face, then faces)
  const slabAlpha = ease(clamp(intro * 1.8, 0, 1));
  const lift = (1 - slabAlpha) * 18;
  const rects: SceneLayout["rects"] = [];
  ctx.save();
  ctx.translate(0, lift);
  ctx.globalAlpha = slabAlpha;
  // floor shadow
  const sh = ctx.createRadialGradient(w / 2, bot + 4, 4, w / 2, bot + 4, stackW * 0.9 + 40);
  sh.addColorStop(0, pal.dark ? "rgba(0,0,0,.55)" : "rgba(30,40,80,.18)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(w / 2 + dX / 2, bot + 4, stackW * 0.9 + 40, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = N - 1; i >= 0; i--) {
    const l = p.layers[i];
    const a = xs[i];
    const b = xs[i + 1];
    const tint = matTint(l.mat);
    const isAir = l.mat === "air";
    const pat = pats[i];
    const faces: { pts: [number, number][]; shade: number }[] = [
      { pts: [[a, top], [b, top], [b + dX, top - dY], [a + dX, top - dY]], shade: 0.22 },
    ];
    if (i === N - 1) faces.push({ pts: [[b, top], [b + dX, top - dY], [b + dX, bot - dY], [b, bot]], shade: -0.32 });
    for (const f of faces) {
      ctx.beginPath();
      f.pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      if (isAir) {
        ctx.fillStyle = withAlpha(tint, pal.dark ? 0.06 : 0.1);
        ctx.fill();
      } else {
        ctx.fillStyle = tint;
        ctx.fill();
        if (pat) {
          ctx.fillStyle = pat;
          ctx.fill();
        }
        ctx.fillStyle = f.shade > 0 ? `rgba(255,255,255,${f.shade})` : `rgba(0,0,0,${-f.shade})`;
        ctx.fill();
      }
      ctx.strokeStyle = isAir ? withAlpha(tint, 0.35) : pal.dark ? "rgba(255,255,255,.18)" : "rgba(20,30,60,.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // front face
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, top, b - a, bot - top);
    if (isAir) {
      const ag = ctx.createLinearGradient(a, 0, b, 0);
      ag.addColorStop(0, withAlpha(tint, pal.dark ? 0.08 : 0.12));
      ag.addColorStop(0.5, withAlpha(tint, pal.dark ? 0.02 : 0.04));
      ag.addColorStop(1, withAlpha(tint, pal.dark ? 0.08 : 0.12));
      ctx.fillStyle = ag;
      ctx.fill();
    } else {
      ctx.fillStyle = tint;
      ctx.fill();
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fill();
      }
      const lg = ctx.createLinearGradient(a, 0, b, 0);
      lg.addColorStop(0, "rgba(255,255,255,.16)");
      lg.addColorStop(0.18, "rgba(255,255,255,.03)");
      lg.addColorStop(1, "rgba(0,0,0,.22)");
      ctx.fillStyle = lg;
      ctx.fill();
      const vg = ctx.createLinearGradient(0, top, 0, bot);
      vg.addColorStop(0, "rgba(255,255,255,.06)");
      vg.addColorStop(1, pal.dark ? "rgba(0,0,0,.35)" : "rgba(0,0,0,.12)");
      ctx.fillStyle = vg;
      ctx.fill();
      if (l.mat === "glass") {
        ctx.clip();
        ctx.strokeStyle = "rgba(255,255,255,.22)";
        ctx.lineWidth = 6;
        const off = ((time * 30) % ((bot - top) * 2)) - (bot - top) * 0.5;
        ctx.beginPath();
        ctx.moveTo(a - 10, top + off);
        ctx.lineTo(b + 10, top + off - 40);
        ctx.stroke();
      }
    }
    ctx.restore();
    // edges
    ctx.save();
    if (isAir) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = withAlpha(tint, 0.45);
    } else {
      ctx.strokeStyle = pal.dark ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.7)";
    }
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a + 0.5, top);
    ctx.lineTo(a + 0.5, bot);
    ctx.stroke();
    ctx.restore();
    rects[i] = { x0: a, x1: b + (i === N - 1 ? dX : 0), y0: top - dY, y1: bot };
  }
  // selection / hover outlines
  for (const [idx, strong] of [[p.hover, false], [p.sel, true]] as const) {
    if (idx < 0 || idx >= N) continue;
    if (!strong && idx === p.sel) continue;
    const a = xs[idx];
    const b = xs[idx + 1];
    ctx.save();
    ctx.strokeStyle = strong ? pal.acc : withAlpha(pal.acc, 0.45);
    ctx.lineWidth = strong ? 2 : 1.2;
    ctx.shadowColor = withAlpha(pal.acc, 0.8);
    ctx.shadowBlur = strong ? 16 : 6;
    ctx.beginPath();
    ctx.moveTo(a, bot);
    ctx.lineTo(a, top);
    ctx.lineTo(a + dX, top - dY);
    ctx.lineTo(b + dX, top - dY);
    ctx.lineTo(b + dX, bot - dY);
    ctx.lineTo(b, bot);
    ctx.closePath();
    ctx.moveTo(a, top);
    ctx.lineTo(b, top);
    ctx.lineTo(b + dX, top - dY);
    ctx.moveTo(b, top);
    ctx.lineTo(b, bot);
    ctx.stroke();
    ctx.restore();
    if (strong) {
      const mx = (a + b) / 2 + dX / 2;
      const my = top - dY - 10 + Math.sin(time * 3) * 2;
      ctx.save();
      ctx.fillStyle = pal.acc;
      ctx.beginPath();
      ctx.moveTo(mx - 5, my - 6);
      ctx.lineTo(mx + 5, my - 6);
      ctx.lineTo(mx, my);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  // vertical labels inside slabs
  p.layers.forEach((l, i) => {
    const a = xs[i];
    const b = xs[i + 1];
    const wd = b - a;
    if (wd < 13) return;
    ctx.save();
    ctx.translate(a + wd / 2, bot - 10);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `600 ${wd < 20 ? 9 : 10}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const isAir = l.mat === "air";
    ctx.fillStyle = isAir ? withAlpha(pal.ink, 0.6) : "rgba(255,255,255,.92)";
    ctx.shadowColor = isAir ? "transparent" : "rgba(0,0,0,.6)";
    ctx.shadowBlur = 4;
    const txt = `${i + 1} · ${l.name.toUpperCase()} · ${fmtNum(l.cm, l.cm < 1 ? 2 : 1)} cm`;
    const maxLen = (bot - top) * 0.5;
    let s = txt;
    while (s.length > 4 && ctx.measureText(s).width > maxLen) s = s.slice(0, -2);
    ctx.fillText(s === txt ? s : s + "…", 0, 0);
    ctx.restore();
  });
  ctx.restore();

  // ── normals + angle arcs
  ctx.save();
  ctx.globalAlpha = rev;
  ctx.strokeStyle = pal.gridStrong;
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - Math.min(120, x0 - 20), yHit);
  ctx.lineTo(x0, yHit);
  ctx.moveTo(xEnd, yExit);
  ctx.lineTo(xEnd + Math.min(120, w - xEnd - 20), yExit);
  ctx.stroke();
  ctx.setLineDash([]);
  if (p.theta > 0.5) {
    const r = compact ? 30 : 42;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = withAlpha(pal.inc, 0.9);
    ctx.beginPath();
    ctx.arc(x0, yHit, r, Math.PI, Math.PI + th);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(pal.ref, 0.8);
    ctx.beginPath();
    ctx.arc(x0, yHit, r - 7, Math.PI - th, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(pal.tra, 0.85);
    ctx.beginPath();
    ctx.arc(xEnd, yExit, r, 0, th);
    ctx.stroke();
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = pal.inc;
    ctx.fillText(`θ ${fmtNum(p.theta, 1)}°`, x0 - (r + 26) * Math.cos(th / 2), yHit - (r + 14) * Math.sin(th / 2) - 6);
    ctx.fillStyle = pal.tra;
    ctx.fillText(`${fmtNum(p.theta, 1)}°`, xEnd + (r + 20) * Math.cos(th / 2), yExit + (r + 12) * Math.sin(th / 2));
  }
  ctx.font = `500 9px ${MONO}`;
  ctx.fillStyle = pal.faint;
  ctx.textAlign = "left";
  ctx.fillText(p.labels.normal, Math.max(8, x0 - Math.min(120, x0 - 20)), yHit - 7);
  ctx.restore();

  // ── absorption haze in lossy layers
  ctx.save();
  ctx.globalCompositeOperation = pal.dark ? "lighter" : "source-over";
  p.layers.forEach((l, i) => {
    if (l.absorbed < 0.004) return;
    const mx = (xs[i] + xs[i + 1]) / 2;
    const my = (ys[i] + ys[i + 1]) / 2;
    const r = Math.max(26, (xs[i + 1] - xs[i]) * 0.9);
    const flick = 0.85 + 0.15 * Math.sin(time * 2.3 + i);
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
    g.addColorStop(0, withAlpha(pal.abs, clamp(0.55 * Math.sqrt(l.absorbed), 0, 0.5) * flick * revMid));
    g.addColorStop(1, withAlpha(pal.abs, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // ── waves
  const incStyle: WaveStyle = { color: pal.inc, amp0: A0, amp1: A0, lam: lamAir, a0: 1, a1: 1, te, tm };
  let ph = waveSeg(ctx, srcX, srcY, x0, yHit, 0, incStyle, wt, revIn, pal);
  const phHit = ph;
  for (let i = 0; i < N; i++) {
    const l = p.layers[i];
    const col = mixHex(pal.inc, pal.tra, (i + 1) / (N + 1));
    const lam = Math.max(5, lamAir / Math.max(1, l.nRe));
    const segL = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]);
    // keep the visual phase consistent with the real optical path through the layer
    ph = waveSeg(ctx, xs[i], ys[i], xs[i + 1], ys[i + 1], ph, {
      color: col,
      amp0: A0 * pw(l.fluxIn),
      amp1: A0 * pw(l.fluxOut),
      lam,
      a0: alp(l.fluxIn),
      a1: alp(l.fluxOut),
      te,
      tm,
    }, wt, revMid, pal);
    void segL;
    // faint internal reflections at each interface
    if (i > 0 && revMid > 0.5) {
      const pl = p.layers[i - 1];
      const tt = Math.min(pl.thetaT, 80) * DEG;
      const len = Math.min(40, (xs[i] - xs[i - 1]) * 0.9);
      ctx.save();
      ctx.globalCompositeOperation = pal.dark ? "lighter" : "source-over";
      const g = ctx.createLinearGradient(xs[i], ys[i], xs[i] - Math.cos(tt) * len, ys[i] + Math.sin(tt) * len);
      g.addColorStop(0, withAlpha(pal.ref, 0.45 * alp(l.fluxIn)));
      g.addColorStop(1, withAlpha(pal.ref, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xs[i], ys[i]);
      ctx.lineTo(xs[i] - Math.cos(tt) * len, ys[i] + Math.sin(tt) * len);
      ctx.stroke();
      ctx.restore();
    }
  }
  waveSeg(ctx, xEnd, yExit, rxX, rxY, ph, {
    color: pal.tra, amp0: A0 * pw(p.T), amp1: A0 * pw(p.T), lam: lamAir, a0: alp(p.T), a1: alp(p.T), te, tm,
  }, wt, revOut, pal);
  // reflected: phase of r₀ at the surface
  waveSeg(ctx, x0, yHit + refOff, refX, refY, phHit + Math.PI, {
    color: pal.ref, amp0: A0 * pw(p.R), amp1: A0 * pw(p.R), lam: lamAir, a0: alp(p.R), a1: alp(p.R), te, tm,
  }, wt, revOut, pal);

  // ── photon packets (slow down in dense layers)
  if (intro >= 1) {
    const segs: { ax: number; ay: number; bx: number; by: number; v: number; p0: number; p1: number; col: string }[] = [
      { ax: srcX, ay: srcY, bx: x0, by: yHit, v: 1, p0: 1, p1: 1, col: pal.inc },
    ];
    p.layers.forEach((l, i) =>
      segs.push({
        ax: xs[i], ay: ys[i], bx: xs[i + 1], by: ys[i + 1], v: 1 / Math.max(1, l.nRe),
        p0: l.fluxIn, p1: l.fluxOut, col: mixHex(pal.inc, pal.tra, (i + 1) / (N + 1)),
      }),
    );
    segs.push({ ax: xEnd, ay: yExit, bx: rxX, by: rxY, v: 1, p0: p.T, p1: p.T, col: pal.tra });
    const vpx = 190;
    const durs = segs.map((s) => Math.hypot(s.bx - s.ax, s.by - s.ay) / (vpx * s.v));
    const total = durs.reduce((a, b) => a + b, 0);
    const period = total + 0.4;
    const nP = 3;
    for (let k = 0; k < nP; k++) {
      const age = (time + (k * period) / nP) % period;
      let acc = 0;
      for (let si = 0; si < segs.length; si++) {
        if (age < acc + durs[si]) {
          const s = segs[si];
          const f = (age - acc) / durs[si];
          const pwr = s.p0 + (s.p1 - s.p0) * f;
          glowDot(ctx, s.ax + (s.bx - s.ax) * f, s.ay + (s.by - s.ay) * f, 9, s.col, clamp(Math.sqrt(Math.max(0, pwr)), 0.12, 1), pal);
          break;
        }
        acc += durs[si];
      }
      const ageR = age - durs[0];
      const LrPath = Math.hypot(refX - x0, refY - yHit);
      if (ageR > 0 && ageR * vpx < LrPath && p.R > 1e-4) {
        const f = (ageR * vpx) / LrPath;
        glowDot(ctx, x0 + (refX - x0) * f, yHit + refOff + (refY - yHit - refOff) * f, 9, pal.ref, clamp(Math.sqrt(p.R), 0.12, 1), pal);
      }
    }
  }

  // ── impact flare
  glowDot(ctx, x0, yHit, 16 + 3 * Math.sin(time * 5), pal.inc, 0.6 * revIn, pal);
  glowDot(ctx, xEnd, yExit, 12, pal.tra, clamp(Math.sqrt(p.T), 0.15, 1) * revOut, pal);

  // ── objects: antenna + detectors
  drawAntenna(ctx, srcX, srcY, th, time, pal, rev);
  drawDetector(ctx, rxX, rxY, th, p.T, pal.tra, time, pal, revOut);
  drawDetector(ctx, refX, refY, Math.PI - th, p.R, pal.ref, time, pal, revOut);
  if (rev > 0.4) {
    ctx.save();
    ctx.globalAlpha = clamp((rev - 0.4) / 0.6, 0, 1);
    pill(ctx, `${p.labels.tx} · ${fmtNum(p.freq, p.freq < 10 ? 2 : 1)} GHz`, clamp(srcX, 70, w - 70), Math.max(16, srcY - 30), pal, pal.inc);
    pill(ctx, `${p.labels.rx} · T ${fmtNum(p.T * 100, p.T < 0.1 ? 2 : 1)} %`, clamp(rxX, 70, w - 70), Math.min(h - 14, rxY + 30), pal, pal.tra);
    pill(ctx, `${p.labels.refl} · R ${fmtNum(p.R * 100, 1)} %`, clamp(refX, 70, w - 70), Math.min(h - 14, refY + 30), pal, pal.ref);
    ctx.restore();
  }

  // ── total thickness dimension
  ctx.save();
  ctx.globalAlpha = slabAlpha;
  const dy = bot + 16;
  ctx.strokeStyle = pal.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, dy - 4);
  ctx.lineTo(x0, dy + 4);
  ctx.moveTo(xEnd, dy - 4);
  ctx.lineTo(xEnd, dy + 4);
  ctx.moveTo(x0, dy);
  ctx.lineTo(xEnd, dy);
  ctx.stroke();
  for (let i = 1; i < N; i++) {
    ctx.beginPath();
    ctx.moveTo(xs[i], dy - 2.5);
    ctx.lineTo(xs[i], dy + 2.5);
    ctx.stroke();
  }
  ctx.font = `600 10px ${MONO}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`${fmtNum(totalCm, totalCm < 10 ? 2 : 1)} cm${N > 1 ? ` · ${N}×` : ""}`, (x0 + xEnd) / 2, dy + 6);
  ctx.restore();

  return { rects };
}

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
  const size = useCanvasSize(ref);
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
      const dt = Math.min(0.05, (now - last) / 1000);
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
        ? drawSpatialScene(ctx, size.w, size.h, clock.current, intro, parameters, cur.pal, pats, cur.fmtNum, { display: cur.display, annotations: cur.annotations, az: cur.orbit.az, el: cur.orbit.el, lang: cur.lang })
        : drawWaveRays(ctx, size.w, size.h, clock.current, parameters, cur.pal, cur.fmtNum, { display: cur.display, reflections: cur.reflections, annotations: cur.annotations, lang: cur.lang });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const hit = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
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
    <canvas
      ref={ref}
      className={`om-canvas ${hover >= 0 ? "is-pointer" : ""}`}
      aria-label={french ? "Simulation : onde incidente, milieux, réflexion et transmission. Sélectionnez un milieu dans la liste pour le modifier." : "Simulation: incident wave, media, reflection and transmission. Select a medium in the layer list to edit it."}
      role="img"
      onPointerMove={event => {
        setHover(hit(event));
        const d = drag.current;
        if (d && view === "spatial") {
          const dx = event.clientX - d.x;
          const dy = event.clientY - d.y;
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
    const a = ((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * 90;
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
        setHover(e.clientX - r.left);
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
  warn: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17h.01" strokeLinecap="round" /></svg>
  ),
};

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

interface Persisted {
  sim: SimState;
  lang: Lang;
  theme: Theme;
}

function loadPersisted(): Persisted {
  const sysTheme: Theme =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const sysLang: Lang =
    typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
  const fallback: Persisted = { sim: DEFAULT_STATE, lang: sysLang, theme: sysTheme };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const s = (p.sim ?? {}) as Partial<SimState>;
    const num = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;
    const layers = Array.isArray(s.layers)
      ? s.layers
          .slice(0, MAX_LAYERS)
          .filter((l) => l && LAYER_MATS.includes(l.mat))
          .map((l) => ({
            id: typeof l.id === "string" ? l.id : newId(),
            mat: l.mat,
            thickness: num(l.thickness, 0.1, 100, 10),
            eps: num(l.eps, 1, 30, 4),
            sigma: num(l.sigma, 0.0001, 10, 0.05),
            customMode: (l.customMode === "nk" ? "nk" : "eps") as CustomMode,
          }))
      : [];
    const ls = layers.length ? layers : DEFAULT_STATE.layers;
    return {
      sim: {
        layers: ls,
        sel: Math.round(num(s.sel, 0, ls.length - 1, 0)),
        freq: num(s.freq, 0.5, 40, DEFAULT_STATE.freq),
        angle: num(s.angle, 0, 89, DEFAULT_STATE.angle),
        pol: s.pol === "TE" || s.pol === "TM" || s.pol === "AVG" ? s.pol : DEFAULT_STATE.pol,
      },
      lang: p.lang === "fr" || p.lang === "en" ? p.lang : sysLang,
      theme: p.theme === "dark" || p.theme === "light" ? p.theme : sysTheme,
    };
  } catch {
    return fallback;
  }
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

export function App() {
  const initial = useMemo(loadPersisted, []);
  const [sim, setSim] = useState<SimState>(initial.sim);
  const [lang, setLang] = useState<Lang>(initial.lang);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [playing, setPlaying] = useState(true);
  const [fieldScale, setFieldScale] = useState<"lin" | "db">("lin");
  const [flash, setFlash] = useState(0);
  const [present, setPresent] = useState(false);

  const t = DICTS[lang];
  const fmt = useMemo(() => makeFmt(lang), [lang]);
  const pal = useMemo(() => readCssPalette(theme), [theme]);

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
    const id = "om-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sim, lang, theme }));
    } catch {
      /* storage unavailable — state simply isn't persisted */
    }
  }, [sim, lang, theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "fr" ? "Onde & Mur — Simulateur onde & paroi" : "Onde & Mur — Wave & Wall Simulator";
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setPresent(false);
      } else if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "l" || e.key === "L") {
        setLang((l) => (l === "fr" ? "en" : "fr"));
      } else if (e.key === "t" || e.key === "T") {
        setTheme((th) => (th === "dark" ? "light" : "dark"));
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSim((s) => ({ ...s, sel: clamp(s.sel + (e.key === "ArrowUp" ? -1 : 1), 0, s.layers.length - 1) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            <h1>
              Onde <span className="om-amp">&amp;</span> Mur
            </h1>
            <p>
              {t.sub}
              <span className="om-dot-sep" />
              <span className="om-brand-tag">{t.tagline}</span>
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
            className={`om-presentbtn ${present ? "is-on" : ""}`}
            onClick={() => setPresent((p) => !p)}
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
    </div>
  );
}

export default App;
