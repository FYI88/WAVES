/**
 * Physics regression lock — Phase 0 safety net.
 *
 * These tests import ONLY src/physics.ts (no DOM, no React). They pin the
 * shipped R/T/A numbers and the structural invariants of the engine, so any
 * future change that alters the physics fails loudly here instead of silently
 * shifting the simulator's read-outs.
 */
import { describe, expect, it } from "vitest";
import {
  abs2,
  brewsterDeg,
  complexPermittivity,
  computeStackSweep,
  Cx,
  DEG,
  fieldAt,
  interfaceR,
  materialProps,
  slabMode,
  stackFieldAbs,
  stackMode,
} from "./physics";

/* ── Helpers mirroring App.computeResults (cm → m, deg → rad) ─────────── */

function etaOf(mat: string, fGHz: number): Cx {
  if (mat === "air") return complexPermittivity(1, 0, fGHz);
  return complexPermittivity(...epsSigma(mat, fGHz), fGHz);
}

function epsSigma(mat: string, fGHz: number): [number, number] {
  const p = materialProps(mat as Parameters<typeof materialProps>[0], fGHz, 0, 0);
  return [p.epsR, p.sigma];
}

function stack(mats: string[], cm: number[], f: number) {
  return {
    etas: mats.map((m) => etaOf(m, f)),
    ds: cm.map((c) => c / 100),
    f,
  };
}

const GLAZING = { mats: ["glass", "air", "glass"], cm: [0.4, 1.6, 0.4], f: 5 };
// NOTE: the recorded baseline id says "24GHz" but the values are the wifi24
// preset exactly: brick cavity at 2.4 GHz, 0°, AVG (verified digit-for-digit).
const CAVITY = { mats: ["brick", "air", "brick"], cm: [10, 5, 10], f: 2.4 };

describe("shipped baselines (exact R/T/A lock)", () => {
  it("glazing_TE_5GHz_35deg", () => {
    const { etas, ds, f } = stack(GLAZING.mats, GLAZING.cm, GLAZING.f);
    const r = stackMode(etas, ds, f, 35 * DEG, "TE");
    expect(r.R).toBeCloseTo(0.865404, 6);
    expect(r.T).toBeCloseTo(0.101251, 6);
    expect(r.A).toBeCloseTo(0.0333447, 6);
  });

  it("cavity_AVG_24GHz_0deg", () => {
    const { etas, ds, f } = stack(CAVITY.mats, CAVITY.cm, CAVITY.f);
    const r = stackMode(etas, ds, f, 0, "AVG");
    expect(r.R).toBeCloseTo(0.186401, 6);
    expect(r.T).toBeCloseTo(0.220373, 6);
    expect(r.A).toBeCloseTo(0.593226, 6);
  });

  it("concrete_TM_brewster", () => {
    // single 20 cm concrete slab, 5 GHz, TM at θ = 68.5° — the recorded
    // near-Brewster shoulder (pseudo-Brewster minimum itself is ~66.5°).
    // Values must match the shipped read-outs digit-for-digit.
    const f = 5;
    const eta = etaOf("concrete", f);
    const r = stackMode([eta], [0.2], f, 68.5 * DEG, "TM");
    expect(r.R).toBeCloseTo(0.00223008, 6);
    expect(r.T).toBeCloseTo(0.00287356, 6);
    expect(r.A).toBeCloseTo(0.994896, 6);
  });
});

