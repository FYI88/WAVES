import { describe, expect, it, vi } from "vitest";
import { drawSpatialScene } from "../spatialScene";
import { PALETTES } from "../theme";
import { DEFAULT_PROFILE } from "../surface/profiles";
import { propagatingOrders } from "../surface/grating";
import { drawWaveRays } from "../waveRays";

vi.mock("../materialSurfaces", () => ({ drawMaterialSurface() {} }));

describe("diffraction display", () => {
  it.each([[NaN, 900, 600, "dark"], [0.12, 900, 600, "light"], [NaN, 390, 506, "light"], [0.12, 640, 320, "dark"]] as const)("draws optional spatial orders with power %s at %s×%s (%s)", (power, w, h, theme) => {
    const labels: string[] = [];
    let strokes = 0;
    const ctx = new Proxy({}, { get: (_target, key) => {
      if (key === "measureText") return (text: string) => ({ width: text.length * 5 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "fillText") return (text: string) => labels.push(text);
      if (key === "stroke") return () => { strokes++; };
      return () => {};
    }, set: () => true }) as CanvasRenderingContext2D;
    const profile = { ...DEFAULT_PROFILE, id: "sine" as const, period: 8 };
    const orders = propagatingOrders(5, 30, profile.period).map(o => ({ ...o, R: power, T: power }));
    expect(orders.some(o => o.m !== 0)).toBe(true);
    const params = { theta: 30, R: 0.2, T: 0.7, layers: [
      { mat: "brick" as const, cm: 10, thetaT: 15, nRe: 2, absorbed: 0.1, fluxIn: 0.8, fluxOut: 0.7, name: "Brick" },
    ], sel: 0, hover: -1, freq: 5, pol: "TE" as const,
    labels: { normal: "Normal", tx: "Tx", rx: "Rx", refl: "R" }, surface: { profile, orders } };
    const options = { display: "both" as const, annotations: true, az: 0.45, el: 0.45, lang: "en" as const };
    drawSpatialScene(ctx, w, h, 0, 1, { ...params, surface: { profile, orders: undefined } }, PALETTES[theme], String, options);
    const baseline = strokes;
    expect(labels.some(text => text.includes("m−1") || text.includes("m-1"))).toBe(false);
    drawSpatialScene(ctx, w, h, 0, 1, params, PALETTES[theme], String, options);
    expect(labels.some(text => text.includes("m-1"))).toBe(true);
    expect(strokes - baseline).toBeGreaterThan(baseline);
    expect(labels.join(" ")).toContain(Number.isFinite(power) ? "12" : "schematic");
    labels.length = 0;
    drawSpatialScene(ctx, w, h, 0, 1, { ...params, surface: { profile, orders: orders.map(o => ({ ...o, R: 0, T: 0 })) } }, PALETTES[theme], String, options);
    expect(labels.some(text => text.includes("m-1"))).toBe(false);
  });

  it("balances compact section canvas state when higher-order labels are hidden", () => {
    let depth = 0;
    const ctx = new Proxy({}, { get: (_target, key) => {
      if (key === "save") return () => { depth++; };
      if (key === "restore") return () => { depth--; };
      if (key === "measureText") return (text: string) => ({ width: text.length * 5 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      return () => {};
    }, set: () => true }) as CanvasRenderingContext2D;
    drawWaveRays(ctx, 390, 506, 0, { theta: 30, R: 0.2, T: 0.7, freq: 10, pol: "TE", sel: 0, hover: -1,
      etas: [{ re: 1, im: 0 }, { re: 4, im: 0 }, { re: 1, im: 0 }], ds: [0.1],
      layers: [{ mat: "brick", cm: 10, thetaT: 15, nRe: 2, fluxIn: 0.8, fluxOut: 0.7, name: "Brick" }],
      surface: { profile: { ...DEFAULT_PROFILE, id: "sine", period: 12 }, orders: [{ m: -2, angleDeg: -30, R: NaN, T: NaN }] },
    }, PALETTES.dark, String, { display: "both", reflections: false, annotations: true, lang: "en" });
    expect(depth).toBe(0);
  });
});
