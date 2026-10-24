import {
  C0,
  DEG,
  MATERIALS,
  brewsterDeg,
  complexPermittivity,
  k0Of,
  sqrtC,
  stackMode,
  sub,
  cx,
  type Cx,
  type PolMode,
} from "../physics";
import { layerEpsSigma, type Layer } from "./layers";

export interface SimState {
  layers: Layer[];
  sel: number;
  freq: number; // GHz
  angle: number; // deg
  pol: PolMode;
}

export interface LayerRes {
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

export interface Results {
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

export function computeResults(s: SimState): Results {
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

/**
 * Value key of everything `computeStackSweep` depends on (layer etas,
 * thicknesses, frequency). `computeResults` returns fresh arrays on every
 * state change, so memoizing on this key lets angle / polarization /
 * selection changes reuse the previous 181-point sweep.
 */
export const stackSweepKey = (etas: Cx[], ds: number[], freq: number) =>
  `${etas.map((e) => `${e.re},${e.im}`).join(";")}|${ds.join(",")}|${freq}`;
