import { describe, expect, it } from "vitest";
import { encodeShare } from "../share";
import { embeddedQuarterWave, insertMatchingLayer, mkLayer, quarterWaveMatch } from "./layers";
import { defaultPersisted, persistedFromHash, sanitizePersisted } from "./persistence";
import { DEFAULT_STATE, presetState } from "./presets";
import { computeResults } from "./results";

describe("quarter-wave matching", () => {
  it("offers an internal quarter-wave demo with a measurable nontrivial improvement", () => {
    // Keep the numerical demonstration as a regression fixture, not a UI preset
    // that would replace the user's existing walls.
    const demo = { ...DEFAULT_STATE, layers: [{ ...mkLayer("custom", 3.55, 9, 0.01), embeddedInsert: {
      enabled: false, eps: 4, thickness: embeddedQuarterWave(2, 10, 3.55)!,
    } }], sel: 0, freq: 10, angle: 0, pol: "AVG" as const };
    const wall = demo.layers[0];
    expect(demo).toMatchObject({ sel: 0, freq: 10, angle: 0, pol: "AVG" });
    expect(wall.embeddedInsert).toMatchObject({ enabled: false, eps: 4 });
    expect(wall.embeddedInsert!.thickness).toBe(embeddedQuarterWave(2, 10, wall.thickness));
    expect(wall.embeddedInsert!.thickness / wall.thickness).toBeLessThan(0.11);
    for (const pol of ["TE", "TM", "AVG"] as const) {
      const before = computeResults({ ...demo, pol });
      const enabled = { ...demo, pol, layers: [{ ...wall, embeddedInsert: { ...wall.embeddedInsert!, enabled: true } }] };
      const after = computeResults(enabled);
      expect(before.R).toBeCloseTo(0.14813338110944957, 10);
      expect(before.T).toBeCloseTo(0.7915840259421953, 10);
      expect(after.R).toBeCloseTo(0.0038680438177606715, 10);
      expect(after.T).toBeCloseTo(0.9301462920330921, 10);
      expect(after.A).toBeGreaterThan(before.A); // Improvement is not just removal of absorption.
      expect(after.A).toBeGreaterThan(0.06);
      expect(after.T).toBeLessThan(1);
      expect(after.totalCm).toBe(before.totalCm);
      expect(after.R + after.T + after.A).toBeCloseTo(1, 12);
      expect(computeResults({ ...enabled, freq: 12.5 }).R).toBeGreaterThan(0.3);
      const restored = computeResults({ ...enabled, layers: [{ ...wall, embeddedInsert: { ...wall.embeddedInsert!, enabled: false } }] });
      expect(restored.R).toBe(before.R);
      expect(restored.T).toBe(before.T);
    }
    expect(persistedFromHash(`#s=${encodeShare(demo, "fr", "light")}`)?.sim).toEqual(demo);
  });
  it("inserts a distinct coating between real materials without changing them", () => {
    const layers = [mkLayer("glass", 0.4), mkLayer("concrete", 12)];
    const original = JSON.stringify(layers);
    const result = insertMatchingLayer(layers, 1, 10)!;
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(layers[0]);
    expect(result[2]).toBe(layers[1]);
    expect(result[1]).toMatchObject({ mat: "custom", matching: true, sigma: 0 });
    expect(JSON.stringify(layers)).toBe(original);
    const sim = { ...DEFAULT_STATE, layers: result };
    expect(persistedFromHash(`#s=${encodeShare(sim, "en", "dark")}`)?.sim.layers[1].matching).toBe(true);
    expect(insertMatchingLayer(Array.from({ length: 6 }, () => layers[0]), 0, 10)).toBeNull();
    expect(insertMatchingLayer([layers[0], layers[0]], 1, 10)).toBeNull();
  });
  it("designs a lossless quarter-wave layer and uses odd multiples for thin coatings", () => {
    const match = quarterWaveMatch(1, 3, 10)!;
    expect(match.eps).toBe(3);
    expect(match.cm).toBeCloseTo(0.4327131408182989, 12);
    const thin = quarterWaveMatch(1, 5, 40)!;
    expect(thin.cm).toBeCloseTo(0.25138361821115646, 12);
    for (const args of [[0, 3, 10], [1, 3, NaN], [1, 40, 10], [1, 3, 1e-9]]) {
      expect(quarterWaveMatch(args[0], args[1], args[2])).toBeNull();
    }
  });

  it("the ideal demo reaches full transmission for TE, TM and AVG without changing the solver", () => {
    const demo = presetState("antireflection", DEFAULT_STATE);
    for (const pol of ["TE", "TM", "AVG"] as const) {
      const result = computeResults({ ...demo, pol });
      expect(result.R).toBeLessThan(1e-12);
      expect(result.T).toBeCloseTo(1, 12);
      expect(result.A).toBeLessThan(1e-12);
    }
    const bare = computeResults({ ...demo, layers: [demo.layers[1]] });
    expect(bare.T).toBeCloseTo(0.36, 4);
    expect(computeResults({ ...demo, freq: 12.5 }).T).toBeLessThan(0.9);
    const detuned = demo.layers.map((l, i) => i === 1 ? l : { ...l, thickness: l.thickness / 2 });
    expect(computeResults({ ...demo, layers: detuned }).T).toBeLessThan(0.8);
  });

  it("preserves exact thickness and zero conductivity through persistence and sharing", () => {
    const demo = presetState("antireflection", DEFAULT_STATE);
    const saved = sanitizePersisted(JSON.parse(JSON.stringify({ sim: demo, lang: "en", theme: "dark" })), defaultPersisted());
    expect(saved.sim).toEqual(demo);
    expect(persistedFromHash(`#s=${encodeShare(demo, "en", "dark")}`)?.sim).toEqual(demo);
  });

  it("keeps real-wall absorption when adding an ideal matching layer", () => {
    const wall = mkLayer("glass", 0.4);
    const base = { ...DEFAULT_STATE, layers: [wall], freq: 10, angle: 0 };
    const n = computeResults(base).layers[0].nRe;
    const match = quarterWaveMatch(1, n, base.freq)!;
    const result = computeResults({ ...base, layers: [mkLayer("custom", match.cm, match.eps, 0), wall] });
    expect(result.A).toBeGreaterThan(0);
    expect(result.T).toBeLessThan(1);
    expect(result.R + result.T + result.A).toBeCloseTo(1, 12);
    expect(wall).toEqual(base.layers[0]);
  });
});
