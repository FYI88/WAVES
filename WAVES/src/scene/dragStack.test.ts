import { describe, expect, it } from "vitest";
import {
  THICKNESS,
  applyMove,
  applyResize,
  applyStackCommand,
  clampThickness,
  dropSlot,
  hitBoundary,
  isNoopDrop,
  moveInStack,
  nearestSlot,
  nudgeThickness,
  slotToIndex,
  stackKeyCommand,
  thicknessFromBoundaryDrag,
} from "./dragStack";

const L = (id: string, thickness = 1) => ({ id, thickness });
const state = (sel: number, ids = ["a", "b", "c", "d"]) => ({ layers: ids.map((id) => L(id)), sel, freq: 5 });
const ids = (s: { layers: { id: string }[] }) => s.layers.map((l) => l.id).join("");

/** same boundary layout as waveRays.ts */
function layout(cms: number[], x0 = 100, span = 200, minWidth = 20) {
  const total = cms.reduce((a, b) => a + b, 0);
  const bx = [x0];
  cms.forEach((cm) => bx.push(bx[bx.length - 1] + minWidth + ((span - minWidth * cms.length) * cm) / total));
  return bx;
}

describe("clampThickness", () => {
  it("clamps to the panel range and snaps to its step", () => {
    expect(clampThickness(0)).toBe(THICKNESS.min);
    expect(clampThickness(-5)).toBe(THICKNESS.min);
    expect(clampThickness(1e6)).toBe(THICKNESS.max);
    expect(clampThickness(1.234)).toBe(1.23);
    expect(clampThickness(1.236)).toBe(1.24);
    expect(clampThickness(NaN)).toBe(THICKNESS.min);
  });
});

describe("nudgeThickness", () => {
  it("always moves by at least one step, in the right direction", () => {
    for (const cm of [0.1, 0.4, 1.3, 20, 99.5]) {
      expect(nudgeThickness(cm, 1)).toBeGreaterThan(cm);
      if (cm > THICKNESS.min) expect(nudgeThickness(cm, -1)).toBeLessThan(cm);
    }
  });
  it("stays inside the limits", () => {
    expect(nudgeThickness(THICKNESS.max, 1)).toBe(THICKNESS.max);
    expect(nudgeThickness(THICKNESS.min, -1)).toBe(THICKNESS.min);
  });
  it("is multiplicative like the log slider (about 1 % of the decades)", () => {
    const up = nudgeThickness(10, 1);
    expect(up / 10).toBeGreaterThan(1.05);
    expect(up / 10).toBeLessThan(1.09);
  });
  it("shift moves further", () => {
    expect(nudgeThickness(10, 1, 5)).toBeGreaterThan(nudgeThickness(10, 1));
  });
});

describe("thicknessFromBoundaryDrag", () => {
  const cms = [2, 5, 3];
  const bx = layout(cms);
  const base = { cms, boundaries: bx, minWidth: 20 };

  it("is the identity for a zero drag", () => {
    for (let i = 0; i < 2; i++) expect(thicknessFromBoundaryDrag({ ...base, index: i, dx: 0 })).toBeCloseTo(cms[i], 1);
    expect(thicknessFromBoundaryDrag({ ...base, index: 2, dx: 0 })).toBe(3);
  });

  it("makes the dragged boundary follow the pointer", () => {
    const dx = 25;
    const next = cms.slice();
    next[1] = thicknessFromBoundaryDrag({ ...base, index: 1, dx });
    expect(layout(next)[2]).toBeCloseTo(bx[2] + dx, 0);
    expect(next[1]).toBeGreaterThan(cms[1]);
  });

  it("dragging left shrinks, and never goes below the minimum", () => {
    expect(thicknessFromBoundaryDrag({ ...base, index: 1, dx: -10 })).toBeLessThan(5);
    expect(thicknessFromBoundaryDrag({ ...base, index: 1, dx: -500 })).toBe(THICKNESS.min);
  });

  it("never exceeds the maximum, even dragged far right", () => {
    expect(thicknessFromBoundaryDrag({ ...base, index: 1, dx: 5000 })).toBe(THICKNESS.max);
    expect(thicknessFromBoundaryDrag({ ...base, index: 2, dx: 5000 })).toBe(THICKNESS.max);
  });

  it("snaps to the step", () => {
    const v = thicknessFromBoundaryDrag({ ...base, index: 0, dx: 7.3 });
    expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
  });

  it("back face is relative: right grows, left shrinks", () => {
    expect(thicknessFromBoundaryDrag({ ...base, index: 2, dx: 40 })).toBeGreaterThan(3);
    expect(thicknessFromBoundaryDrag({ ...base, index: 2, dx: -40 })).toBeLessThan(3);
  });

  it("ignores bad input", () => {
    expect(thicknessFromBoundaryDrag({ ...base, index: 9, dx: 10 })).toBe(THICKNESS.min);
    expect(thicknessFromBoundaryDrag({ ...base, index: 1, dx: 10, boundaries: [0, 1] })).toBe(5);
  });
});

