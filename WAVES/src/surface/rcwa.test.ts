import { describe, expect, it } from "vitest";
import { DEG, complexPermittivity, cx, solveStack, type Pol } from "../physics";
import { rcwaInputFor, solveRcwa, solveRcwaMode, type ProfiledWall } from "./rcwa";
import { emtSolve } from "./emt";
import { littrowDeg } from "./grating";
import { surfaceEta } from "./materials";
import { runJob, type WallSpec } from "./rcwaJobs";
import { DEFAULT_PROFILE, type ProfileParams } from "./profiles";

const profile = (over: Partial<ProfileParams>): ProfileParams => ({ ...DEFAULT_PROFILE, ...over });
const point = (wall: ProfiledWall, f: number, theta: number, pol: Pol, harmonics = 8, slices = 12) =>
  solveRcwa({ ...rcwaInputFor(wall, f, theta, pol, harmonics, slices), pol });

describe("RCWA reduces to the existing multilayer model", () => {
  for (const pol of ["TE", "TM"] as Pol[]) {
    for (const theta of [0, 35, 68.5]) {
      it(`concrete 20 cm · 2.4 GHz · ${pol} · ${theta}°`, () => {
        const eta = surfaceEta("concrete", 2.4);
        const ref = solveStack([eta], [0.2], 2.4, theta * DEG, pol);
        const got = solveRcwa({ fGHz: 2.4, thetaDeg: theta, pol, periodCm: 2, harmonics: 5, slices: [], layers: [{ eta, cm: 20 }] });
        expect(got.R).toBeCloseTo(ref.R, 9);
        expect(got.T).toBeCloseTo(ref.T, 9);
      });
    }
  }

  it("double glazing 5 GHz matches solveStack (TE and TM)", () => {
    const glass = surfaceEta("glass", 5);
    const air = cx(1);
    for (const pol of ["TE", "TM"] as Pol[]) {
      const ref = solveStack([glass, air, glass], [0.004, 0.016, 0.004], 5, 35 * DEG, pol);
      const got = solveRcwa({
        fGHz: 5,
        thetaDeg: 35,
        pol,
        periodCm: 1,
        harmonics: 4,
        slices: [],
        layers: [
          { eta: glass, cm: 0.4 },
          { eta: air, cm: 1.6 },
          { eta: glass, cm: 0.4 },
        ],
      });
      expect(got.R).toBeCloseTo(ref.R, 9);
      expect(got.T).toBeCloseTo(ref.T, 9);
    }
  });

  it("flat profile on flat layers matches solveStack", () => {
    const eta = surfaceEta("concrete", 3.5);
    const plaster = surfaceEta("plasterboard", 3.5);
    const wall: ProfiledWall = { profile: profile({ id: "flat", depth: 18 }), eta, below: [{ eta: plaster, cm: 1.3 }] };
    const ref = solveStack([eta, plaster], [0.18, 0.013], 3.5, 30 * DEG, "TM");
    const got = point(wall, 3.5, 30, "TM");
    expect(got.R).toBeCloseTo(ref.R, 9);
    expect(got.T).toBeCloseTo(ref.T, 9);
  });
});