describe("energy conservation", () => {
  const cases: Array<{ mats: string[]; cm: number[]; f: number; deg: number; pol: "TE" | "TM" | "AVG" }> = [
    { ...GLAZING, deg: 35, pol: "TE" },
    { ...CAVITY, deg: 0, pol: "AVG" },
    { mats: ["concrete"], cm: [20], f: 5, deg: 20, pol: "TM" },
    { mats: ["plywood", "wood", "plywood"], cm: [0.6, 2.8, 0.6], f: 5.5, deg: 30, pol: "AVG" },
    { mats: ["glass", "air", "glass"], cm: [0.4, 1.6, 0.4], f: 28, deg: 45, pol: "AVG" },
  ];
  it.each(cases.map((c, i) => [i, c] as const))(
    "case %i: R+T+A=1, bounds, per-layer absorption sums to A",
    (_, c) => {
      const { etas, ds, f } = stack(c.mats, c.cm, c.f);
      const r = stackMode(etas, ds, f, c.deg * DEG, c.pol);
      expect(r.R + r.T + r.A).toBeCloseTo(1, 12);
      for (const v of [r.R, r.T, r.A]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      const sumAbsorb = r.absorb.reduce((a, b) => a + b, 0);
      expect(sumAbsorb).toBeCloseTo(r.A, 12);
      for (const a of r.absorb) expect(a).toBeGreaterThanOrEqual(-1e-12);
    },
  );
});

describe("cross-path consistency (independent code paths agree)", () => {
  it("N=1 recursion equals the closed-form single-slab formula", () => {
    for (const [mat, f, deg] of [["glass", 5, 35], ["concrete", 2.4, 0], ["brick", 24, 60]] as const) {
      for (const pol of ["TE", "TM"] as const) {
        const eta = etaOf(mat, f);
        const rec = stackMode([eta], [0.05], f, deg * DEG, pol);
        const closed = slabMode(eta, f, 0.05, deg * DEG, pol);
        expect(rec.R).toBeCloseTo(closed.R, 12);
        expect(rec.T).toBeCloseTo(closed.T, 12);
      }
    }
  });

  it("N=1 stack field equals the direct 3-region field solver", () => {
    const eta = etaOf("glass", 5);
    for (const pol of ["TE", "TM"] as const) {
      const viaStack = stackFieldAbs([eta], [0.004], 5, 35 * DEG, pol);
      const direct = fieldAt(eta, 5, 0.004, 35 * DEG, pol);
      for (const z of [-0.05, 0, 0.002, 0.004, 0.034]) {
        expect(viaStack(z)).toBeCloseTo(direct(z), 9);
      }
    }
  });

  it("AVG is the mean of TE and TM", () => {
    const { etas, ds, f } = stack(CAVITY.mats, CAVITY.cm, CAVITY.f);
    const avg = stackMode(etas, ds, f, 20 * DEG, "AVG");
    const te = stackMode(etas, ds, f, 20 * DEG, "TE");
    const tm = stackMode(etas, ds, f, 20 * DEG, "TM");
    expect(avg.R).toBeCloseTo((te.R + tm.R) / 2, 12);
    expect(avg.T).toBeCloseTo((te.T + tm.T) / 2, 12);
    expect(avg.A).toBeCloseTo((te.A + tm.A) / 2, 12);
  });
});

describe("angular sweep sanity", () => {
  it("glazing sweep: 181 points, all bounded, energy conserved", () => {
    const { etas, ds, f } = stack(GLAZING.mats, GLAZING.cm, GLAZING.f);
    const sw = computeStackSweep(etas, ds, f);
    expect(sw.ang).toHaveLength(181);
    for (let i = 0; i < sw.ang.length; i++) {
      for (const v of [sw.Rte[i], sw.Tte[i], sw.Rtm[i], sw.Ttm[i]]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("pseudo-Brewster is the TM reflection minimum", () => {
    const eta = etaOf("glass", 5);
    const b = brewsterDeg(eta);
    const atB = abs2(interfaceR(eta, b * DEG, "TM"));
    expect(atB).toBeLessThanOrEqual(abs2(interfaceR(eta, (b - 1) * DEG, "TM")));
    expect(atB).toBeLessThanOrEqual(abs2(interfaceR(eta, (b + 1) * DEG, "TM")));
    expect(b).toBeGreaterThan(50);
    expect(b).toBeLessThan(75);
  });
});
