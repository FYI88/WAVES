import { describe, expect, it } from "vitest";
import { DEG, cx, solveStack, type Pol } from "../physics";
import { emtSliceEps, emtSolve, emtValidity } from "./emt";
import { DEFAULT_PROFILE } from "./profiles";
import { surfaceEta } from "./materials";

describe("effective-medium fast mode", () => {
  for (const pol of ["TE", "TM"] as Pol[]) {
    it(`flat profile is exactly the existing slab model (${pol})`, () => {
      const eta = surfaceEta("concrete", 3.5);
      const below = [{ eta: surfaceEta("plasterboard", 3.5), cm: 1.3 }];
      const got = emtSolve({ ...DEFAULT_PROFILE, id: "flat", depth: 18 }, eta, below, 3.5, 30, pol);
      const ref = solveStack([eta, below[0].eta], [0.18, 0.013], 3.5, 30 * DEG, pol);
      expect(got.R).toBeCloseTo(ref.R, 12);
      expect(got.T).toBeCloseTo(ref.T, 12);
      expect(got.A).toBeCloseTo(ref.A, 12);
    });
  }

  it("depth 0 leaves only the flat layers", () => {
    const eta = surfaceEta("glass", 5);
    const got = emtSolve({ ...DEFAULT_PROFILE, id: "triangle", depth: 0 }, eta, [{ eta, cm: 0.4 }], 5, 35, "TE");
    const ref = solveStack([eta], [0.004], 5, 35 * DEG, "TE");
    expect(got.R).toBeCloseTo(ref.R, 12);
  });

  it("slice permittivity spans air to material, TM below TE", () => {
    const eta = cx(6, 0);
    expect(emtSliceEps(0, eta, "TE").re).toBeCloseTo(1, 12);
    expect(emtSliceEps(1, eta, "TM").re).toBeCloseTo(6, 12);
    const te = emtSliceEps(0.5, eta, "TE").re;
    const tm = emtSliceEps(0.5, eta, "TM").re;
    expect(te).toBeCloseTo(3.5, 12);
    expect(tm).toBeLessThan(te);
    expect(tm).toBeGreaterThan(1);
  });

  it("validity follows the period-to-wavelength ratio", () => {
    expect(emtValidity(0.1, 2.4, 0, cx(5, 0))).toBe("ok");
    expect(emtValidity(10, 10, 30, cx(5, 0))).toBe("invalid");
  });

  it("R + T + A = 1 for every profile", () => {
    const eta = surfaceEta("brick", 2.4);
    for (const id of ["triangle", "bumps", "square", "rough"] as const) {
      const r = emtSolve({ ...DEFAULT_PROFILE, id, depth: 2 }, eta, [{ eta, cm: 8 }], 2.4, 20, "AVG");
      expect(r.R + r.T + r.A).toBeCloseTo(1, 9);
    }
  });
});
