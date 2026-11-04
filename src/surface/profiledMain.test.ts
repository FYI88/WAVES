import { describe, expect, it } from "vitest";
import type { PolMode } from "../physics";
import { mkLayer } from "../state/layers";
import { computeResults } from "../state/results";
import { DEFAULT_PROFILE } from "./profiles";
import { mainEmt, mainEmtValidity, mainWallSpec } from "./profiledMain";

const glazing = () => [mkLayer("glass", 0.4), mkLayer("air", 1.6), mkLayer("glass", 0.4)];
const customWall = () => [mkLayer("custom", 2, 6.5, 0.3), mkLayer("concrete", 12)];

describe("profiled main wall", () => {
  for (const pol of ["TE", "TM", "AVG"] as PolMode[]) {
    it(`depth 0 reproduces the flat main result (${pol})`, () => {
      for (const layers of [glazing(), customWall()]) {
        const flat = computeResults({ layers, sel: 0, freq: 5.2, angle: 35, pol });
        const got = mainEmt(mainWallSpec({ ...DEFAULT_PROFILE, id: "square", depth: 0 }, layers), 5.2, 35, pol, 24);
        expect(got.R).toBeCloseTo(flat.R, 12);
        expect(got.T).toBeCloseTo(flat.T, 12);
        expect(got.A).toBeCloseTo(flat.A, 12);
      }
    });
  }

  it("a flat profile of depth h is the first layer made h thicker", () => {
    const layers = customWall();
    const h = 1.5;
    const thick = [{ ...layers[0], thickness: layers[0].thickness + h }, layers[1]];
    const ref = computeResults({ layers: thick, sel: 0, freq: 3.5, angle: 20, pol: "TE" });
    const got = mainEmt(mainWallSpec({ ...DEFAULT_PROFILE, id: "flat", depth: h }, layers), 3.5, 20, "TE", 24);
    expect(got.R).toBeCloseTo(ref.R, 10);
    expect(got.T).toBeCloseTo(ref.T, 10);
  });

  it("a profile cut in an air first layer changes nothing", () => {
    const layers = [mkLayer("air", 2), mkLayer("brick", 10)];
    const flat = computeResults({ layers, sel: 0, freq: 10, angle: 30, pol: "TM" });
    const got = mainEmt(mainWallSpec({ ...DEFAULT_PROFILE, id: "triangle", depth: 3 }, layers), 10, 30, "TM", 24);
    expect(got.R).toBeCloseTo(flat.R, 10);
    expect(got.T).toBeCloseTo(flat.T, 10);
  });

  it("a real profile changes R and conserves energy", () => {
    const layers = customWall();
    const flat = computeResults({ layers, sel: 0, freq: 10, angle: 30, pol: "TE" });
    const got = mainEmt(mainWallSpec({ ...DEFAULT_PROFILE, id: "triangle", depth: 2 }, layers), 10, 30, "TE", 24);
    expect(Math.abs(got.R - flat.R)).toBeGreaterThan(1e-4);
    expect(got.R + got.T + got.A).toBeCloseTo(1, 9);
  });

  it("uses the lab's EMT validity rule", () => {
    const layers = customWall();
    expect(mainEmtValidity(mainWallSpec({ ...DEFAULT_PROFILE, id: "square", period: 0.2 }, layers), 1, 0)).toBe("ok");
    expect(mainEmtValidity(mainWallSpec({ ...DEFAULT_PROFILE, id: "square", period: 10 }, layers), 10, 0)).toBe("invalid");
    expect(mainEmtValidity(mainWallSpec({ ...DEFAULT_PROFILE, id: "flat", period: 10 }, layers), 10, 0)).toBe("ok");
  });
});
