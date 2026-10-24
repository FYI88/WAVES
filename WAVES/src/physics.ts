/* ════════════════════════════════════════════════════════════════════════
   Complex arithmetic
   ════════════════════════════════════════════════════════════════════════ */

export type Cx = { re: number; im: number };
export const cx = (re: number, im = 0): Cx => ({ re, im });
export const ONE = cx(1);
export const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
export const sub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
export const mul = (a: Cx, b: Cx): Cx =>
  cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a: Cx, k: number): Cx => cx(a.re * k, a.im * k);
export const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const abs2 = (a: Cx): number => a.re * a.re + a.im * a.im;
export const sqrtC = (z: Cx): Cx => {
  const r = Math.hypot(z.re, z.im);
  const re = Math.sqrt(Math.max(0, (r + z.re) / 2));
  let im = Math.sqrt(Math.max(0, (r - z.re) / 2));
  if (z.im < 0) im = -im;
  return cx(re, im);
};
export const expC = (z: Cx): Cx => {
  const e = Math.exp(z.re);
  return cx(e * Math.cos(z.im), e * Math.sin(z.im));
};
/** -j·z */
export const mulNegJ = (z: Cx): Cx => cx(z.im, -z.re);
/** +j·z */
export const mulJ = (z: Cx): Cx => cx(-z.im, z.re);

/* ════════════════════════════════════════════════════════════════════════
   Materials — ITU-R P.2040 Table 3:  ε′ = a·f^b,  σ = c·f^d  (f in GHz)
   ════════════════════════════════════════════════════════════════════════ */

export type MaterialId =
  | "concrete"
  | "brick"
  | "plasterboard"
  | "wood"
  | "glass"
  | "chipboard"
  | "plywood"
  | "marble"
  | "custom";

export type ItuMaterialId = Exclude<MaterialId, "custom">;

export interface MaterialDef {
  a: number;
  b: number;
  c: number;
  d: number;
  fMin: number;
  fMax: number;
  swatch: string;
  tint: string;
}

export const MATERIAL_IDS: MaterialId[] = [
  "concrete",
  "brick",
  "plasterboard",
  "wood",
  "glass",
  "chipboard",
  "plywood",
  "marble",
  "custom",
];

