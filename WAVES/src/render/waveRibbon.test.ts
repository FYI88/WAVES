import { describe, expect, it, vi } from "vitest";
import { drawWaveRibbon, visualWavelength, waveEnvelope, type WaveStyle } from "./waveRibbon";

const style: WaveStyle = { time: 0.25, frequency: 2.4, compact: false, dark: true, display: "both", pol: "TE" };
function context() {
  const gradient = { addColorStop: vi.fn() };
  const methods = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
    quadraticCurveTo: vi.fn(), arc: vi.fn(), fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient), createRadialGradient: vi.fn(() => gradient),
  };
  return { ctx: methods as unknown as CanvasRenderingContext2D, methods };
}

describe("shared wave visual language", () => {
  it("uses the original section frequency and refractive-index scale", () => {
    expect(visualWavelength(2.4, false)).toBe(70);
    expect(visualWavelength(2.4, true)).toBe(49);
    expect(visualWavelength(2.4, false, 2)).toBe(35);
    expect(visualWavelength(40, false)).toBeLessThan(visualWavelength(0.5, false));
    expect(visualWavelength(40, true, 100)).toBe(10);
  });
  it("uses square-root power envelopes and distinguishes unknown from zero", () => {
    expect(waveEnvelope(0.25, 0.25, 0.5)).toBe(0.5);
    expect(waveEnvelope(1, 0, 0.75)).toBe(0.5);
    expect(waveEnvelope(0, 0, 0.5)).toBe(0);
    expect(waveEnvelope(null, null, 0.5)).toBe(0.45);
    expect(waveEnvelope(1, 0, 2)).toBe(0);
  });
  it.each(["field", "fronts", "both"] as const)("renders %s with balanced canvas state and continuous phase", (display) => {
    const { ctx, methods } = context();
    const phase = drawWaveRibbon(ctx, { x: 0, y: 0 }, { x: 140, y: 0 }, "#55dbf5", 1, 0.25, 1, 0.3, { ...style, display });
    expect(phase).toBeCloseTo(0.3 + 4 * Math.PI, 12);
    expect(methods.save).toHaveBeenCalledTimes(1);
    expect(methods.restore).toHaveBeenCalledTimes(1);
    expect(methods.closePath.mock.calls.length > 0).toBe(display !== "fronts");
    expect(methods.quadraticCurveTo.mock.calls.length > 0).toBe(display !== "field");
  });
  it("renders schematic, vertical and reversed rays without NaN coordinates", () => {
    for (const to of [{ x: 0, y: 140 }, { x: -140, y: 0 }]) {
      const { ctx, methods } = context();
      drawWaveRibbon(ctx, { x: 0, y: 0 }, to, "#79e2bc", null, null, 1, 0, style);
      for (const call of [...methods.moveTo.mock.calls, ...methods.lineTo.mock.calls, ...methods.quadraticCurveTo.mock.calls]) {
        expect(call.every(Number.isFinite)).toBe(true);
      }
      expect(methods.closePath).toHaveBeenCalled();
    }
  });
  it("zero power draws only a guide, and a zero-length segment draws nothing", () => {
    const { ctx, methods } = context();
    drawWaveRibbon(ctx, { x: 0, y: 0 }, { x: 140, y: 0 }, "#55dbf5", 0, 0, 1, 0, style);
    expect(methods.closePath).not.toHaveBeenCalled();
    expect(methods.quadraticCurveTo).not.toHaveBeenCalled();
    methods.save.mockClear();
    expect(drawWaveRibbon(ctx, { x: 1, y: 1 }, { x: 1, y: 1 }, "#55dbf5", 1, 1, 1, 0.3, style)).toBe(0.3);
    expect(methods.save).not.toHaveBeenCalled();
  });
});
