import { describe, expect, it } from "vitest";
import { cx } from "../physics";
import { waterPermittivity } from "./water";
import { NO_INCLUSIONS, inclusionValidity, maxwellGarnett, mixedEta } from "./mixing";
import { FOG_PRESETS, NO_FOG, fogDbPerKm, fogKl, fogLossDb, withFog } from "./fog";

describe("water permittivity (double Debye)", () => {
  it("static limit is about 80 at 20 °C", () => {
    const w = waterPermittivity(0.001, 20);
    expect(w.re).toBeGreaterThan(79);
    expect(w.re).toBeLessThan(81.5);
    expect(-w.im).toBeLessThan(1);
  });

  it("10 GHz at 20 °C is lossy and dispersive", () => {
    const w = waterPermittivity(10, 20);
    expect(w.re).toBeGreaterThan(55);
    expect(w.re).toBeLessThan(66);
    expect(-w.im).toBeGreaterThan(28);
    expect(-w.im).toBeLessThan(36);
  });
});

describe("Maxwell Garnett bubbles", () => {
  const host = cx(5.24, -0.5);

  it("fraction 0 is the host and fraction 1 the inclusion", () => {
    expect(maxwellGarnett(host, cx(1), 0)).toEqual(host);
    expect(maxwellGarnett(host, cx(1), 1)).toEqual(cx(1));
    const near = maxwellGarnett(host, cx(1), 1 - 1e-9);
    expect(near.re).toBeCloseTo(1, 6);
  });

  it("air bubbles lower ε′, water bubbles raise losses", () => {
    const air = maxwellGarnett(host, cx(1), 0.3);
    expect(air.re).toBeLessThan(host.re);
    expect(air.re).toBeGreaterThan(1);
    const wet = mixedEta(host, { ...NO_INCLUSIONS, kind: "water", fraction: 0.1 }, 5);
    expect(-wet.im).toBeGreaterThan(-host.im);
  });

  it("no bubbles leaves the layer untouched", () => {
    expect(mixedEta(host, NO_INCLUSIONS, 5)).toBe(host);
  });

  it("rates validity from size and dilution", () => {
    expect(inclusionValidity(host, { ...NO_INCLUSIONS, fraction: 0.2, diameterMm: 1 }, 2.4)).toBe("ok");
    expect(inclusionValidity(host, { ...NO_INCLUSIONS, fraction: 0.2, diameterMm: 10 }, 28)).toBe("invalid");
    expect(inclusionValidity(host, { ...NO_INCLUSIONS, fraction: 0.7, diameterMm: 1 }, 2.4)).toBe("marginal");
  });
});

describe("fog (ITU-R P.840)", () => {
  it("K_l has the expected magnitude and rises with frequency", () => {
    const k10 = fogKl(10, 20);
    const k30 = fogKl(30, 20);
    expect(k10).toBeGreaterThan(0.03);
    expect(k10).toBeLessThan(0.08);
    expect(k30).toBeGreaterThan(0.3);
    expect(k30).toBeLessThan(0.7);
    expect(fogKl(100, 20)).toBeGreaterThan(k30);
  });

  it("attenuation is linear in water content and distance", () => {
    expect(fogDbPerKm(28, 0.5)).toBeCloseTo(10 * fogDbPerKm(28, 0.05), 12);
    expect(fogLossDb(28, 0.5, 200)).toBeCloseTo(2 * fogLossDb(28, 0.5, 100), 12);
  });

  it("no fog leaves R and T unchanged", () => {
    const r = withFog(0.3, 0.5, NO_FOG, 28);
    expect(r.R).toBe(0.3);
    expect(r.T).toBe(0.5);
    expect(r.lossDb).toBe(0);
  });

  it("thick fog over 20 m at 28 GHz costs well under 1 dB", () => {
    const r = withFog(0.3, 0.5, { ...NO_FOG, lwc: FOG_PRESETS.thick }, 28);
    expect(r.lossDb).toBeGreaterThan(0);
    expect(r.lossDb).toBeLessThan(1);
    expect(r.T).toBeLessThan(0.5);
  });
});
