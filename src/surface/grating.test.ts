import { describe, expect, it } from "vitest";
import { DEG } from "../physics";
import { blazeDepthCm, lambdaCm, littrowDeg, propagatingOrders } from "./grating";

describe("grating equation", () => {
  it("normal incidence with Λ = 2λ gives orders 0 and ±1 at ±30°", () => {
    const f = 10;
    const orders = propagatingOrders(f, 0, 2 * lambdaCm(f));
    expect(orders.map((o) => o.m)).toEqual([-1, 0, 1]);
    expect(orders[0].angleDeg).toBeCloseTo(-30, 9);
    expect(orders[2].angleDeg).toBeCloseTo(30, 9);
  });

  it("subwavelength period keeps only the specular order", () => {
    expect(propagatingOrders(10, 40, 0.5).map((o) => o.m)).toEqual([0]);
  });

  it("Littrow angle sends order −1 back to the source", () => {
    const f = 10;
    const period = 3;
    const lit = littrowDeg(f, period);
    expect(Math.sin(lit * DEG)).toBeCloseTo(lambdaCm(f) / (2 * period), 12);
    const back = propagatingOrders(f, lit, period).find((o) => o.m === -1);
    expect(back?.angleDeg).toBeCloseTo(-lit, 9);
    expect(blazeDepthCm(period, lit)).toBeCloseTo(period * Math.tan(lit * DEG), 12);
  });

  it("Littrow is impossible when Λ < λ/2", () => {
    expect(littrowDeg(10, 1)).toBeNaN();
  });
});
