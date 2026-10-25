import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, PROFILE_IDS, fillAt, profileSlices, sampleProfile, type ProfileParams } from "./profiles";

const profile = (over: Partial<ProfileParams>): ProfileParams => ({ ...DEFAULT_PROFILE, ...over });

describe("surface profiles", () => {
  it("has ten profiles", () => {
    expect(PROFILE_IDS).toHaveLength(10);
  });

  for (const id of PROFILE_IDS) {
    it(`${id} stays inside [0, 1] and reaches the crest`, () => {
      const pts = sampleProfile(profile({ id }), 401);
      for (const p of pts) {
        expect(p.s).toBeGreaterThanOrEqual(0);
        expect(p.s).toBeLessThanOrEqual(1);
      }
      const max = Math.max(...pts.map((p) => p.s));
      expect(max).toBeGreaterThan(id === "rough" ? 0.9 : 0.999);
      if (id !== "flat") expect(Math.min(...pts.map((p) => p.s))).toBeLessThan(0.1);
    });
  }

  it("flat profile is a full slab", () => {
    const slices = profileSlices(profile({ id: "flat", depth: 5 }), 16);
    expect(slices).toEqual([{ cm: 5, t: 0.5, fill: 1, segments: [[0, 1]] }]);
  });

  it("triangle and sawtooth fill grows linearly with depth", () => {
    for (const id of ["triangle", "sawtooth"] as const) {
      for (const t of [0.1, 0.35, 0.8]) expect(Math.abs(fillAt(profile({ id }), t) - t)).toBeLessThan(2e-3);
    }
  });

  it("créneaux keep their duty cycle and collapse to one slice", () => {
    const p = profile({ id: "square", fill: 0.3, depth: 2 });
    expect(fillAt(p, 0.5)).toBeCloseTo(0.3, 3);
    const slices = profileSlices(p, 16);
    expect(slices).toHaveLength(1);
    expect(slices[0].cm).toBeCloseTo(2, 12);
  });

  it("slice thicknesses add up to the depth", () => {
    for (const id of PROFILE_IDS) {
      const p = profile({ id, depth: 1.7 });
      const total = profileSlices(p, 20).reduce((s, q) => s + q.cm, 0);
      expect(total).toBeCloseTo(1.7, 10);
    }
  });

  it("rough profile is deterministic for a seed", () => {
    const a = sampleProfile(profile({ id: "rough", seed: 3 }), 50);
    const b = sampleProfile(profile({ id: "rough", seed: 3 }), 50);
    const c = sampleProfile(profile({ id: "rough", seed: 4 }), 50);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
