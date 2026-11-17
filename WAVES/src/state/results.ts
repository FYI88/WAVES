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
import { expandLayers, layerEpsSigma, type Layer, type PhysicalLayer } from "./layers";
import { mixedEta, worstInclusionValidity, type Inclusions, type MixValidity } from "../media/mixing";
import { isInclusionHost } from "./inclusions";

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
  physicalLayers: PhysicalLayer[];
  physicalResults: LayerRes[];
  etas: Cx[];
  ds: number[];
  totalCm: number;
  lambda0: number;
  mixValidity: MixValidity;
}

export function computeResults(s: SimState, inclusions?: Inclusions | null): Results {
  const th = s.angle * DEG;
  const sn = Math.sin(th);
  const k0 = k0Of(s.freq);
  const lambda0 = C0 / (s.freq * 1e9);
  const etas: Cx[] = [];
  const ds: number[] = [];
  const hosts: Cx[] = [];
  const physicalLayers = expandLayers(s.layers);
  const pre = physicalLayers.map((l) => {
    let { epsR, sigma } = layerEpsSigma(l, s.freq);
    const host = complexPermittivity(epsR, sigma, s.freq);
    const eligible = isInclusionHost(l);
    if (eligible) hosts.push(host);
    const eta = inclusions && eligible ? mixedEta(host, inclusions, s.freq) : host;
    if (eta !== host) {
      epsR = eta.re;
      sigma = -eta.im * s.freq / 17.98;
    }
    etas.push(eta);
    ds.push(l.thickness / 100);
    return { l, epsR, sigma, eta };
  });
  const st = stackMode(etas, ds, s.freq, th, s.pol);
  const physicalResults: LayerRes[] = pre.map(({ l, epsR, sigma, eta }, i) => {
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
  // Material properties describe the (optionally mixed) host; powers/losses cover
  // its whole physical group (the ideal insert itself has no absorption).
  const layers = s.layers.map((_, owner) => {
    const indices = physicalLayers.flatMap((l, i) => l.owner === owner ? [i] : []);
    const first = physicalResults[indices[0]];
    if (indices.length === 1) return first;
    return { ...first, absorbed: indices.reduce((n, i) => n + physicalResults[i].absorbed, 0), lossDb: indices.reduce((n, i) => n + physicalResults[i].lossDb, 0) };
  });
  return {
    R: st.R,
    T: st.T,
    A: st.A,
    RdB: 10 * Math.log10(Math.max(st.R, 1e-30)),
    TdB: 10 * Math.log10(Math.max(st.T, 1e-30)),
    layers,
    physicalLayers,
    physicalResults,
    etas,
    ds,
    totalCm: s.layers.reduce((a, l) => a + l.thickness, 0),
    lambda0,
    mixValidity: inclusions ? worstInclusionValidity(hosts, inclusions, s.freq) : "ok",
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
