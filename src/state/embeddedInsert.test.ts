import { afterEach, describe, expect, it, vi } from "vitest";
import { C0, DEG, computeStackSweep, solveStack, stackFieldAbs, stackMode } from "../physics";
import { applyMove, applyResize, applyStackCommand } from "../scene/dragStack";
import { movePhysical, physicalScene, resizePhysical, selectPhysical } from "../scene/physicalStack";
import { hitLayer } from "../scene/hitTest";
import { encodeShare } from "../share";
import { mainEmt, mainWallSpec } from "../surface/profiledMain";
import { DEFAULT_PROFILE } from "../surface/profiles";
import { rcwaInputFor, solveRcwaMode } from "../surface/rcwa";
import { wallAt } from "../surface/rcwaJobs";
import { drawWaveRays } from "../waveRays";
import { drawSpatialScene } from "../spatialScene";
import { PALETTES } from "../theme";
import { embeddedQuarterWave, expandLayers, insertMatchingLayer, insertReason, mkLayer, physicalLayerCount, type EmbeddedInsert, type Layer } from "./layers";
import { addMatching, matchingReference, transitionMatching } from "./matching";
import { defaultPersisted, persistedFromHash, sanitizePersisted } from "./persistence";
import { computeResults, type SimState } from "./results";

const host = (sigma = 0): Layer => ({ ...mkLayer("custom", 2, 9, sigma), id: "host", customMode: "nk" });
const base = (l = host()): SimState => ({ layers: [l], sel: 0, freq: 10, angle: 30, pol: "TE" });
const design: EmbeddedInsert = { enabled: true, eps: 2.25, thickness: 0.2 };
const withInsert = (s: SimState, insert = design, index = 0) => ({ ...s, layers: s.layers.map((l, i) => i === index ? { ...l, embeddedInsert: { ...insert } } : l) });
const off = (s: SimState, index = 0) => withInsert(s, { ...s.layers[index].embeddedInsert!, enabled: false }, index);

