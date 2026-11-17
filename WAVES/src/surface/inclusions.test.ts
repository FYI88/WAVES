import { describe, expect, it } from "vitest";
import { mixedEta, NO_INCLUSIONS, inclusionValidity } from "../media/mixing";
import { surfaceEta } from "./materials";
import { DEFAULT_LAB } from "./labState";
import { emtSolve } from "./emt";
import { detailPaths } from "./detailPaths";
import { runJob, wallAt, type WallSpec } from "./rcwaJobs";
import { drawSurfaceDetail, type DetailParams } from "./surfaceDetail";
import { PALETTES } from "../theme";

const spec: WallSpec = { ...DEFAULT_LAB, below: [
  { material: "brick", cm: 3, customEps: 4, customSigma: 0.05 },
  { material: "custom", cm: 1, customEps: 16, customSigma: 0.03 },
], inclusions: { ...NO_INCLUSIONS, fraction: 0.1 }, inclusionTarget: "all" };

describe("whole lab wall inclusions", () => {
  it.each(["air", "water"] as const)("mixes %s independently into the profile and every backing host", (kind) => {
    for (const freq of [1, 5, 28]) {
      const inc = { ...spec.inclusions!, kind, tempC: 30 };
      const wall = wallAt({ ...spec, inclusions: inc }, freq);
      const eta = mixedEta(surfaceEta(spec.material, freq, spec.customEps, spec.customSigma), inc, freq);
      const below = spec.below.map((l) => ({ cm: l.cm, eta: mixedEta(surfaceEta(l.material, freq, l.customEps, l.customSigma), inc, freq) }));
      expect(wall.eta).toEqual(eta);
      expect(wall.below).toEqual(below);
      expect(emtSolve(wall.profile, wall.eta, wall.below, freq, 30, "AVG", 12)).toEqual(emtSolve(spec.profile, eta, below, freq, 30, "AVG", 12));
      expect(detailPaths(wall.profile, wall.eta, wall.below, freq, 30, "AVG", 12)).toEqual(detailPaths(spec.profile, eta, below, freq, 30, "AVG", 12));
    }
  });

  it("rates the worst original host rather than only the selected/profile material", () => {
    const inc = { ...NO_INCLUSIONS, fraction: 0.1, diameterMm: 4 };
    const wallSpec: WallSpec = { ...spec, material: "custom", customEps: 1, customSigma: 0, inclusions: inc };
    expect(inclusionValidity(surfaceEta("custom", 5, 1, 0), inc, 5)).toBe("ok");
    expect(wallAt(wallSpec, 5).mixValidity).toBe("invalid");
    expect(wallAt({ ...wallSpec, inclusionTarget: -1 }, 5).mixValidity).toBe("ok");
    expect(wallAt({ ...wallSpec, below: [wallSpec.below[0]] }, 5).mixValidity).toBe("marginal");
  });

  it.each([-1, 0, 1])("retains legacy target %s without mixing the other hosts", (target) => {
    const wall = wallAt({ ...spec, inclusionTarget: target }, 5);
    const dry = wallAt({ ...spec, inclusions: undefined }, 5);
    expect(wall.eta).toEqual(target === -1 ? mixedEta(dry.eta, spec.inclusions!, 5) : dry.eta);
    wall.below.forEach((l, i) => expect(l.eta).toEqual(i === target ? mixedEta(dry.below[i].eta, spec.inclusions!, 5) : dry.below[i].eta));
  });

  it("worker RCWA consumes the same whole mixed flat wall as EMT", () => {
    const flat = { ...spec, profile: { ...spec.profile, id: "flat" as const } };
    const wall = wallAt(flat, 5);
    const expected = emtSolve(wall.profile, wall.eta, wall.below, 5, 30, "AVG", 8);
    const got = runJob({ id: 1, kind: "point", wall: flat, pol: "AVG", harmonics: 2, slices: 8, fGHz: 5, thetaDeg: 30 }) as typeof expected;
    expect(got.R).toBeCloseTo(expected.R, 9);
    expect(got.T).toBeCloseTo(expected.T, 9);
    expect(got.A).toBeCloseTo(expected.A, 9);
  });

  it("draws whole-wall bubbles in the profile and every backing region", () => {
    const bubbles: Array<{ x: number; y: number; r: number }> = [];
    const ctx = new Proxy({}, { get: (_target, key) => {
      if (key === "measureText") return (text: string) => ({ width: text.length * 5 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "arc") return (x: number, y: number, r: number) => { if (Math.abs(r - 2.6625) < 1e-9) bubbles.push({ x, y, r }); };
      return () => {};
    }, set: () => true }) as CanvasRenderingContext2D;
    const params: DetailParams = { profile: { ...spec.profile, id: "flat" }, tint: "#aaaabb", materialName: "Profile",
      below: spec.below.map((l, i) => ({ tint: "#aaaabb", cm: l.cm, name: `Layer ${i + 1}` })),
      thetaDeg: 0, frequency: 5, pol: "TE", R: 0.2, T: 0.7, orders: null, slices: null,
      bubbles: { fraction: 0.1, diameterMm: 2, water: false, target: "all" }, fog: 0, lang: "en", normals: false };
    const draw = (target: number | "all") => {
      bubbles.length = 0;
      drawSurfaceDetail(ctx, 800, 500, 0, { ...params, bubbles: { ...params.bubbles!, target } }, PALETTES.dark, String);
      return [...bubbles];
    };
    const each = [-1, 0, 1].map(draw);
    each.forEach((region) => expect(region.length).toBeGreaterThan(0));
    expect(draw("all")).toEqual(each.flat());
  });
});
