import { DEG, ONE, abs2, add, cx, div, expC, k0Of, mul, mulNegJ, scale, sqrtC, sub, type Cx, type Pol, type PolMode } from "../physics";
import {
  cmAdd,
  cmDiag,
  cmDiagMul,
  cmEye,
  cmExpm,
  cmGet,
  cmInv,
  cmMul,
  cmMulDiag,
  cmScale,
  cmSqrtm,
  cmSub,
  cmZeros,
  type CMat,
} from "./cmat";
import { profileSlices, segmentsLength, type ProfileParams, type Segment } from "./profiles";
import { lambdaCm } from "./grating";
import type { FlatLayer } from "./emt";

/* RCWA (Fourier modal method)

   Geometry: air | profiled region (binary slices) | flat layers | air,
   periodic along x with period Λ, incidence in the x–z plane.
   Conventions follow physics.ts: exp(jωt), η = ε′ − jε″, fields e^{−jkz}.
   Harmonics m = −M…M with kx_m = sinθ + m·λ₀/Λ (normalised by k₀).

   Inside a layer U″ = A·U (z normalised by k₀):
     TE (U = Ey):  A = Kx² − E
     TM (U = Hy):  A = P⁻¹(Kx E⁻¹ Kx − I)     (Li inverse rule)
   E, P are the Toeplitz matrices of ε and 1/ε. Modes e^{−Γz}, Γ = √A on the
   decaying branch, computed as Γ = e^{jπ/4}·√(−jA) so the principal root is
   always defined. Layers are joined by S-matrices relative to the air gap
   (Rumpf), which only use decaying exponentials. */

export interface RcwaSlice {
  /** thickness in cm */
  cm: number;
  /** material permittivity on the segments, air elsewhere */
  eta: Cx;
  segments: Segment[];
}

export interface RcwaInput {
  fGHz: number;
  thetaDeg: number;
  pol: Pol;
  periodCm: number;
  /** M: harmonics −M…M are kept */
  harmonics: number;
  slices: RcwaSlice[];
  layers: FlatLayer[];
}

export interface RcwaOrder {
  m: number;
  angleDeg: number;
  R: number;
  T: number;
}

export interface RcwaResult {
  orders: RcwaOrder[];
  R: number;
  T: number;
  A: number;
  R0: number;
  T0: number;
  harmonics: number;
}

interface SMatrix {
  s11: CMat;
  s12: CMat;
  s21: CMat;
  s22: CMat;
}

const J = cx(0, 1);
const ROT = cx(Math.SQRT1_2, Math.SQRT1_2);
const ROT_INV = cx(Math.SQRT1_2, -Math.SQRT1_2);

/** kz = √(η − kx²) on the outgoing / decaying branch (Im ≤ 0). */
function kzOf(eta: Cx, kx: number): Cx {
  let r = sqrtC(sub(eta, cx(kx * kx)));
  if (r.im > 0) r = scale(r, -1);
  if (abs2(r) < 1e-24) r = cx(1e-12, -1e-12);
  return r;
}

/** c_p = ∫₀¹ g(u) e^{+j2πpu} du for p = −(N−1)…(N−1), stored at p + N − 1. */
function fourier(gAir: Cx, gMat: Cx, segments: Segment[], N: number): Cx[] {
  const delta = sub(gMat, gAir);
  const out: Cx[] = [];
  for (let p = -(N - 1); p <= N - 1; p++) {
    if (p === 0) {
      out.push(add(gAir, scale(delta, segmentsLength(segments))));
      continue;
    }
    const w = 2 * Math.PI * p;
    let re = 0;
    let im = 0;
    for (const [a, b] of segments) {
      const dr = Math.cos(w * b) - Math.cos(w * a);
      const di = Math.sin(w * b) - Math.sin(w * a);
      re += di / w;
      im -= dr / w;
    }
    out.push(mul(delta, cx(re, im)));
  }
  return out;
}

function toeplitz(c: Cx[], N: number): CMat {
  const m = cmZeros(N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v = c[i - j + N - 1];
      m.re[i * N + j] = v.re;
      m.im[i * N + j] = v.im;
    }
  }
  return m;
}

