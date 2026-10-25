import { describe, expect, it } from "vitest";
import { AIR_TINT, clamp, mix, rgba, tintOf } from "./util";

describe("render/util", () => {
  it("clamp bounds a value to [min, max]", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });

  it("rgba converts hex + opacity and clamps the opacity", () => {
    expect(rgba("#83c6dd", 0.5)).toBe("rgba(131,198,221,0.5)");
    expect(rgba("#000000", 2)).toBe("rgba(0,0,0,1)");
    expect(rgba("#ffffff", -1)).toBe("rgba(255,255,255,0)");
  });

  it("mix blends two hex colors linearly", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#ff0000", "#0000ff", 0.25)).toBe("#bf0040");
  });

  it("tintOf uses the shared air tint", () => {
    expect(tintOf("air")).toBe(AIR_TINT);
    expect(AIR_TINT).toBe("#83c6dd");
  });
});