describe("embedded physical insert", () => {
  it.each([0, 0.08])("physically changes R/T and restores the exact host on off (sigma %s)", (sigma) => {
    const s = base(host(sigma));
    const before = computeResults(s);
    const enabled = transitionMatching(s, withInsert(s));
    expect(enabled.reason).toBeNull();
    const during = computeResults(enabled.sim);
    expect(Math.abs(during.R - before.R)).toBeGreaterThan(1e-4);
    expect(Math.abs(during.T - before.T)).toBeGreaterThan(1e-4);
    expect(during.A > 0.001).toBe(sigma > 0);
    const disabled = transitionMatching(enabled.sim, off(enabled.sim));
    const restored = computeResults(disabled.sim);
    expect(restored.R).toBe(before.R);
    expect(restored.T).toBe(before.T);
    expect(restored.A).toBe(before.A);
    expect(restored.etas).toEqual(before.etas);
    expect(restored.ds).toEqual(before.ds);
    const { embeddedInsert, ...restoredHost } = disabled.sim.layers[0];
    expect(restoredHost).toEqual(s.layers[0]);
    expect(embeddedInsert).toEqual({ ...design, enabled: false });
    expect(transitionMatching(disabled.sim, withInsert(disabled.sim)).sim.layers[0].embeddedInsert).toEqual(design);
  });

  it("preserves total thickness, loss law, IDs and positive thin host halves without mutating the source", () => {
    const s = withInsert(base({ ...mkLayer("concrete", 0.1), id: "concrete" }), { ...design, thickness: 0.09 });
    const snapshot = JSON.stringify(s);
    const expanded = expandLayers(s.layers);
    expect(expanded.map((l) => l.part)).toEqual(["front", "insert", "back"]);
    expect(expanded.map((l) => l.owner)).toEqual([0, 0, 0]);
    expect(expanded[0].thickness).toBeCloseTo(0.005, 14);
    expect(expanded.every((l) => l.thickness > 0)).toBe(true);
    expect(expanded.reduce((n, l) => n + l.thickness, 0)).toBeCloseTo(0.1, 14);
    expect(expanded[0]).toMatchObject({ mat: "concrete", eps: s.layers[0].eps, sigma: s.layers[0].sigma });
    expect(expanded[2]).toMatchObject({ mat: "concrete", thickness: expanded[0].thickness });
    expect(expanded[1]).toMatchObject({ mat: "custom", eps: design.eps, sigma: 0 });
    expect(expandLayers(s.layers)).toEqual(expanded);
    expect(JSON.stringify(s)).toBe(snapshot);
    const thin = withInsert(base(), { ...design, thickness: 0.01 });
    expect(insertReason(thin.layers)).toBeNull();
    expect(computeResults(thin).totalCm).toBe(2);
  });

  it("computes an unrounded fixed lambda/4 reference only when it fits", () => {
    const cm = embeddedQuarterWave(1.5, 10, 2)!;
    expect(cm).toBe(100 * C0 / (10e9 * 4 * 1.5));
    expect(embeddedQuarterWave(1.5, 10, cm)).toBeNull();
    expect(embeddedQuarterWave(1.5, 0.5, 0.1)).toBeNull();
    for (const [n, f] of [[0, 10], [0.9, 10], [9, 10], [NaN, 10], [1.5, 0], [1.5, Infinity]]) expect(embeddedQuarterWave(n, f, 2)).toBeNull();
    const s = withInsert(base(), { ...design, thickness: cm });
    const tuned = transitionMatching(s, { ...s, freq: 20, angle: 60, pol: "TM" });
    expect(tuned.reason).toBeNull();
    expect(tuned.sim.layers[0]).toBe(s.layers[0]);
    expect(tuned.sim.layers[0].embeddedInsert!.thickness).toBe(cm);
  });

  it("rejects invalid values and host shrink/material changes atomically with feedback", () => {
    const s = withInsert(base());
    for (const eps of [NaN, Infinity, 0, 0.5, 65]) {
      const r = transitionMatching(s, withInsert(s, { ...design, eps }));
      expect(r.sim).toBe(s);
      expect(r.reason).toBe("insertRange");
    }
    for (const thickness of [0, -1, NaN, Infinity]) expect(transitionMatching(s, withInsert(s, { ...design, thickness })).reason).toBe("insertRange");
    for (const thickness of [2, 3]) expect(transitionMatching(s, withInsert(s, { ...design, thickness })).reason).toBe("insertFit");
    const resized = transitionMatching(s, applyResize(s, 0, 0.1));
    expect(resized.sim).toBe(s);
    expect(resized.reason).toBe("insertFit");
    const changed = transitionMatching(s, { ...s, layers: [{ ...s.layers[0], mat: "air" }] });
    expect(changed.sim).toBe(s);
    expect(changed.reason).toBe("insertHost");
    const disabled = off(s);
    expect(transitionMatching(disabled, applyResize(disabled, 0, 0.1)).reason).toBeNull();
    const shrunk = applyResize(disabled, 0, 0.1);
    expect(transitionMatching(shrunk, withInsert(shrunk)).reason).toBe("insertFit");
    for (const l of [mkLayer("air", 2), { ...host(), matching: true }, { ...host(), matchingDesign: "quarter-wave-live" as const }]) expect(transitionMatching(base(l), withInsert(base(l))).reason).toBe("insertHost");
  });

  it("supports two hosts at six physical layers, counts toggles and coating/add/duplicate costs", () => {
    const s = base();
    const twoHosts = { ...s, layers: [s.layers[0], { ...host(0.04), id: "other" }] };
    const two = withInsert(withInsert(twoHosts), design, 1);
    expect(transitionMatching(twoHosts, two).reason).toBeNull();
    expect(physicalLayerCount(two.layers)).toBe(6);
    expect(expandLayers(two.layers).map((l) => l.owner)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(addMatching(two, 0).reason).toBe("arFull");
    expect(insertMatchingLayer(two.layers, 0, 10)).toBeNull();
    for (const added of [mkLayer("glass", 1), { ...two.layers[0], id: "copy" }]) {
      const r = transitionMatching(two, { ...two, layers: [...two.layers, added] });
      expect(r.sim).toBe(two);
      expect(r.reason).toBe("arFull");
    }
    const four = off(two);
    expect(physicalLayerCount(four.layers)).toBe(4);
    expect(physicalLayerCount(off(four, 1).layers)).toBe(2);
    const six = { ...off(four, 1), layers: [...off(four, 1).layers, ...Array.from({ length: 4 }, () => mkLayer("glass", 1))] };
    expect(transitionMatching(six, withInsert(six)).reason).toBe("arFull");
  });

  it("changes real dispersive concrete R/T and keeps a separate live boundary coating adaptive", () => {
    const s = base(mkLayer("concrete", 2));
    const enabled = withInsert(s);
    expect(Math.abs(computeResults(enabled).R - computeResults(s).R)).toBeGreaterThan(1e-4);
    expect(Math.abs(computeResults(enabled).T - computeResults(s).T)).toBeGreaterThan(1e-4);
    const fixed = addMatching(enabled, 0).sim;
    const coated: SimState = { ...fixed, layers: fixed.layers.map((l) => l.matching ? { ...l, matchingDesign: "quarter-wave-live" } : l) };
    expect(coated.layers).toHaveLength(2);
    expect(expandLayers(coated.layers)).toHaveLength(4);
    const changed = transitionMatching(coated, { ...coated, freq: 20 });
    expect(changed.reason).toBeNull();
    expect(changed.sim.layers[0].thickness).not.toBe(coated.layers[0].thickness);
    expect(changed.sim.layers[0].thickness).toBe(matchingReference(changed.sim.layers, 0, 20).design!.cm);
    expect(changed.sim.layers[1].embeddedInsert).toBe(coated.layers[1].embeddedInsert);
    expect(computeResults(off(enabled)).R).toBe(computeResults(s).R);
  });

  it("moves, deletes, resizes and changes host material without losing the retained design", () => {
    const s = { ...withInsert(base()), layers: [...withInsert(base()).layers, { ...mkLayer("brick", 3), id: "brick" }] };
    const moved = transitionMatching(s, applyMove(s, 0, 1)).sim;
    expect(moved.sel).toBe(1);
    expect(moved.layers[1]).toBe(s.layers[0]);
    expect(expandLayers(moved.layers).map((l) => l.owner)).toEqual([0, 1, 1, 1]);
    const resized = transitionMatching(moved, applyStackCommand(moved, { kind: "thickness", dir: 1, factor: 1 }));
    expect(resized.reason).toBeNull();
    expect(resized.sim.layers[1].embeddedInsert).toBe(s.layers[0].embeddedInsert);
    const changed = transitionMatching(moved, { ...moved, layers: [moved.layers[0], { ...moved.layers[1], mat: "glass" }] });
    expect(changed.reason).toBeNull();
    expect(expandLayers(changed.sim.layers).map((l) => l.mat)).toEqual(["brick", "glass", "custom", "glass"]);
    const deleted = transitionMatching(moved, { ...moved, layers: [moved.layers[0]], sel: 0 }).sim;
    expect(expandLayers(deleted.layers)).toHaveLength(1);
  });

  it.each([true, false])("round-trips share and persisted design including enabled=%s", (enabled) => {
    const s = withInsert(base(host(0.08)), { ...design, enabled, thickness: embeddedQuarterWave(1.5, 10, 2)! });
    const shared = persistedFromHash(`#s=${encodeShare(s, "fr", "light")}`)!;
    expect(shared.sim).toEqual(s);
    expect(shared.lang).toBe("fr");
    const saved = sanitizePersisted(JSON.parse(JSON.stringify({ sim: s })), defaultPersisted());
    expect(saved.sim).toEqual(s);
  });

  it("safely sanitizes malformed imports, disables non-fitting/ineligible/excess designs and reads legacy links", () => {
    for (const v of [true, "bad", [], {}, { ...design, enabled: "true" }, { ...design, eps: null }, { ...design, thickness: -1 }]) {
      const s = withInsert(base(), v as EmbeddedInsert);
      const got = sanitizePersisted({ sim: s }, defaultPersisted()).sim;
      expect(got.layers[0].embeddedInsert).toBeUndefined();
      expect(computeResults(got).R).toBe(computeResults(base(s.layers[0])).R);
    }
    for (const s of [withInsert(base(), { ...design, thickness: 2 }), withInsert(base(mkLayer("air", 2))), withInsert(base({ ...host(), matching: true }))]) {
      const got = sanitizePersisted({ sim: s }, defaultPersisted()).sim;
      expect(got.layers[0].embeddedInsert).toEqual({ ...s.layers[0].embeddedInsert, enabled: false });
      expect(got.layers[0].thickness).toBe(s.layers[0].thickness);
      expect(got.layers[0].sigma).toBe(s.layers[0].sigma);
    }
    const s = withInsert(base());
    const excess = { ...s, layers: Array.from({ length: 3 }, (_, i) => ({ ...s.layers[0], id: `host${i}` })) };
    const got = sanitizePersisted({ sim: excess }, defaultPersisted()).sim;
    expect(got.layers.map((l) => l.embeddedInsert!.enabled)).toEqual([true, false, false]);
    expect(physicalLayerCount(got.layers)).toBe(5);
    const legacy = base();
    expect(persistedFromHash(`#s=${encodeShare(legacy, "en", "dark")}`)!.sim).toEqual(legacy);
  });

  it.each(["TE", "TM", "AVG"] as const)("shares one physical stack across results, fields, angle sweep, EMT and RCWA (%s)", (pol) => {
    const s = { ...withInsert(base(host(0.04))), pol };
    const r = computeResults(s);
    const manual = { ...s, layers: [ { ...s.layers[0], thickness: 0.9, embeddedInsert: undefined }, { ...mkLayer("custom", 0.2, 2.25, 0), id: "insert" }, { ...s.layers[0], thickness: 0.9, embeddedInsert: undefined } ] };
    const expected = computeResults(manual);
    expect(r.R).toBe(expected.R);
    expect(r.T).toBe(expected.T);
    expect(r.A).toBe(expected.A);
    expect(r.ds).toEqual(expected.ds);
    expect(r.etas).toEqual(expected.etas);
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0].absorbed).toBeCloseTo(r.A, 12);
    const f = stackFieldAbs(r.etas, r.ds, s.freq, s.angle * DEG, pol);
    const manualField = stackFieldAbs(expected.etas, expected.ds, s.freq, s.angle * DEG, pol);
    for (const z of [-0.01, 0, 0.008, 0.0095, 0.0115, 0.02, 0.03]) expect(f(z)).toBe(manualField(z));
    const sweep = computeStackSweep(r.etas, r.ds, s.freq);
    const at = sweep.ang.indexOf(s.angle);
    const R = pol === "TE" ? sweep.Rte[at] : pol === "TM" ? sweep.Rtm[at] : (sweep.Rte[at] + sweep.Rtm[at]) / 2;
    const T = pol === "TE" ? sweep.Tte[at] : pol === "TM" ? sweep.Ttm[at] : (sweep.Tte[at] + sweep.Ttm[at]) / 2;
    expect(R).toBe(r.R);
    expect(T).toBe(r.T);
    const spec = mainWallSpec({ ...DEFAULT_PROFILE, id: "square", depth: 0 }, s.layers);
    expect(spec.material).toBe("custom");
    expect(spec.customEps).toBe(9);
    expect(spec.customSigma).toBe(0.04);
    expect(spec.below.map((l) => l.cm)).toEqual([0.9, 0.2, 0.9]);
    const emt = mainEmt(spec, s.freq, s.angle, pol);
    const rcwa = solveRcwaMode(rcwaInputFor(wallAt(spec, s.freq), s.freq, s.angle, pol, 2, 8));
    for (const got of [emt, rcwa]) {
      expect(got.R).toBeCloseTo(r.R, 10);
      expect(got.T).toBeCloseTo(r.T, 10);
    }
    const realProfile = { ...DEFAULT_PROFILE, id: "triangle" as const, depth: 0.2 };
    const physicalSpec = mainWallSpec(realProfile, manual.layers);
    const profiledSpec = mainWallSpec(realProfile, s.layers);
    expect(profiledSpec).toEqual(physicalSpec); // one front profile, never stamped on the insert/back half
    expect(mainEmt(profiledSpec, s.freq, s.angle, pol)).toEqual(mainEmt(physicalSpec, s.freq, s.angle, pol));
  });

  it("maps drawing selections to their owners and refuses virtual resizing/reordering", () => {
    const s = { ...withInsert(base()), sel: 1, layers: [...withInsert(base()).layers, { ...mkLayer("glass", 1), id: "glass" }] };
    for (const index of [0, 1, 2]) {
      expect(selectPhysical(s, index).sel).toBe(0);
      expect(resizePhysical(s, index, 0.5)).toBe(s);
    }
    expect(selectPhysical(s, 3)).toBe(s);
    expect(selectPhysical(s, -1)).toBe(s);
    expect(selectPhysical(s, 4)).toBe(s);
    expect(resizePhysical(s, 3, 2).layers[1].thickness).toBe(2);
    expect(resizePhysical(s, 4, 2)).toBe(s);
    expect(movePhysical(s, 0, 3)).toBe(s);
    const disabled = off(s);
    expect(movePhysical(disabled, 0, 1).layers[1]).toBe(disabled.layers[0]);
    expect(resizePhysical(disabled, 0, 3).layers[0].thickness).toBe(3);
    const scene = physicalScene(computeResults(s), s.sel, (mat) => mat, "Insert", "AR");
    expect(scene.sel).toBe(3);
    expect(scene.layers.map((l) => l.readOnlyThickness)).toEqual([true, true, true, false]);
    expect(scene.layers.every((l) => l.readOnlyMove)).toBe(true);
    expect(scene.layers[1].name).toBe("Insert");
    expect(scene.layers[0].name).toContain("1/2");
    expect(scene.layers[2].name).toContain("2/2");
    expect(scene.layers.map((l) => l.cm)).toEqual([0.9, 0.2, 0.9, 1]);
  });
});