/** Exact S-matrix of a homogeneous layer (diagonal in the harmonics). */
function homogeneousS(eta: Cx, kx: number[], kz0: Cx[], d: number, pol: Pol): SMatrix {
  const s11: Cx[] = [];
  const s21: Cx[] = [];
  for (let i = 0; i < kx.length; i++) {
    const kz = kzOf(eta, kx[i]);
    const x = expC(mulNegJ(scale(kz, d)));
    const q = pol === "TE" ? div(kz0[i], kz) : div(mul(eta, kz0[i]), kz);
    const a = add(ONE, q);
    const b = sub(ONE, q);
    const x2 = mul(x, x);
    const den = sub(mul(a, a), mul(x2, mul(b, b)));
    s11.push(div(scale(mul(mul(a, b), sub(ONE, x2)), -1), den));
    s21.push(div(mul(x, sub(mul(a, a), mul(b, b))), den));
  }
  const S11 = cmDiag(s11);
  const S21 = cmDiag(s21);
  return { s11: S11, s12: S21, s21: S21, s22: S11 };
}

/** S-matrix of a z-uniform layer from Q = Vᵢ⁻¹V₀ and X = e^{−Γd}. */
function layerS(Q: CMat, X: CMat): SMatrix {
  const I = cmEye(Q.n);
  const a = cmAdd(I, Q);
  const b = cmSub(I, Q);
  const aInv = cmInv(a);
  const xbAinvX = cmMul(cmMul(cmMul(X, b), aInv), X);
  const D = cmInv(cmSub(a, cmMul(xbAinvX, b)));
  const s11 = cmMul(D, cmSub(cmMul(xbAinvX, a), b));
  const s21 = cmMul(D, cmMul(X, cmSub(a, cmMul(cmMul(b, aInv), b))));
  return { s11, s12: s21, s21, s22: s11 };
}

function gratingS(eta: Cx, segments: Segment[], kx: number[], kz0: Cx[], d: number, pol: Pol): SMatrix {
  const N = kx.length;
  const kxC = kx.map((k) => cx(k));
  const E = toeplitz(fourier(ONE, eta, segments, N), N);
  let A: CMat;
  let Pinv: CMat | null = null;
  if (pol === "TE") {
    A = cmSub(cmDiag(kx.map((k) => cx(k * k))), E);
  } else {
    Pinv = cmInv(toeplitz(fourier(ONE, div(ONE, eta), segments, N), N));
    const kek = cmDiagMul(kxC, cmMulDiag(cmInv(E), kxC));
    A = cmMul(Pinv, cmSub(kek, cmEye(N)));
  }
  const { root, invRoot } = cmSqrtm(cmScale(A, cx(0, -1)));
  const gamma = cmScale(root, ROT);
  const gammaInv = cmScale(invRoot, ROT_INV);
  const X = cmExpm(cmScale(gamma, cx(-d)));
  const Q =
    pol === "TE" || !Pinv
      ? cmMulDiag(gammaInv, kz0.map((k) => mul(J, k)))
      : cmScale(cmMulDiag(cmMul(gammaInv, Pinv), kz0), J);
  return layerS(Q, X);
}

/** Redheffer star product: A on the incidence side, B behind it. */
function star(A: SMatrix, B: SMatrix): SMatrix {
  const I = cmEye(A.s11.n);
  const D = cmMul(A.s12, cmInv(cmSub(I, cmMul(B.s11, A.s22))));
  const F = cmMul(B.s21, cmInv(cmSub(I, cmMul(A.s22, B.s11))));
  return {
    s11: cmAdd(A.s11, cmMul(cmMul(D, B.s11), A.s21)),
    s12: cmMul(D, B.s12),
    s21: cmMul(F, A.s21),
    s22: cmAdd(B.s22, cmMul(cmMul(F, A.s22), B.s12)),
  };
}

export function solveRcwa(input: RcwaInput): RcwaResult {
  const M = Math.max(0, Math.min(40, Math.round(input.harmonics)));
  const N = 2 * M + 1;
  const theta = Math.min(89, Math.max(-89, input.thetaDeg)) * DEG;
  const ratio = lambdaCm(input.fGHz) / input.periodCm;
  const kx: number[] = [];
  for (let m = -M; m <= M; m++) kx.push(Math.sin(theta) + m * ratio);
  const kz0 = kx.map((k) => kzOf(ONE, k));
  const k0 = k0Of(input.fGHz) / 100;
  let S: SMatrix = { s11: cmZeros(N), s12: cmEye(N), s21: cmEye(N), s22: cmZeros(N) };
  for (const slice of input.slices) {
    if (!(slice.cm > 0)) continue;
    const fill = segmentsLength(slice.segments);
    const d = k0 * slice.cm;
    const layer =
      fill <= 1e-12
        ? homogeneousS(ONE, kx, kz0, d, input.pol)
        : fill >= 1 - 1e-12
          ? homogeneousS(slice.eta, kx, kz0, d, input.pol)
          : gratingS(slice.eta, slice.segments, kx, kz0, d, input.pol);
    S = star(S, layer);
  }
  for (const layer of input.layers) {
    if (!(layer.cm > 0)) continue;
    S = star(S, homogeneousS(layer.eta, kx, kz0, k0 * layer.cm, input.pol));
  }
  const ref = kz0[M].re;
  const orders: RcwaOrder[] = [];
  let R = 0;
  let T = 0;
  let R0 = 0;
  let T0 = 0;
  for (let i = 0; i < N; i++) {
    const propagating = Math.abs(kx[i]) < 1 - 1e-12 && kz0[i].re > 1e-9;
    if (!propagating) continue;
    const w = kz0[i].re / ref;
    const Ri = w * abs2(cmGet(S.s11, i, M));
    const Ti = w * abs2(cmGet(S.s21, i, M));
    R += Ri;
    T += Ti;
    if (i === M) {
      R0 = Ri;
      T0 = Ti;
    }
    orders.push({ m: i - M, angleDeg: Math.asin(kx[i]) / DEG, R: Ri, T: Ti });
  }
  return { orders, R, T, A: 1 - R - T, R0, T0, harmonics: M };
}