export const MATERIALS: Record<ItuMaterialId, MaterialDef> = {
  concrete: {
    a: 5.24, b: 0, c: 0.0462, d: 0.7822, fMin: 1, fMax: 100,
    tint: "#9a9ea8",
    swatch:
      "radial-gradient(circle at 30% 40%, rgba(255,255,255,.35) 0 1px, transparent 1.6px) 0 0/7px 7px, radial-gradient(circle at 70% 70%, rgba(0,0,0,.35) 0 1px, transparent 1.8px) 0 0/9px 9px, linear-gradient(135deg,#a3a6ae,#6d7079)",
  },
  brick: {
    a: 3.91, b: 0, c: 0.0238, d: 0.16, fMin: 1, fMax: 40,
    tint: "#c4553a",
    swatch:
      "repeating-linear-gradient(0deg, #e8d9c9 0 1.5px, transparent 1.5px 9px), repeating-linear-gradient(90deg, #e8d9c9 0 1.5px, transparent 1.5px 15px), linear-gradient(135deg,#cf5f40,#8a3120)",
  },
  plasterboard: {
    a: 2.73, b: 0, c: 0.0085, d: 0.9395, fMin: 1, fMax: 100,
    tint: "#e9e2d2",
    swatch:
      "radial-gradient(circle, rgba(0,0,0,.08) 0 1px, transparent 1.5px) 0 0/5px 5px, linear-gradient(90deg,#fbf8f1 0 14%, #e6dfcf 14% 86%, #fbf8f1 86%)",
  },
  wood: {
    a: 1.99, b: 0, c: 0.0047, d: 1.0718, fMin: 0.001, fMax: 100,
    tint: "#b07a45",
    swatch:
      "repeating-linear-gradient(98deg, rgba(60,30,10,.22) 0 1.5px, transparent 1.5px 6px), linear-gradient(135deg,#c99460,#875629)",
  },
  glass: {
    a: 6.31, b: 0, c: 0.0036, d: 1.3394, fMin: 0.1, fMax: 100,
    tint: "#7fd6ea",
    swatch:
      "linear-gradient(120deg, rgba(255,255,255,.6) 0 16%, transparent 16% 40%, rgba(255,255,255,.35) 40% 47%, transparent 47%), linear-gradient(135deg,#b4eef8,#4aaec6)",
  },
  chipboard: {
    a: 2.58, b: 0, c: 0.0217, d: 0.78, fMin: 1, fMax: 100,
    tint: "#cfa772",
    swatch:
      "radial-gradient(circle at 20% 30%, #8f6638 0 1.3px, transparent 1.8px) 0 0/6px 6px, radial-gradient(circle at 60% 60%, #f1d7a6 0 1.3px, transparent 1.8px) 0 0/8px 8px, linear-gradient(135deg,#d8b382,#ad8550)",
  },
  plywood: {
    a: 2.71, b: 0, c: 0.33, d: 0, fMin: 1, fMax: 40,
    tint: "#d9b077",
    swatch:
      "repeating-linear-gradient(90deg,#ecca93 0 5px,#b8864a 5px 6.5px,#d9b077 6.5px 11px,#a77840 11px 12px)",
  },
  marble: {
    a: 7.074, b: 0, c: 0.0055, d: 0.9262, fMin: 1, fMax: 60,
    tint: "#ecebe6",
    swatch:
      "linear-gradient(115deg, transparent 0 30%, rgba(110,110,130,.55) 31%, transparent 33.5% 60%, rgba(110,110,130,.35) 61%, transparent 62.5%), linear-gradient(35deg, transparent 0 55%, rgba(150,140,120,.35) 56%, transparent 57.5%), linear-gradient(135deg,#fbfaf7,#d9d7d1)",
  },
};

export const CUSTOM_SWATCH =
  "radial-gradient(circle at 30% 30%, rgba(255,255,255,.55) 0 1px, transparent 1.6px) 0 0/6px 6px, conic-gradient(from 210deg at 50% 50%, #8b7cff, #47d7ff, #5dffb0, #ff5c8a, #8b7cff)";
export const CUSTOM_TINT = "#8b7cff";

export function materialProps(
  id: MaterialId,
  fGHz: number,
  customEps: number,
  customSigma: number,
): { epsR: number; sigma: number } {
  if (id === "custom") return { epsR: customEps, sigma: customSigma };
  const m = MATERIALS[id];
  return { epsR: m.a * Math.pow(fGHz, m.b), sigma: m.c * Math.pow(fGHz, m.d) };
}

/** Complex relative permittivity η = ε′ − j·17.98·σ/f  (ITU-R P.2040 eq. 9b) */
export function complexPermittivity(epsR: number, sigma: number, fGHz: number): Cx {
  return cx(epsR, (-17.98 * sigma) / fGHz);
}

/* ════════════════════════════════════════════════════════════════════════
   Physics — Snell + complex Fresnel + single lossy slab in air
   ════════════════════════════════════════════════════════════════════════ */

export const C0 = 299_792_458;
export const DEG = Math.PI / 180;

export type Pol = "TE" | "TM";
export type PolMode = Pol | "AVG";

export const k0Of = (fGHz: number) => (2 * Math.PI * fGHz * 1e9) / C0;

/** Single air → material interface Fresnel amplitude coefficient. */
export function interfaceR(eta: Cx, th: number, pol: Pol): Cx {
  const s = Math.sin(th);
  const co = Math.cos(th);
  const root = sqrtC(sub(eta, cx(s * s)));
  if (pol === "TE") return div(sub(cx(co), root), add(cx(co), root));
  const ec = scale(eta, co);
  return div(sub(ec, root), add(ec, root));
}

