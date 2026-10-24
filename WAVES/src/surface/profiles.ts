/* ════════════════════════════════════════════════════════════════════════
   Periodic wall-surface profiles

   A profile is one period of the wall face, described by a normalised height
   s(u) ∈ [0, 1] for u = x / Λ ∈ [0, 1). The profiled region has depth h:
   at normalised depth t = z / h (t = 0 at the crests, t = 1 at the base) the
   material fills the points where s(u) ≥ 1 − t. Below the profile, the flat
   layers of the stack continue unchanged.
   ════════════════════════════════════════════════════════════════════════ */

export type ProfileId =
  | "flat"
  | "triangle"
  | "sawtooth"
  | "bumps"
  | "hollows"
  | "square"
  | "sine"
  | "trapezoid"
  | "steps"
  | "rough";

export const PROFILE_IDS: ProfileId[] = [
  "flat",
  "triangle",
  "sawtooth",
  "bumps",
  "hollows",
  "square",
  "sine",
  "trapezoid",
  "steps",
  "rough",
];

export interface ProfileParams {
  id: ProfileId;
  /** period Λ in cm */
  period: number;
  /** crest-to-valley depth h in cm */
  depth: number;
  /** créneaux: material fraction of the period · trapèzes: base width fraction */
  fill: number;
  /** trapèzes: top width as a fraction of the base width */
  top: number;
  /** marches: number of levels (≥ 2) */
  steps: number;
  /** rugueux: correlation length in cm */
  corr: number;
  /** rugueux: random seed */
  seed: number;
}