/** Execute both real renderers (not source assertions) with a recording canvas. */
function canvas() {
  const texts: string[] = [];
  const method = vi.fn();
  const ctx = new Proxy({}, { get: (_target, key) => {
    if (key === "measureText") return (text: string) => ({ width: text.length * 5 });
    if (key === "fillText") return (text: string) => texts.push(text);
    if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
    return method;
  }, set: () => true }) as CanvasRenderingContext2D;
  return { ctx, texts };
}

afterEach(() => vi.unstubAllGlobals());

it("draws a selectable visible thin insert in Section and Spatial using true solver thicknesses", () => {
  const s = withInsert(base(), { ...design, thickness: 0.01 });
  const r = computeResults(s);
  const params = { ...physicalScene(r, 0, (mat) => mat, "Insert", "AR"), etas: r.etas, ds: r.ds, R: r.R, T: r.T, theta: s.angle, freq: s.freq, pol: s.pol, hover: -1, labels: { normal: "normal", tx: "Tx", rx: "Rx", refl: "R" } };
  const section = canvas();
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => canvas().ctx }) });
  const layout = drawWaveRays(section.ctx, 800, 500, 0, params, PALETTES.dark, String, { display: "both", annotations: true, reflections: true, lang: "en" });
  expect(layout.rects).toHaveLength(3);
  expect(layout.rects[1].x1 - layout.rects[1].x0).toBeGreaterThanOrEqual(20);
  expect(section.texts.some((text) => text.includes("Insert"))).toBe(true);
  const rect = layout.rects[1];
  const h = hitLayer(layout, { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 });
  expect(h.index).toBe(1);
  expect(selectPhysical(s, h.index).sel).toBe(0);
  const spatial = canvas();
  const volume = drawSpatialScene(spatial.ctx, 800, 500, 0, 1, { ...params, sel: 1 }, PALETTES.dark, String, { display: "both", annotations: true, az: 0.45, el: 0.45, lang: "en" });
  expect(volume.polygons).toHaveLength(3);
  expect(spatial.texts.some((text) => text.includes("INSERT"))).toBe(true);
  expect(params.ds[1]).toBe(0.0001);
  expect(params.layers[1].cm).toBe(0.01);
  // Section's internal field uses exactly this expanded stack.
  const stack = solveStack(params.etas, params.ds, s.freq, s.angle * DEG, "TE");
  expect(stack.R).toBeCloseTo(stackMode(r.etas, r.ds, s.freq, s.angle * DEG, "TE").R, 12);
});
