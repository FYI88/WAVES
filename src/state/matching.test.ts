import { describe, expect, it } from "vitest";
import app from "../App.tsx?raw";
import scene from "../scene/RayScene.tsx?raw";
import { C0 } from "../physics";
import { applyMove, applyResize, applyStackCommand } from "../scene/dragStack";
import { encodeShare } from "../share";
import { mainEmt, mainWallSpec } from "../surface/profiledMain";
import { DEFAULT_PROFILE } from "../surface/profiles";
import { wallAt } from "../surface/rcwaJobs";
import { rcwaInputFor, solveRcwaMode } from "../surface/rcwa";
import { insertMatchingLayer, layerEpsSigma, mkLayer, quarterWaveMatch } from "./layers";
import { addMatching, importMatching, matchingReference, referenceIndex, resolveMatching, transitionMatching } from "./matching";
import { defaultPersisted, persistedFromHash, sanitizePersisted } from "./persistence";
import { DEFAULT_STATE, presetState } from "./presets";
import { computeResults, type SimState } from "./results";

const base = (): SimState => ({ layers: [mkLayer("custom", 2, 9, 0)], freq: 10, angle: 0, pol: "AVG", sel: 0 });
const live = () => addMatching(base(), 0).sim;

describe("neighbour-derived live matching", () => {
  it("uses the geometric mean of impedance, not its sum, with full precision", () => {
    const sim = live(), coat = sim.layers[0];
    const ref = matchingReference(sim.layers, 0, sim.freq);
    expect(coat.eps).toBe(3);
    expect(376.730313668 / Math.sqrt(coat.eps)).toBeCloseTo(Math.sqrt(ref.z1 * ref.z2), 12);
    expect(coat.thickness).toBe(quarterWaveMatch(1, 3, 10)!.cm);
    expect(coat.thickness).not.toBe(Number(coat.thickness.toFixed(2)));
  });

  it("redesigns synchronously for frequency/material, but not angle/polarization", () => {
    const sim = live();
    const tuned = transitionMatching(sim, { ...sim, freq: 20 }).sim;
    expect(tuned.layers[0].thickness).toBe(sim.layers[0].thickness / 2);
    const changed = transitionMatching(tuned, { ...tuned, layers: [tuned.layers[0], { ...tuned.layers[1], eps: 16 }] }).sim;
    expect(changed.layers[0].eps).toBe(4);
    for (const pol of ["TE", "TM", "AVG"] as const) {
      expect(transitionMatching(changed, { ...changed, angle: 63, pol }).sim.layers[0]).toBe(changed.layers[0]);
    }
    const equal = transitionMatching(sim, { ...sim, layers: [sim.layers[0], { ...sim.layers[1], eps: 1 }] });
    expect(equal.reason).toBeNull();
    expect(equal.sim.layers[0].eps).toBe(1);
  });

  it("uses real index of lossy neighbours without replacing their loss or promising T", () => {
    const sim = { ...base(), layers: [mkLayer("brick", 5), mkLayer("glass", 0.4)], angle: 60 };
    const result = addMatching(sim, 1).sim;
    expect(result.layers[1].eps).toBe(referenceIndex(sim.layers[0], 10) * referenceIndex(sim.layers[1], 10));
    expect(result.layers[0]).toBe(sim.layers[0]);
    expect(result.layers[2]).toBe(sim.layers[1]);
    expect(result.layers[1].sigma).toBe(0);
    expect(computeResults(result).A).toBeGreaterThan(0);
    expect(computeResults(result).T).toBeLessThan(1);
    const next = transitionMatching(result, { ...result, freq: 20 }).sim;
    expect(next.layers[1].eps).not.toBe(result.layers[1].eps);
    expect(layerEpsSigma(next.layers[0], 20).sigma).toBeGreaterThan(0);
  });

  it("does not promise improved transmission even for a finite lossless stack", () => {
    const sim = { ...base(), layers: [mkLayer("custom", 100 * C0 / (10e9 * 2 * 3), 9, 0)] };
    expect(computeResults(sim).T).toBeCloseTo(1, 12);
    expect(computeResults(addMatching(sim, 0).sim).T).toBeLessThan(computeResults(sim).T);
  });

  it("inserts at both ends and between physical media; rejects all coating neighbours", () => {
    const sim = { ...base(), layers: [mkLayer("custom", 1, 4, 0), mkLayer("custom", 1, 9, 0)] };
    for (const slot of [0, 1, 2]) expect(addMatching(sim, slot).sim.layers).toHaveLength(3);
    const first = addMatching(sim, 0).sim;
    expect(addMatching(first, 0).reason).toBe("arAdjacent");
    expect(addMatching(first, 1).reason).toBe("arAdjacent");
    const fixed = { ...first, layers: first.layers.map((l) => ({ ...l, matchingDesign: undefined })) };
    expect(addMatching(fixed, 1).reason).toBe("arAdjacent");
    expect(insertMatchingLayer(fixed.layers, 1, 10)).toBeNull();
    expect(addMatching({ ...base(), layers: [mkLayer("air", 1)] }, 0).reason).toBe("arEqual");
    expect(addMatching({ ...base(), layers: Array.from({ length: 6 }, () => mkLayer("glass", 1)) }, 0).reason).toBe("arFull");
    expect(addMatching(sim, -1).reason).toBe("arRange");
  });

  it("supports separated coatings, rebinding moves and removal; rejects invalid edits atomically", () => {
    const sim = { ...base(), layers: [mkLayer("custom", 1, 4, 0), mkLayer("custom", 1, 9, 0)] };
    const two = addMatching(addMatching(sim, 0).sim, 3).sim;
    expect(two.layers.map((l) => l.eps)).toEqual([2, 4, 9, 3]);
    const moved = transitionMatching(two, applyMove(two, 0, 1));
    expect(moved.reason).toBeNull();
    expect(moved.sim.layers[1].eps).toBe(6);
    const invalid = transitionMatching(two, applyMove(two, 0, 2));
    expect(invalid.reason).toBe("arAdjacent");
    expect(invalid.sim).toBe(two);
    const separator = { ...two, layers: [two.layers[0], two.layers[1], two.layers[3]], sel: 0 };
    const deleted = transitionMatching(separator, { ...separator, layers: [separator.layers[0], separator.layers[2]] });
    expect(deleted.reason).toBe("arAdjacent");
    expect(deleted.sim).toBe(separator);
    const one = live();
    expect(transitionMatching(one, { ...one, layers: [one.layers[0]] }).sim.layers[0].eps).toBe(1);
    expect(transitionMatching(one, { ...one, layers: [one.layers[1]], sel: 0 }).sim.layers).toEqual([one.layers[1]]);
    const outOfRange = transitionMatching(one, { ...one, freq: 0.00001 });
    expect(outOfRange.reason).toBe("arRange");
    expect(outOfRange.sim).toBe(one);
  });

  it("prevents edits, keyboard/canvas resize and duplication while leaving fixed coats editable", () => {
    const sim = live();
    expect(applyResize(sim, 0, 10)).toBe(sim);
    expect(applyStackCommand(sim, { kind: "thickness", dir: 1, factor: 1 })).toBe(sim);
    const edit = transitionMatching(sim, { ...sim, layers: [{ ...sim.layers[0], sigma: 1 }, sim.layers[1]] });
    expect(edit.reason).toBe("arReadOnly");
    expect(edit.sim).toBe(sim);
    const demo = presetState("antireflection", DEFAULT_STATE);
    expect(applyResize(demo, 0, 10).layers[0].thickness).toBe(10);
    expect(app).toContain("s.layers.length >= MAX_LAYERS || isLiveMatching(s.layers[i])");
    expect(app).toContain("disabled={full || isLiveMatching(l)}");
    expect(scene).toContain("if (live.current.params.layers[nextEdge - 1]?.readOnlyThickness) nextEdge = 0");
    expect(scene).toContain("j > 0 && !live.current.params.layers[j - 1]?.readOnlyThickness");
  });

  it("chooses the smallest supported odd multiple, with no clamping or rounding", () => {
    const m = quarterWaveMatch(1, 5, 40)!;
    expect(m.order).toBe(3);
    expect(m.cm / 3).toBeLessThan(0.1);
    expect(m.cm).toBeGreaterThanOrEqual(0.1);
    expect(quarterWaveMatch(6, 6, 10)).toBeNull();
    expect(quarterWaveMatch(1, 3, 0.00001)).toBeNull();
  });

  it("round-trips live metadata, retains legacy fixed snapshots and ignores malformed metadata", () => {
    const sim = live();
    expect(persistedFromHash(`#s=${encodeShare(sim, "en", "dark")}`)?.sim).toEqual(sim);
    const changed = { ...sim, freq: 20 };
    const saved = sanitizePersisted({ sim: changed }, defaultPersisted()).sim;
    expect(saved.layers[0].thickness).toBe(sim.layers[0].thickness / 2);
    const demo = presetState("antireflection", DEFAULT_STATE);
    expect(resolveMatching({ ...demo, freq: 12.5 }).sim.layers).toBe(demo.layers);
    for (const metadata of [undefined, "unknown", {}, true]) {
      const raw = JSON.parse(JSON.stringify(sim));
      raw.layers[0].matchingDesign = metadata;
      raw.freq = 20;
      const fixed = sanitizePersisted({ sim: raw }, defaultPersisted()).sim.layers[0];
      expect(fixed.matchingDesign).toBeUndefined();
      expect(fixed.matching).toBe(true);
      expect(fixed.thickness).toBe(sim.layers[0].thickness);
    }
  });

  it("deterministically freezes offending imported topology and range without corrupting snapshots", () => {
    const sim = live();
    const a = sim.layers[0], b = { ...a, id: "other", eps: 4 };
    const result = importMatching({ ...sim, layers: [a, b, sim.layers[1]] });
    expect(result.layers[0]).toMatchObject({ eps: a.eps, thickness: a.thickness, matching: true });
    expect(result.layers[0].matchingDesign).toBeUndefined();
    expect(result.layers[1].matchingDesign).toBeUndefined();
    const invalid = { ...sim, layers: [mkLayer("custom", 1, 30, 10), a, mkLayer("custom", 1, 30, 10)] };
    expect(importMatching(invalid).layers[1].matchingDesign).toBeUndefined();
    expect(importMatching(invalid).layers[1].eps).toBe(a.eps);
  });

  it("keeps a leading coat as the profile material and reproduces flat R/T at depth zero", () => {
    const sim = live();
    const spec = mainWallSpec({ ...DEFAULT_PROFILE, id: "square", depth: 0 }, sim.layers);
    expect(spec.customEps).toBe(sim.layers[0].eps);
    expect(spec.customSigma).toBe(0);
    expect(spec.below).toHaveLength(2);
    for (const pol of ["TE", "TM", "AVG"] as const) {
      const flat = computeResults({ ...sim, pol });
      const emt = mainEmt(spec, sim.freq, sim.angle, pol);
      expect(emt.R).toBeCloseTo(flat.R, 12);
      expect(emt.T).toBeCloseTo(flat.T, 12);
      const rcwa = solveRcwaMode(rcwaInputFor(wallAt(spec, sim.freq), sim.freq, sim.angle, pol, 3, 8));
      expect(rcwa.R).toBeCloseTo(flat.R, 10);
      expect(rcwa.T).toBeCloseTo(flat.T, 10);
    }
  });
});