export interface SlabResult {
  R: number;
  T: number;
  rInt: number;
  decay: number;
}

/** ITU-R P.2040 §3.4 — single homogeneous slab of thickness d in air. */
export function slab(eta: Cx, fGHz: number, d: number, th: number, pol: Pol): SlabResult {
  const k0 = k0Of(fGHz);
  const s = Math.sin(th);
  const root = sqrtC(sub(eta, cx(s * s)));
  const r = interfaceR(eta, th, pol);
  const q = scale(root, k0 * d);
  const e1 = expC(mulNegJ(q)); // e^{-jq}
  const e2 = mul(e1, e1); // e^{-j2q}
  const r2 = mul(r, r);
  const den = sub(ONE, mul(r2, e2));
  const R = div(mul(r, sub(ONE, e2)), den);
  const T = div(mul(sub(ONE, r2), e1), den);
  return {
    R: Math.min(1, abs2(R)),
    T: Math.min(1, abs2(T)),
    rInt: abs2(r),
    decay: Math.exp(q.im),
  };
}

export function slabMode(eta: Cx, fGHz: number, d: number, th: number, pol: PolMode): SlabResult {
  if (pol !== "AVG") return slab(eta, fGHz, d, th, pol);
  const a = slab(eta, fGHz, d, th, "TE");
  const b = slab(eta, fGHz, d, th, "TM");
  return {
    R: (a.R + b.R) / 2,
    T: (a.T + b.T) / 2,
    rInt: (a.rInt + b.rInt) / 2,
    decay: a.decay,
  };
}

/**
 * Exact tangential-field solution of the 3-region problem (air | slab | air)
 * for a unit incident wave. TE → E_y, TM → E_x (tangential E, continuous).
 * Formulated with bounded exponentials so it stays stable for thick lossy walls.
 */
export function fieldSolver(eta: Cx, fGHz: number, d: number, th: number, pol: Pol) {
  const k0 = k0Of(fGHz);
  const s = Math.sin(th);
  const co = Math.cos(th);
  const root = sqrtC(sub(eta, cx(s * s)));
  const kz1 = k0 * co;
  const kz2 = scale(root, k0);
  const u = pol === "TE" ? div(cx(co), root) : div(scale(eta, co), root);
  const rho = div(sub(ONE, u), add(ONE, u));
  const g = expC(mulNegJ(scale(kz2, d)));
  const rg2 = mul(rho, mul(g, g));
  const a = div(cx(2), add(add(ONE, rg2), div(sub(ONE, rg2), u)));
  const R = sub(mul(a, add(ONE, rg2)), ONE);
  const b = mul(mul(a, rho), g);
  const T = mul(mul(a, g), add(ONE, rho));
  const invU = div(ONE, u);
  const tm = pol === "TM";
  const tMag = Math.sqrt(abs2(T));
  return (z: number): number => {
    if (z < 0) {
      const ph = kz1 * z;
      const inc = cx(Math.cos(ph), -Math.sin(ph));
      const ref = mul(R, cx(Math.cos(ph), Math.sin(ph)));
      return Math.sqrt(abs2(tm ? sub(inc, ref) : add(inc, ref)));
    }
    if (z > d) return tMag;
    const f1 = mul(a, expC(mulNegJ(scale(kz2, z))));
    const f2 = mul(b, expC(mulJ(scale(kz2, z - d))));
    return Math.sqrt(abs2(tm ? mul(invU, sub(f1, f2)) : add(f1, f2)));
  };
}

export function fieldAt(eta: Cx, fGHz: number, d: number, th: number, pol: PolMode) {
  if (pol !== "AVG") return fieldSolver(eta, fGHz, d, th, pol);
  const te = fieldSolver(eta, fGHz, d, th, "TE");
  const tm = fieldSolver(eta, fGHz, d, th, "TM");
  return (z: number) => {
    const a = te(z);
    const b = tm(z);
    return Math.sqrt((a * a + b * b) / 2);
  };
}

