import { describe, expect, it } from "vitest";
import { mkLayer } from "./layers";
import { computeResults, stackSweepKey, type SimState } from "./results";

const base: SimState = {
  layers: [mkLayer("glass", 0.4), mkLayer("air", 1.6), mkLayer("glass", 0.4)],
  sel: 0,
  freq: 5,
  angle: 35,
  pol: "TE",
};

const keyOf = (s: SimState) => {
  const r = computeResults(s);
  return stackSweepKey(r.etas, r.ds, s.freq);
};

describe("stackSweepKey", () => {
  it("ignores angle, polarization and selection", () => {
    expect(keyOf({ ...base, angle: 10, pol: "TM", sel: 2 })).toBe(keyOf(base));
  });

  it("changes with frequency and thickness", () => {
    expect(keyOf({ ...base, freq: 6 })).not.toBe(keyOf(base));
    expect(keyOf({ ...base, layers: base.layers.map((l, i) => (i === 1 ? { ...l, thickness: 2 } : l)) })).not.toBe(keyOf(base));
  });
});