export type RcwaModeInput = Omit<RcwaInput, "pol"> & { pol: PolMode };

/** TE, TM, or the unpolarised average of both. */
export function solveRcwaMode(input: RcwaModeInput): RcwaResult {
  if (input.pol !== "AVG") return solveRcwa({ ...input, pol: input.pol });
  const a = solveRcwa({ ...input, pol: "TE" });
  const b = solveRcwa({ ...input, pol: "TM" });
  const avg = (x: number, y: number) => (x + y) / 2;
  return {
    orders: a.orders.map((o, i) => ({ m: o.m, angleDeg: o.angleDeg, R: avg(o.R, b.orders[i].R), T: avg(o.T, b.orders[i].T) })),
    R: avg(a.R, b.R),
    T: avg(a.T, b.T),
    A: avg(a.A, b.A),
    R0: avg(a.R0, b.R0),
    T0: avg(a.T0, b.T0),
    harmonics: a.harmonics,
  };
}

export interface ProfiledWall {
  profile: ProfileParams;
  /** permittivity of the profiled material */
  eta: Cx;
  /** flat layers behind the profile (up to 4) */
  below: FlatLayer[];
}

export function rcwaInputFor(
  wall: ProfiledWall,
  fGHz: number,
  thetaDeg: number,
  pol: PolMode,
  harmonics = 10,
  slices = 16,
): RcwaModeInput {
  return {
    fGHz,
    thetaDeg,
    pol,
    periodCm: wall.profile.period,
    harmonics,
    slices: profileSlices(wall.profile, slices).map((s) => ({ cm: s.cm, eta: wall.eta, segments: s.segments })),
    layers: wall.below,
  };
}

export interface RcwaSweep {
  /** swept variable: angles in degrees or frequencies in GHz */
  x: number[];
  R0: number[];
  T0: number[];
  R: number[];
  T: number[];
  A: number[];
  orderR: Record<number, number[]>;
  orderT: Record<number, number[]>;
}

function collect(points: RcwaResult[], x: number[]): RcwaSweep {
  const sweep: RcwaSweep = { x, R0: [], T0: [], R: [], T: [], A: [], orderR: {}, orderT: {} };
  const ms = new Set<number>();
  points.forEach((p) => p.orders.forEach((o) => ms.add(o.m)));
  ms.forEach((m) => {
    sweep.orderR[m] = [];
    sweep.orderT[m] = [];
  });
  for (const p of points) {
    sweep.R0.push(p.R0);
    sweep.T0.push(p.T0);
    sweep.R.push(p.R);
    sweep.T.push(p.T);
    sweep.A.push(p.A);
    ms.forEach((m) => {
      const o = p.orders.find((q) => q.m === m);
      sweep.orderR[m].push(o ? o.R : 0);
      sweep.orderT[m].push(o ? o.T : 0);
    });
  }
  return sweep;
}

export function rcwaAngleSweep(wall: ProfiledWall, fGHz: number, pol: PolMode, angles: number[], harmonics = 10, slices = 16): RcwaSweep {
  return collect(angles.map((a) => solveRcwaMode(rcwaInputFor(wall, fGHz, a, pol, harmonics, slices))), angles);
}

export function rcwaFreqSweep(
  wall: (fGHz: number) => ProfiledWall,
  thetaDeg: number,
  pol: PolMode,
  freqs: number[],
  harmonics = 10,
  slices = 16,
): RcwaSweep {
  return collect(freqs.map((f) => solveRcwaMode(rcwaInputFor(wall(f), f, thetaDeg, pol, harmonics, slices))), freqs);
}