export const DEFAULT_PROFILE: ProfileParams = {
  id: "flat",
  period: 2,
  depth: 1,
  fill: 0.5,
  top: 0.4,
  steps: 4,
  corr: 0.4,
  seed: 7,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROUGH_SAMPLES = 1024;
const roughCache = new Map<string, Float64Array>();

/** Gaussian-correlated random profile over one (super-)period, normalised to [0, 1]. */
function roughTable(period: number, corr: number, seed: number): Float64Array {
  const key = `${period}:${corr}:${seed}`;
  const hit = roughCache.get(key);
  if (hit) return hit;
  const rand = mulberry32(Math.round(seed) + 1);
  const harmonics = 32;
  const ratio = Math.max(1e-3, corr) / Math.max(1e-3, period);
  const amp: number[] = [];
  const phase: number[] = [];
  for (let k = 1; k <= harmonics; k++) {
    // Gaussian correlation exp(−x²/ℓ²) → amplitude ∝ exp(−(πkℓ/Λ)²/2)
    amp.push(Math.exp(-((Math.PI * k * ratio) ** 2) / 2) * (0.5 + rand()));
    phase.push(rand() * 2 * Math.PI);
  }
  const table = new Float64Array(ROUGH_SAMPLES);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ROUGH_SAMPLES; i++) {
    const u = i / ROUGH_SAMPLES;
    let v = 0;
    for (let k = 1; k <= harmonics; k++) v += amp[k - 1] * Math.cos(2 * Math.PI * k * u + phase[k - 1]);
    table[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < ROUGH_SAMPLES; i++) table[i] = (table[i] - lo) / span;
  if (roughCache.size > 32) roughCache.clear();
  roughCache.set(key, table);
  return table;
}

/** Normalised height function s(u) of one period. */
export function profileHeight(p: ProfileParams): (u: number) => number {
  switch (p.id) {
    case "flat":
      return () => 1;
    case "triangle":
      return (u) => 1 - Math.abs(2 * u - 1);
    case "sawtooth":
      return (u) => clamp01(u);
    case "bumps":
      return (u) => Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    case "hollows":
      return (u) => 1 - Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    case "square": {
      const f = Math.min(0.99, Math.max(0.01, p.fill));
      return (u) => (u < f ? 1 : 0);
    }
    case "sine":
      return (u) => 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    case "trapezoid": {
      const base = Math.min(1, Math.max(0.02, p.fill));
      const top = base * clamp01(p.top);
      return (u) => {
        const d = Math.abs(u - 0.5);
        if (d <= top / 2) return 1;
        if (d >= base / 2) return 0;
        return (base / 2 - d) / ((base - top) / 2);
      };
    }
    case "steps": {
      const n = Math.max(2, Math.round(p.steps));
      return (u) => Math.min(n - 1, Math.max(0, Math.floor(u * n))) / (n - 1);
    }
    case "rough": {
      const table = roughTable(p.period, p.corr, p.seed);
      return (u) => {
        const x = (((u % 1) + 1) % 1) * ROUGH_SAMPLES;
        const i = Math.floor(x);
        const f = x - i;
        const a = table[i % ROUGH_SAMPLES];
        const b = table[(i + 1) % ROUGH_SAMPLES];
        return a + (b - a) * f;
      };
    }
    default:
      return () => 1;
  }
}

export type Segment = [number, number];

const SEGMENT_SAMPLES = 2048;

/** Material segments [u0, u1] of one period at normalised depth t. */
export function segmentsAt(p: ProfileParams, t: number): Segment[] {
  const height = profileHeight(p);
  const level = 1 - t;
  const out: Segment[] = [];
  let start = -1;
  for (let k = 0; k < SEGMENT_SAMPLES; k++) {
    const inside = height((k + 0.5) / SEGMENT_SAMPLES) >= level;
    if (inside && start < 0) start = k;
    if (!inside && start >= 0) {
      out.push([start / SEGMENT_SAMPLES, k / SEGMENT_SAMPLES]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start / SEGMENT_SAMPLES, 1]);
  return out;
}

export const segmentsLength = (segments: Segment[]) => segments.reduce((sum, [a, b]) => sum + (b - a), 0);

/** Material fill factor at normalised depth t (0 = crests, 1 = base). */
export function fillAt(p: ProfileParams, t: number): number {
  if (p.id === "flat") return 1;
  return segmentsLength(segmentsAt(p, t));
}

export interface ProfileSlice {
  /** slice thickness in cm */
  cm: number;
  /** normalised depth of the slice centre */
  t: number;
  fill: number;
  segments: Segment[];
}

const sameSegments = (a: Segment[], b: Segment[]) =>
  a.length === b.length && a.every(([x0, x1], i) => Math.abs(x0 - b[i][0]) < 1e-12 && Math.abs(x1 - b[i][1]) < 1e-12);

/** Staircase approximation of the profile; consecutive identical slices are merged. */
export function profileSlices(p: ProfileParams, count: number): ProfileSlice[] {
  if (!(p.depth > 0)) return [];
  if (p.id === "flat") return [{ cm: p.depth, t: 0.5, fill: 1, segments: [[0, 1]] }];
  const n = Math.max(1, Math.round(count));
  const out: ProfileSlice[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const segments = segmentsAt(p, t);
    const last = out[out.length - 1];
    if (last && sameSegments(last.segments, segments)) {
      last.cm += p.depth / n;
      continue;
    }
    out.push({ cm: p.depth / n, t, fill: segmentsLength(segments), segments });
  }
  return out;
}

/** Points of one period for drawing: u ∈ [0, 1], s ∈ [0, 1]. */
export function sampleProfile(p: ProfileParams, count = 200): { u: number; s: number }[] {
  const height = profileHeight(p);
  const n = Math.max(2, Math.round(count));
  const out: { u: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    out.push({ u, s: height(Math.min(u, 1 - 1e-9)) });
  }
  return out;
}

/** RMS height of the profile in cm. */
export function profileRms(p: ProfileParams): number {
  const pts = sampleProfile(p, 1024);
  const mean = pts.reduce((s, q) => s + q.s, 0) / pts.length;
  const v = pts.reduce((s, q) => s + (q.s - mean) ** 2, 0) / pts.length;
  return Math.sqrt(v) * p.depth;
}