describe("RCWA physics of profiled walls", () => {
  const lossless = cx(4, 0);

  for (const pol of ["TE", "TM"] as Pol[]) {
    it(`lossless triangle grating conserves energy (${pol})`, () => {
      const wall: ProfiledWall = { profile: profile({ id: "triangle", period: 2, depth: 1 }), eta: lossless, below: [] };
      const got = point(wall, 20, 20, pol);
      expect(got.orders.length).toBeGreaterThan(1);
      expect(Math.abs(got.A)).toBeLessThan(1e-6);
    });
  }

  it("lossy concrete grating is passive", () => {
    const wall: ProfiledWall = {
      profile: profile({ id: "bumps", period: 4, depth: 2 }),
      eta: surfaceEta("concrete", 10),
      below: [{ eta: surfaceEta("concrete", 10), cm: 5 }],
    };
    for (const pol of ["TE", "TM"] as Pol[]) {
      const got = point(wall, 10, 25, pol);
      expect(got.A).toBeGreaterThan(-1e-9);
      expect(got.A).toBeLessThanOrEqual(1);
      for (const o of got.orders) {
        expect(o.R).toBeGreaterThanOrEqual(0);
        expect(o.T).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("resultant R and T (the single drawn beams) are the sums over every propagating order", () => {
    const wall: ProfiledWall = {
      profile: profile({ id: "bumps", period: 4, depth: 2 }),
      eta: surfaceEta("concrete", 10),
      below: [{ eta: surfaceEta("concrete", 10), cm: 5 }],
    };
    const got = solveRcwaMode(rcwaInputFor(wall, 10, 25, "AVG", 8, 12));
    expect(got.orders.length).toBeGreaterThan(1);
    expect(got.R).toBeCloseTo(got.orders.reduce((s, o) => s + o.R, 0), 12);
    expect(got.T).toBeCloseTo(got.orders.reduce((s, o) => s + o.T, 0), 12);
    expect(got.R + got.T + got.A).toBeCloseTo(1, 12);
  });

  it("symmetric profile at normal incidence diffracts symmetrically", () => {
    const wall: ProfiledWall = { profile: profile({ id: "triangle", period: 3, depth: 1 }), eta: lossless, below: [] };
    const got = point(wall, 20, 0, "TE");
    const plus = got.orders.find((o) => o.m === 1);
    const minus = got.orders.find((o) => o.m === -1);
    expect(plus && minus).toBeTruthy();
    expect(plus!.R).toBeCloseTo(minus!.R, 8);
    expect(plus!.T).toBeCloseTo(minus!.T, 8);
  });

  for (const [pol, tol] of [["TE", 0.01], ["TM", 0.02]] as [Pol, number][]) {
    it(`subwavelength grating agrees with the EMT fast mode (${pol})`, () => {
      const p = profile({ id: "square", period: 0.1, depth: 0.75, fill: 0.5 });
      const wall: ProfiledWall = { profile: p, eta: lossless, below: [] };
      const got = point(wall, 10, 0, pol);
      const emt = emtSolve(p, lossless, [], 10, 0, pol);
      expect(got.orders.map((o) => o.m)).toEqual([0]);
      expect(Math.abs(got.R - emt.R)).toBeLessThan(tol);
    });
  }

  it("AVG is the mean of TE and TM", () => {
    const wall: ProfiledWall = { profile: profile({ id: "sine", period: 2, depth: 0.8 }), eta: lossless, below: [] };
    const te = point(wall, 15, 30, "TE");
    const tm = point(wall, 15, 30, "TM");
    const avg = solveRcwaMode(rcwaInputFor(wall, 15, 30, "AVG", 8, 12));
    expect(avg.R).toBeCloseTo((te.R + tm.R) / 2, 12);
  });

  it("blazed metal sawtooth favours the Littrow order (TE)", () => {
    const f = 10;
    const period = 3;
    const lit = littrowDeg(f, period, -1);
    const metal = complexPermittivity(1, 1e7, f);
    const wall: ProfiledWall = {
      profile: profile({ id: "sawtooth", period, depth: period * Math.tan(lit * DEG) }),
      eta: metal,
      below: [],
    };
    const blazed = point(wall, f, lit, "TE", 10, 16).orders.find((o) => o.m === -1);
    const anti = point(wall, f, -lit, "TE", 10, 16).orders.find((o) => o.m === 1);
    expect(blazed && anti).toBeTruthy();
    expect(blazed!.R).toBeGreaterThan(anti!.R);
  });

  it("job runner sweeps angles with one entry per order", () => {
    const spec: WallSpec = {
      profile: profile({ id: "square", period: 3, depth: 1, fill: 0.5 }),
      material: "brick",
      customEps: 4,
      customSigma: 0,
      below: [{ material: "brick", cm: 5, customEps: 4, customSigma: 0 }],
    };
    const sweep = runJob({ id: 1, kind: "angle", wall: spec, fGHz: 20, pol: "TE", angles: [0, 20, 40], harmonics: 5, slices: 8 });
    expect("x" in sweep && sweep.x).toEqual([0, 20, 40]);
    if ("orderR" in sweep) for (const series of Object.values(sweep.orderR)) expect(series).toHaveLength(3);
  });
});
