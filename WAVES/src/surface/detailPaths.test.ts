import { describe, expect, it } from "vitest";
import { emtSolve } from "./emt";
import { surfaceEta } from "./materials";
import { DEFAULT_PROFILE } from "./profiles";
import { detailPaths } from "./detailPaths";

const f = 5;
const eta = surfaceEta("concrete", f);
const below = [{ eta: surfaceEta("plasterboard", f), cm: 1.3 }, { eta: surfaceEta("glass", f), cm: 0.6 }];

describe("lab detail internal paths", () => {
  it("one segment for the profile and one per flat layer", () => {
    const segs = detailPaths({ ...DEFAULT_PROFILE, id: "triangle", depth: 2 }, eta, below, f, 30, "TE", 16);
    expect(segs.map((s) => s.kind)).toEqual(["profile", "layer", "layer"]);
  });

  it("fluxes match the solver: 1 - R in, T out, partial reflections in range", () => {
    const prof = { ...DEFAULT_PROFILE, id: "square" as const, depth: 2 };
    const segs = detailPaths(prof, eta, below, f, 35, "TE", 16);
    const ref = emtSolve(prof, eta, below, f, 35, "TE", 16);
    expect(segs[0].fluxIn).toBeCloseTo(1 - ref.R, 9);
    expect(segs[segs.length - 1].fluxOut).toBeCloseTo(ref.T, 9);
    segs.forEach((s) => expect(s.back).toBeLessThanOrEqual(1));
    expect(segs[0].back).toBeGreaterThan(0);
  });
});