describe("hitBoundary", () => {
  const bx = [100, 160, 240, 300];
  it("finds the nearest inner boundary / back face within the band", () => {
    expect(hitBoundary(162, bx, 6)).toBe(1);
    expect(hitBoundary(238, bx, 6)).toBe(2);
    expect(hitBoundary(303, bx, 6)).toBe(3);
  });
  it("does not offer the front face and misses the bodies", () => {
    expect(hitBoundary(100, bx, 6)).toBe(-1);
    expect(hitBoundary(200, bx, 6)).toBe(-1);
  });
  it("the coarse band is wider", () => {
    expect(hitBoundary(171, bx, 6)).toBe(-1);
    expect(hitBoundary(171, bx, 12)).toBe(1);
  });
  it("keeps a body on very thin layers", () => {
    const thin = [0, 12, 100];
    // boundary 1 sits at x = 12; reach is capped at 12 / 3 = 4 px
    expect(hitBoundary(6, thin, 12)).toBe(-1);
    expect(hitBoundary(7, thin, 12)).toBe(-1);
    expect(hitBoundary(9, thin, 12)).toBe(1);
    expect(hitBoundary(11, thin, 12)).toBe(1);
  });
});

describe("dropSlot / slotToIndex", () => {
  const bx = [100, 160, 240, 300];
  it("picks the nearest boundary", () => {
    expect(dropSlot(90, bx)).toBe(0);
    expect(dropSlot(150, bx)).toBe(1);
    expect(dropSlot(200, bx)).toBe(1);
    expect(dropSlot(201, bx)).toBe(2);
    expect(dropSlot(999, bx)).toBe(3);
  });
  it("maps slots to final indexes", () => {
    expect(slotToIndex(0, 3)).toBe(2);
    expect(slotToIndex(2, 0)).toBe(0);
    expect(slotToIndex(1, 1)).toBe(1);
    expect(slotToIndex(1, 2)).toBe(1);
  });
  it("detects no-op drops", () => {
    expect(isNoopDrop(1, 1)).toBe(true);
    expect(isNoopDrop(1, 2)).toBe(true);
    expect(isNoopDrop(1, 3)).toBe(false);
    expect(isNoopDrop(0, 0)).toBe(true);
  });
});

describe("moveInStack", () => {
  it("reorders and keeps the selection on the same layer", () => {
    const s = state(2); // c selected
    const r = moveInStack(s.layers, s.sel, 0, 3); // a to the end
    expect(r.layers.map((l) => l.id).join("")).toBe("bcda");
    expect(r.layers[r.sel].id).toBe("c");
  });
  it("selection follows when the moved layer is the selected one", () => {
    const s = state(1);
    const r = moveInStack(s.layers, s.sel, 1, 3);
    expect(ids(r)).toBe("acdb");
    expect(r.sel).toBe(3);
  });
  it("returns the same references when nothing changes", () => {
    const s = state(1);
    expect(moveInStack(s.layers, s.sel, 2, 2).layers).toBe(s.layers);
    expect(moveInStack(s.layers, s.sel, -1, 2).layers).toBe(s.layers);
    expect(moveInStack(s.layers, s.sel, 0, 9).layers).toBe(s.layers);
  });
  it("does not mutate its input and keeps layer objects", () => {
    const s = state(0);
    const before = s.layers.slice();
    const r = moveInStack(s.layers, 0, 0, 2);
    expect(s.layers).toEqual(before);
    expect(r.layers).toContain(before[0]);
  });
});

describe("applyMove", () => {
  it("reorders and keeps the selection on the layer it was on", () => {
    const s = state(3); // d selected
    const n = applyMove(s, 0, 2);
    expect(ids(n)).toBe("bcad");
    expect(n.layers[n.sel].id).toBe("d");
    expect(n.freq).toBe(5);
  });
  it("selection follows the dragged layer when it is the selected one", () => {
    const s = state(0);
    const n = applyMove(s, 0, 3);
    expect(ids(n)).toBe("bcda");
    expect(n.sel).toBe(3);
  });
  it("a no-op drop returns the same state", () => {
    const s = state(1);
    expect(applyMove(s, 1, 1)).toBe(s);
  });
  it("keeps the same set of layers (physics sees a permutation)", () => {
    const s = state(0);
    const n = applyMove(s, 3, 0);
    expect([...n.layers].sort((a, b) => a.id.localeCompare(b.id))).toEqual(s.layers);
  });
});

