import { describe, expect, it } from "vitest";
import { cx } from "../physics";
import { cmDiag, cmEye, cmExpm, cmGet, cmInv, cmMul, cmScale, cmSqrtm, cmSub, cmNorm1, type CMat } from "./cmat";

const sample = (): CMat => {
  const m = cmDiag([cx(2, 1), cx(-1, 0.5), cx(3, -2)]);
  m.re[1] = 0.4;
  m.im[2] = -0.3;
  m.re[5] = 0.7;
  m.im[6] = 0.2;
  return m;
};

describe("complex matrices", () => {
  it("inverse times matrix is the identity", () => {
    const a = sample();
    expect(cmNorm1(cmSub(cmMul(cmInv(a), a), cmEye(3)))).toBeLessThan(1e-12);
  });

  it("expm of a diagonal matrix is the element-wise exponential", () => {
    const e = cmExpm(cmDiag([cx(-3, 2), cx(0.5, -1)]));
    const a = cmGet(e, 0, 0);
    expect(a.re).toBeCloseTo(Math.exp(-3) * Math.cos(2), 12);
    expect(a.im).toBeCloseTo(Math.exp(-3) * Math.sin(2), 12);
    const b = cmGet(e, 1, 1);
    expect(b.re).toBeCloseTo(Math.exp(0.5) * Math.cos(-1), 12);
    expect(b.im).toBeCloseTo(Math.exp(0.5) * Math.sin(-1), 12);
  });

  it("expm(A)·expm(−A) is the identity for a large-norm matrix", () => {
    const a = cmScale(sample(), cx(0, 40));
    const p = cmMul(cmExpm(a), cmExpm(cmScale(a, cx(-1))));
    expect(cmNorm1(cmSub(p, cmEye(3)))).toBeLessThan(1e-8);
  });

  it("sqrtm squares back and returns its inverse", () => {
    const a = sample();
    const { root, invRoot } = cmSqrtm(a);
    expect(cmNorm1(cmSub(cmMul(root, root), a))).toBeLessThan(1e-10);
    expect(cmNorm1(cmSub(cmMul(root, invRoot), cmEye(3)))).toBeLessThan(1e-10);
  });

  it("sqrtm handles a wide eigenvalue spread (metal-like)", () => {
    const a = cmDiag([cx(1.8e7, 1), cx(0.2, -0.9), cx(3, 0)]);
    const { root } = cmSqrtm(a);
    expect(cmNorm1(cmSub(cmMul(root, root), a)) / 1.8e7).toBeLessThan(1e-10);
  });
});