/** Pseudo-Brewster angle: minimum of |r_TM| for the lossy interface. */
export function brewsterDeg(eta: Cx): number {
  let best = 0;
  let bestV = Infinity;
  for (let a = 0; a <= 89.9; a += 0.25) {
    const v = abs2(interfaceR(eta, a * DEG, "TM"));
    if (v < bestV) {
      bestV = v;
      best = a;
    }
  }
  let lo = Math.max(0, best - 0.25);
  let hi = Math.min(89.99, best + 0.25);
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (abs2(interfaceR(eta, m1 * DEG, "TM")) < abs2(interfaceR(eta, m2 * DEG, "TM"))) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

/* ════════════════════════════════════════════════════════════════════════
   Multilayer stack — stable transfer recursion (air | L1 … LN | air)
   Fields are tangential E. Admittance: TE  Y = √(η−sin²θ),  TM  Y = η/√(η−sin²θ)
   ════════════════════════════════════════════════════════════════════════ */

export interface StackSolution {
  R: number;
  T: number;
  A: number;
  /** absorbed fraction per layer (normalised to incident power) */
  absorb: number[];
  /** forward power flux entering each layer (left edge) */
  fluxIn: number[];
  r0: Cx;
  t: Cx;
  rho: Cx[];
  gL: Cx[];
  FL: Cx[];
  kz: Cx[];
  Y: Cx[];
  z: number[];
}

export function solveStack(etas: Cx[], ds: number[], fGHz: number, th: number, pol: Pol): StackSolution {
  const N = etas.length;
  const k0 = k0Of(fGHz);
  const sn = Math.sin(th);
  const cs = Math.max(1e-6, Math.cos(th));
  const s2 = cx(sn * sn);
  const all = [ONE, ...etas, ONE];
  const roots: Cx[] = all.map((e, m) => {
    if (m === 0 || m === N + 1) return cx(cs);
    let r = sqrtC(sub(e, s2));
    if (r.im > 0) r = scale(r, -1);
    if (abs2(r) < 1e-18) r = cx(1e-9, -1e-9);
    return r;
  });
  const Y = roots.map((r, m) => (pol === "TE" ? r : div(all[m], r)));
  const kz = roots.map((r) => scale(r, k0));
  const g = kz.map((k, m) => (m >= 1 && m <= N ? expC(mulNegJ(scale(k, ds[m - 1]))) : ONE));
  const z: number[] = [0];
  for (let i = 0; i < N; i++) z.push(z[i] + ds[i]);

  const rho: Cx[] = new Array(N + 2).fill(cx(0));
  const gL: Cx[] = new Array(N + 2).fill(cx(0));
  for (let m = N; m >= 0; m--) {
    const W = mul(div(Y[m + 1], Y[m]), div(sub(ONE, gL[m + 1]), add(ONE, gL[m + 1])));
    rho[m] = div(sub(ONE, W), add(ONE, W));
    gL[m] = m === 0 ? rho[0] : mul(rho[m], mul(g[m], g[m]));
  }
  const FL: Cx[] = new Array(N + 2).fill(cx(0));
  FL[0] = ONE; // incident amplitude at z = 0⁻
  let FR = ONE;
  for (let m = 0; m <= N; m++) {
    FL[m + 1] = div(mul(FR, add(ONE, rho[m])), add(ONE, gL[m + 1]));
    FR = m + 1 <= N ? mul(FL[m + 1], g[m + 1]) : FL[m + 1];
  }
  const Y0 = Y[0].re;
  // flux at the left edge of medium m (m ≥ 1): ψ = F(1+γ), H = Y F (1−γ)
  const fluxL = (m: number) => {
    const psi = mul(FL[m], add(ONE, gL[m]));
    const H = mul(Y[m], mul(FL[m], sub(ONE, gL[m])));
    return mul(psi, cx(H.re, -H.im)).re / Y0;
  };
  const R = abs2(rho[0]);
  const t = FL[N + 1];
  const T = abs2(t);
  const fluxIn: number[] = [];
  for (let m = 1; m <= N + 1; m++) fluxIn.push(fluxL(m));
  fluxIn[N] = T;
  const absorb: number[] = [];
  for (let i = 0; i < N; i++) absorb.push(Math.max(0, fluxIn[i] - fluxIn[i + 1]));
  return { R, T, A: Math.max(0, 1 - R - T), absorb, fluxIn, r0: rho[0], t, rho, gL, FL, kz, Y, z };
}

/** complex tangential field E(z) for a solved stack */
export function stackField(sol: StackSolution): (zz: number) => Cx {
  const { z, kz, FL, rho } = sol;
  const N = z.length - 1;
  return (zz: number) => {
    if (zz < 0) {
      const ph = mulNegJ(scale(kz[0], zz));
      return add(expC(ph), mul(rho[0], expC(scale(ph, -1))));
    }
    if (zz >= z[N]) return mul(FL[N + 1], expC(mulNegJ(scale(kz[N + 1], zz - z[N]))));
    let m = 1;
    while (m < N && zz >= z[m]) m++;
    const z0 = z[m - 1];
    const z1 = z[m];
    const fwd = mul(FL[m], expC(mulNegJ(scale(kz[m], zz - z0))));
    const FRm = mul(FL[m], expC(mulNegJ(scale(kz[m], z1 - z0))));
    const bwd = mul(mul(rho[m], FRm), expC(mulJ(scale(kz[m], zz - z1))));
    return add(fwd, bwd);
  };
}

export interface StackMode {
  R: number;
  T: number;
  A: number;
  absorb: number[];
  fluxIn: number[];
}

export function stackMode(etas: Cx[], ds: number[], fGHz: number, th: number, pol: PolMode): StackMode {
  if (pol !== "AVG") return solveStack(etas, ds, fGHz, th, pol);
  const a = solveStack(etas, ds, fGHz, th, "TE");
  const b = solveStack(etas, ds, fGHz, th, "TM");
  return {
    R: (a.R + b.R) / 2,
    T: (a.T + b.T) / 2,
    A: (a.A + b.A) / 2,
    absorb: a.absorb.map((v, i) => (v + b.absorb[i]) / 2),
    fluxIn: a.fluxIn.map((v, i) => (v + b.fluxIn[i]) / 2),
  };
}

/** |E(z)| for a stack, incl. RMS average over TE/TM */
export function stackFieldAbs(etas: Cx[], ds: number[], fGHz: number, th: number, pol: PolMode): (z: number) => number {
  if (pol !== "AVG") {
    const f = stackField(solveStack(etas, ds, fGHz, th, pol));
    return (z) => Math.sqrt(abs2(f(z)));
  }
  const fa = stackField(solveStack(etas, ds, fGHz, th, "TE"));
  const fb = stackField(solveStack(etas, ds, fGHz, th, "TM"));
  return (z) => Math.sqrt((abs2(fa(z)) + abs2(fb(z))) / 2);
}

export interface Sweep {
  ang: number[];
  Rte: number[];
  Tte: number[];
  Rtm: number[];
  Ttm: number[];
}

export function computeStackSweep(etas: Cx[], ds: number[], fGHz: number): Sweep {
  const sw: Sweep = { ang: [], Rte: [], Tte: [], Rtm: [], Ttm: [] };
  for (let a = 0; a <= 90.001; a += 0.5) {
    const th = Math.min(a, 89.95) * DEG;
    const te = solveStack(etas, ds, fGHz, th, "TE");
    const tm = solveStack(etas, ds, fGHz, th, "TM");
    sw.ang.push(a);
    sw.Rte.push(te.R);
    sw.Tte.push(te.T);
    sw.Rtm.push(tm.R);
    sw.Ttm.push(tm.T);
  }
  return sw;
}