describe("applyResize", () => {
  it("clamps and snaps through the same range as the panel", () => {
    const s = state(0);
    expect(applyResize(s, 1, 1e9).layers[1].thickness).toBe(THICKNESS.max);
    expect(applyResize(s, 1, -1).layers[1].thickness).toBe(THICKNESS.min);
    expect(applyResize(s, 1, 2.346).layers[1].thickness).toBe(2.35);
  });
  it("only touches the targeted layer and keeps references when unchanged", () => {
    const s = state(0);
    const n = applyResize(s, 2, 5);
    expect(n.layers[0]).toBe(s.layers[0]);
    expect(n.layers[2]).not.toBe(s.layers[2]);
    expect(applyResize(s, 2, 1)).toBe(s);
    expect(applyResize(s, 9, 1)).toBe(s);
  });
});

describe("keyboard", () => {
  const key = (k: string, extra = {}) => ({ key: k, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
  it("maps Alt+arrows to commands", () => {
    expect(stackKeyCommand(key("ArrowLeft"), "BODY")).toEqual({ kind: "move", dir: -1, factor: 1 });
    expect(stackKeyCommand(key("ArrowRight"), "BODY")).toEqual({ kind: "move", dir: 1, factor: 1 });
    expect(stackKeyCommand(key("ArrowUp"), "BODY")).toEqual({ kind: "thickness", dir: 1, factor: 1 });
    expect(stackKeyCommand(key("ArrowDown", { shiftKey: true }), "BODY")).toEqual({ kind: "thickness", dir: -1, factor: 5 });
  });
  it("ignores plain arrows, other modifiers and text fields", () => {
    expect(stackKeyCommand(key("ArrowLeft", { altKey: false }), "BODY")).toBeNull();
    expect(stackKeyCommand(key("ArrowLeft", { ctrlKey: true }), "BODY")).toBeNull();
    expect(stackKeyCommand(key("ArrowLeft"), "INPUT")).toBeNull();
    expect(stackKeyCommand(key("a"), "BODY")).toBeNull();
    expect(stackKeyCommand(key("ArrowLeft"), "INPUT", "text")).toBeNull();
  });
  it("still works while a slider or button has focus", () => {
    expect(stackKeyCommand(key("ArrowUp"), "INPUT", "range")).toEqual({ kind: "thickness", dir: 1, factor: 1 });
    expect(stackKeyCommand(key("ArrowUp"), "BUTTON")).toEqual({ kind: "thickness", dir: 1, factor: 1 });
  });
  it("moves the selected layer and the selection follows; edges are no-ops", () => {
    const s = state(1);
    const right = applyStackCommand(s, { kind: "move", dir: 1, factor: 1 });
    expect(ids(right)).toBe("acbd");
    expect(right.sel).toBe(2);
    expect(applyStackCommand(state(0), { kind: "move", dir: -1, factor: 1 }).layers.map((l) => l.id).join("")).toBe("abcd");
    const last = state(3);
    expect(applyStackCommand(last, { kind: "move", dir: 1, factor: 1 })).toBe(last);
  });
  it("changes the selected layer thickness by one step", () => {
    const s = state(1);
    const up = applyStackCommand(s, { kind: "thickness", dir: 1, factor: 1 });
    expect(up.layers[1].thickness).toBeGreaterThan(1);
    expect(up.layers[0]).toBe(s.layers[0]);
  });
});

describe("nearestSlot (Spatial view)", () => {
  // projected boundaries 0..3 of a 3-layer stack
  const slots = [{ x: 100, y: 50 }, { x: 140, y: 40 }, { x: 180, y: 30 }, { x: 220, y: 20 }];
  it("projects the pointer on the stack axis", () => {
    expect(nearestSlot({ x: 60, y: 80 }, slots)).toBe(0);
    expect(nearestSlot({ x: 118, y: 0 }, slots)).toBe(1);
    expect(nearestSlot({ x: 162, y: 36 }, slots)).toBe(2);
    expect(nearestSlot({ x: 400, y: 0 }, slots)).toBe(3);
  });
  it("keeps stack order when the camera looks from the other side", () => {
    const rev = slots.slice().reverse(); // slot 0 now on the right of the screen
    expect(nearestSlot({ x: 400, y: 0 }, rev)).toBe(0);
    expect(nearestSlot({ x: 60, y: 0 }, rev)).toBe(3);
  });
  it("handles a degenerate (end-on) stack and no slots", () => {
    const flat = [{ x: 10, y: 10 }, { x: 10, y: 10 }];
    expect(() => nearestSlot({ x: 0, y: 0 }, flat)).not.toThrow();
    expect(nearestSlot({ x: 0, y: 0 }, [])).toBe(0);
  });
});
