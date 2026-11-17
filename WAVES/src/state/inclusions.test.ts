import { describe, expect, it } from "vitest";
import { complexPermittivity, computeStackSweep, DEG, stackFieldAbs, stackMode, type PolMode } from "../physics";
import { mixedEta, NO_INCLUSIONS } from "../media/mixing";
import { mkLayer } from "./layers";
import { computeResults, stackSweepKey, type SimState } from "./results";
import { mainEmt, mainWallSpec } from "../surface/profiledMain";
import { DEFAULT_PROFILE } from "../surface/profiles";
import { runJob, wallAt } from "../surface/rcwaJobs";
import { physicalScene } from "../scene/physicalStack";

const stack = (): SimState => ({
  layers: [
    { ...mkLayer("custom", 2, 9, 0.03), embeddedInsert: { enabled: true, eps: 2.25, thickness: 0.1 } },
    mkLayer("air", 1),
    { ...mkLayer("custom", 0.2, 3, 0), matching: true },
    mkLayer("glass", 0.4),
  ], sel: 0, freq: 5, angle: 30, pol: "TE",
});

describe("main-wall inclusions", () => {
  it("off or zero fraction gives exactly the original result without mutating the hosts", () => {
    const s = stack();
    const original = JSON.stringify(s);
    expect(computeResults(s, null)).toEqual(computeResults(s));
    expect(computeResults(s, NO_INCLUSIONS)).toEqual(computeResults(s));
    computeResults(s, { ...NO_INCLUSIONS, kind: "water", fraction: 0.1 });
    expect(JSON.stringify(s)).toBe(original);
  });

  it.each(["air", "water"] as const)("mixes %s into every physical host, not air/coatings/ideal inserts", (kind) => {
    const s = stack();
    const inc = { ...NO_INCLUSIONS, kind, fraction: 0.1 };
    const dry = computeResults(s);
    const wet = computeResults(s, inc);
    // host half / ideal insert / host half / air / coating / glass
    for (const i of [0, 2, 5]) expect(wet.etas[i]).toEqual(mixedEta(dry.etas[i], inc, s.freq));
    for (const i of [1, 3, 4]) expect(wet.etas[i]).toEqual(dry.etas[i]);
    expect(Math.abs(wet.etas[1].im)).toBe(0);
    expect(wet.ds).toEqual(dry.ds);
    expect(wet.totalCm).toBe(dry.totalCm);
    expect(wet.layers[0].epsR).toBe(wet.etas[0].re);
    expect(complexPermittivity(wet.layers[0].epsR, wet.layers[0].sigma, s.freq).im).toBeCloseTo(wet.etas[0].im, 14);
    expect(stackSweepKey(wet.etas, wet.ds, s.freq)).not.toBe(stackSweepKey(dry.etas, dry.ds, s.freq));
  });

  it("skips legacy live coatings and rates only eligible original hosts", () => {
    const s = stack();
    s.layers[0] = mkLayer("custom", 1, 1, 0);
    s.layers[2] = { ...mkLayer("custom", 1, 64, 0), matchingDesign: "quarter-wave-live" };
    s.layers = s.layers.slice(0, 3);
    const inc = { ...NO_INCLUSIONS, fraction: 0.1, diameterMm: 8 };
    const wet = computeResults(s, inc);
    expect(wet.mixValidity).toBe("marginal");
    expect(wet.etas[2]).toEqual(computeResults(s).etas[2]);
    s.layers.push(mkLayer("custom", 1, 9, 0));
    expect(computeResults(s, inc).mixValidity).toBe("invalid");
  });

  it.each(["TE", "TM", "AVG"] as PolMode[])("shares the mixed stack with results, sweep, field, scene and EMT/RCWA (%s)", (pol) => {
    const s = { ...stack(), pol };
    const inc = { ...NO_INCLUSIONS, kind: "water" as const, fraction: 0.12 };
    const r = computeResults(s, inc);
    const dry = computeResults(s);
    const expected = dry.etas.map((host, i) => [0, 2, 5].includes(i) ? mixedEta(host, inc, s.freq) : host);
    const manual = stackMode(expected, r.ds, s.freq, s.angle * DEG, pol);
    expect(r.R).toBe(manual.R);
    expect(r.T).toBe(manual.T);
    expect(r.A).toBe(manual.A);
    const sweep = computeStackSweep(r.etas, r.ds, s.freq);
    const at = sweep.ang.indexOf(s.angle);
    const R = pol === "TE" ? sweep.Rte[at] : pol === "TM" ? sweep.Rtm[at] : (sweep.Rte[at] + sweep.Rtm[at]) / 2;
    expect(R).toBe(r.R);
    const field = stackFieldAbs(r.etas, r.ds, s.freq, s.angle * DEG, pol);
    const reference = stackFieldAbs(expected, r.ds, s.freq, s.angle * DEG, pol);
    for (const z of [-0.02, 0, 0.005, 0.02, 0.03, 0.06]) expect(field(z)).toBe(reference(z));
    const scene = physicalScene(r, 0, String, "Insert", "Coating");
    expect(scene.layers.map((l) => l.nRe)).toEqual(r.physicalResults.map((l) => l.nRe));
    const spec = mainWallSpec({ ...DEFAULT_PROFILE, id: "square", depth: 0 }, s.layers, inc);
    const wall = wallAt(spec, s.freq);
    expect(wall.eta).toEqual(r.etas[0]);
    expect(wall.below.map((l) => l.eta)).toEqual(r.etas);
    expect(wall.mixValidity).toBe(r.mixValidity);
    const emt = mainEmt(spec, s.freq, s.angle, pol);
    const rcwa = runJob({ id: 1, kind: "point", wall: spec, fGHz: s.freq, thetaDeg: s.angle, pol, harmonics: 2, slices: 8 });
    for (const got of [emt, rcwa] as Array<{ R: number; T: number; A: number }>) {
      expect(got.R).toBeCloseTo(r.R, 9);
      expect(got.T).toBeCloseTo(r.T, 9);
      expect(got.A).toBeCloseTo(r.A, 9);
    }
  });

  it.each(["air", "coating", "empty"] as const)("never mixes an excluded %s profile face", (head) => {
    const layers = head === "empty" ? [] : [head === "air" ? mkLayer("air", 1) : { ...mkLayer("custom", 1, 9, 0), matching: true }];
    const profile = { ...DEFAULT_PROFILE, id: "triangle" as const };
    const inc = { ...NO_INCLUSIONS, kind: "water" as const, fraction: 0.1 };
    const dry = wallAt(mainWallSpec(profile, layers), 5);
    const mixed = wallAt(mainWallSpec(profile, layers, inc), 5);
    expect(mixed).toEqual(dry);
  });

  it("re-evaluates the same dispersive main materials and water at each worker frequency", () => {
    const s = stack();
    const inc = { ...NO_INCLUSIONS, kind: "water" as const, fraction: 0.1 };
    const spec = mainWallSpec({ ...DEFAULT_PROFILE, depth: 0 }, s.layers, inc);
    for (const freq of [1, 5, 28]) {
      const r = computeResults({ ...s, freq }, inc);
      expect(wallAt(spec, freq).below.map((l) => l.eta)).toEqual(r.etas);
    }
  });
});
