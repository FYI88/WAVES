import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { App } from "./App";
import { Check, Slider } from "./ui/controls";
import { RayScene, type SceneParams } from "./scene/RayScene";
import { FieldChart } from "./charts/FieldChart";
import { AngleChart } from "./charts/AngleChart";
import { DICTS, type Lang } from "./i18n";
import { mkLayer } from "./state/layers";
import { computeResults, type SimState } from "./state/results";
import { addMatching } from "./state/matching";
import { epsSigmaOfNK, quarterWaveMatch } from "./state/layers";
import { loadRtView } from "./surface/useProfiledMain";
import { SurfaceLab } from "./surface/SurfaceLab";
import { NO_INCLUSIONS } from "./media/mixing";
import { computeStackSweep, C0, DEG, stackFieldAbs } from "./physics";
import { DEFAULT_PROFILE } from "./surface/profiles";
import { mainEmt, mainWallSpec } from "./surface/profiledMain";

const harness = vi.hoisted(() => ({ states: [] as unknown[], index: 0, sim: {} as SimState, lang: "en" as Lang,
  csv: [] as Array<{ text?: string; filename: string }>, blob: null as Blob | null, effects: [] as Array<() => unknown> }));
// Invoke the real App and its actual callbacks without a DOM dependency. Only
// lifecycle hooks are replaced; no editor/solver/scene-mapping logic is mocked.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useLayoutEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
    return [harness.states[index], (action: unknown) => {
      harness.states[index] = typeof action === "function" ? action(harness.states[index]) : action;
    }];
  },
}));
vi.mock("./state/persistence", async (original) => ({
  ...await original<typeof import("./state/persistence")>(),
  loadInitial: () => ({ sim: harness.sim, lang: harness.lang, theme: "dark" }),
}));
vi.mock("./dom", async (original) => ({
  ...await original<typeof import("./dom")>(),
  downloadText: (text: string, filename: string) => harness.csv.push({ text, filename }),
  downloadFile: (_href: string, filename: string) => harness.csv.push({ filename }),
}));

type Node = ReactElement<Record<string, any>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children)];
}
function render() {
  harness.index = 0;
  return nodes(App());
}
const current = () => (harness.states[0] as { sim: SimState; reason: string | null });
const get = (tree: Node[], type: unknown, label?: string): Node => tree.find((n) => n.type === type && (label === undefined || n.props.label === label))!;
const button = (tree: Node[], label: string) => tree.find((n) => n.type === "button" && n.props.children === label)!;

beforeEach(() => {
  harness.states = [];
  harness.index = 0;
  harness.csv = [];
  harness.blob = null;
  harness.effects = [];
  harness.sim = { layers: [{ ...mkLayer("custom", 2, 9, 0.03), id: "host" }], sel: 0, freq: 10, angle: 30, pol: "TE" };
  vi.stubGlobal("navigator", { userAgent: "Chrome/140", language: "en" });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), setTimeout: vi.fn() });
  vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { harness.blob = blob; return "blob:waves-test"; }, revokeObjectURL: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it.each([10, 11])("blocks simulation shortcuts while overlay state slot %s is open, but keeps Escape", (slot) => {
  render();
  harness.states[slot] = true;
  harness.effects = [];
  render();
  let onKey: (event: any) => void = () => {};
  vi.stubGlobal("window", { addEventListener: (_type: string, fn: typeof onKey) => { onKey = fn; }, removeEventListener: vi.fn() });
  const effect = harness.effects.find((fn) => fn.toString().includes('"keydown"'))!;
  expect(effect).toBeDefined();
  effect();
  const original = [...harness.states];
  for (const key of [" ", "ArrowLeft", "ArrowUp", "l", "t", "p", "v", "1", "?"]) {
    const event = { key, code: key === " " ? "Space" : key, target: { tagName: "SUMMARY" }, preventDefault: vi.fn() };
    onKey(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(harness.states).toEqual(original);
  }
  onKey({ key: "ArrowRight", altKey: true, target: { tagName: "A" }, preventDefault: vi.fn() });
  expect(harness.states).toEqual(original);
  onKey({ key: "Escape" });
  expect(harness.states[slot]).toBe(false);
});

it("retains all equations and the five-tap build diagnostic toggle inside About", () => {
  render(); harness.states[11] = true;
  const tree = render();
  const equations = tree.filter((node) => typeof node.props.tex === "string");
  expect(equations.map((node) => node.props.tex)).toEqual([
    String.raw`\varepsilon_r = \varepsilon' - j\,\frac{17.98\,\sigma}{f}`,
    String.raw`\eta = \frac{\eta_0}{\sqrt{\varepsilon_r}}`,
    String.raw`n_1 \sin\theta_1 = n_2 \sin\theta_2`,
    String.raw`r = \frac{\eta_2 \cos\theta_1 - \eta_1 \cos\theta_2}{\eta_2 \cos\theta_1 + \eta_1 \cos\theta_2}`,
  ]);
  const build = tree.find((node) => node.props.className === "om-about-build")!;
  for (let i = 0; i < 4; i++) build.props.onClick();
  expect(harness.states[15]).toBe(false);
  build.props.onClick();
  expect(harness.states[15]).toBe(true);
  tree.find((node) => node.props.className === "om-about-close")!.props.onClick();
  expect(harness.states[11]).toBe(false);
});

it("requests the second row only for the incidence Brewster tick", () => {
  const tree = render();
  const angle = get(tree, Slider, DICTS.en.angle);
  const ticks = angle.props.ticks as Array<{ label: string; row?: number; v: number }>;
  expect(ticks.find((tick) => tick.label === "θB")).toMatchObject({ row: 2 });
  expect(ticks.filter((tick) => tick.label !== "θB").every((tick) => tick.row === undefined)).toBe(true);
  const frequency = get(tree, Slider, DICTS.en.frequency);
  expect(frequency.props.ticks.every((tick: { row?: number }) => tick.row === undefined)).toBe(true);
});

it.each(["en", "fr"] as const)("wires the physical toggle/editor to the same scene, field and angle outputs (%s)", (lang) => {
  harness.lang = lang;
  const t = DICTS[lang];
  let tree = render();
  const original = computeResults(current().sim);
  expect(get(tree, Check, t.insertTitle).props.checked).toBe(false);
  get(tree, Check, t.insertTitle).props.onChange(true);
  tree = render();
  expect(get(tree, Check, t.insertTitle).props.checked).toBe(true);
  get(tree, Slider, t.insertIndex).props.onChange(1.5);
  get(tree, Slider, t.insertThickness).props.onChange(0.01);
  tree = render();
  const s = current().sim;
  expect(s.layers[0].embeddedInsert).toEqual({ enabled: true, eps: 2.25, thickness: 0.01 });
  const r = computeResults(s);
  expect(r.R).not.toBe(original.R);
  const scene = get(tree, RayScene).props.params as SceneParams;
  expect(scene.ds).toEqual(r.ds);
  expect(scene.etas).toEqual(r.etas);
  expect(scene.R).toBe(r.R);
  expect(scene.T).toBe(r.T);
  expect(scene.layers.map((l) => l.cm)).toEqual(r.physicalLayers.map((l) => l.thickness));
  const field = get(tree, FieldChart).props;
  expect(field.ds).toEqual(scene.ds);
  expect(field.etas).toEqual(scene.etas);
  expect(field.bands).toHaveLength(3);
  expect(field.bands[1].label).toBe(t.insertMaterial.toUpperCase());
  const sweep = get(tree, AngleChart).props.sweep;
  expect(sweep.Rte[sweep.ang.indexOf(s.angle)]).toBe(r.R);
  get(tree, Check, t.insertTitle).props.onChange(false);
  tree = render();
  expect(get(tree, RayScene).props.params.R).toBe(original.R);
  expect(get(tree, RayScene).props.params.T).toBe(original.T);
  expect(current().sim.layers[0]).toEqual({ ...harness.sim.layers[0], embeddedInsert: { enabled: false, eps: 2.25, thickness: 0.01 } });
});

it("routes the actual lab callback into the main result, both canvas inputs, angle and field charts, and back to off", () => {
  harness.lang = "en";
  let tree = render();
  const original = get(tree, RayScene).props.params;
  const inc = { ...NO_INCLUSIONS, kind: "water" as const, fraction: 0.1 };
  get(tree, SurfaceLab).props.onMainInclusions(inc);
  tree = render();
  const result = computeResults(current().sim, inc);
  const scene = get(tree, RayScene).props.params;
  expect(scene.etas).toEqual(result.etas);
  expect(scene.ds).toEqual(result.ds);
  expect(scene.R).toBe(result.R);
  expect(scene.R).not.toBe(original.R);
  expect(get(tree, FieldChart).props.etas).toBe(scene.etas);
  expect(get(tree, FieldChart).props.ds).toBe(scene.ds);
  expect(get(tree, AngleChart).props.sweep).toEqual(computeStackSweep(scene.etas, scene.ds, current().sim.freq));
  expect(tree.some((n) => n.props.className?.startsWith("om-inclusion-note") && n.props.role === "status")).toBe(true);
  const profile = { ...DEFAULT_PROFILE, id: "triangle" as const, period: 0.2, depth: 1 };
  get(tree, SurfaceLab).props.onSceneSurface({ profile, calc: { mode: "fast", harmonics: 2, slices: 8 } });
  tree = render();
  const s = current().sim;
  const profiled = mainEmt(mainWallSpec(profile, s.layers, inc), s.freq, s.angle, s.pol, 8);
  expect(get(tree, RayScene).props.params.R).toBe(profiled.R);
  expect(get(tree, RayScene).props.params.etas).toEqual(result.etas);
  get(tree, SurfaceLab).props.onSceneSurface(null);
  get(tree, SurfaceLab).props.onMainInclusions(null);
  tree = render();
  expect(get(tree, RayScene).props.params).toEqual(original);
  expect(tree.some((n) => n.props.className === "om-inclusion-note")).toBe(false);
});

it("exports the same mixed angle sweep and field samples through the existing native/web CSV paths", async () => {
  harness.lang = "en";
  let tree = render();
  const inc = { ...NO_INCLUSIONS, kind: "water" as const, fraction: 0.1 };
  get(tree, SurfaceLab).props.onMainInclusions(inc);
  tree = render();
  const s = current().sim;
  const result = computeResults(s, inc);
  const exports = tree.filter((n) => n.type === "button" && n.props.title === DICTS.en.exportCsvTitle);
  const text = async () => harness.csv.at(-1)!.text ?? await harness.blob!.text();
  exports[0].props.onClick();
  const sweepRows = (await text()).split("\n");
  expect(sweepRows[0]).toBe("angle_deg,R_TE,T_TE,R_TM,T_TM,R_AVG,T_AVG");
  const row = sweepRows.slice(1).map((r) => r.split(",").map(Number)).find((r) => r[0] === s.angle)!;
  expect(row[1]).toBeCloseTo(result.R, 6);
  expect(row[2]).toBeCloseTo(result.T, 6);
  expect(harness.csv.at(-1)!.filename).toContain("waves-sweep-");
  exports[1].props.onClick();
  const fieldRows = (await text()).split("\n");
  expect(fieldRows[0]).toBe("z_cm,E_lin,E_dB");
  expect(fieldRows).toHaveLength(1002);
  const d = result.ds.reduce((a, b) => a + b, 0);
  const air = Math.max(0.5 * d, Math.min(1.5 * C0 / (s.freq * 1e9), 3 * d + 0.02));
  const field = stackFieldAbs(result.etas, result.ds, s.freq, s.angle * DEG, s.pol);
  for (const i of [0, 350, 500, 650, 1000]) {
    const z = -air + (d + 2 * air) * i / 1000;
    const values = fieldRows[i + 1].split(",").map(Number);
    expect(values[0]).toBeCloseTo(z * 100, 4);
    expect(values[1]).toBeCloseTo(field(z), 6);
  }
  expect(harness.csv.at(-1)!.filename).toContain("waves-field-");
});

it("applies lambda/4 once, keeps the design when frequency changes and shows a disabled fit reason", () => {
  harness.lang = "en";
  let tree = render();
  get(tree, Check, DICTS.en.insertTitle).props.onChange(true);
  tree = render();
  const button = tree.find((n) => n.type === "button" && Array.isArray(n.props.children) && n.props.children[0] === DICTS.en.insertQuarterAction)!;
  expect(button.props.disabled).toBe(false);
  button.props.onClick();
  tree = render();
  const cm = current().sim.layers[0].embeddedInsert!.thickness;
  get(tree, Slider, DICTS.en.frequency).props.onChange(20);
  tree = render();
  expect(current().sim.layers[0].embeddedInsert!.thickness).toBe(cm);
  get(tree, Slider, DICTS.en.frequency).props.onChange(0.5);
  tree = render();
  const disabled = tree.find((n) => n.type === "button" && Array.isArray(n.props.children) && n.props.children[0] === DICTS.en.insertQuarterAction)!;
  expect(disabled.props.disabled).toBe(true);
  expect(tree.some((n) => n.props.children === DICTS.en.insertQuarterFit)).toBe(true);
});

it.each(["en", "fr"] as const)("creates an internal quarter-wave insert without replacing the current walls or wave settings (%s)", (lang) => {
  harness.lang = lang;
  const t = DICTS[lang];
  harness.sim = { layers: [mkLayer("brick", 4), mkLayer("marble", 1), mkLayer("glass", 0.4)],
    sel: 1, freq: 5.5, angle: 25, pol: "TM" };
  const original = harness.sim;
  const before = computeResults(original);
  let tree = render();
  expect(Object.keys(t.presetNames)).not.toContain("internalQuarterWave");
  expect(get(tree, Check, t.insertTitle).props.checked).toBe(false);
  const action = button(tree, t.insertQuarterCreate);
  expect(action.props.disabled).toBe(false);
  action.props.onClick();
  tree = render();
  const s = current().sim;
  expect(s.layers).toHaveLength(3);
  expect(s.layers[0]).toBe(original.layers[0]);
  expect(s.layers[2]).toBe(original.layers[2]);
  const { embeddedInsert, ...host } = s.layers[1];
  expect(host).toEqual(original.layers[1]);
  expect(embeddedInsert).toMatchObject({ enabled: true, eps: 2.25 });
  expect(embeddedInsert!.thickness).toBe(100 * C0 / (4 * 5.5e9 * 1.5));
  expect(s).toMatchObject({ sel: 1, freq: 5.5, angle: 25, pol: "TM" });
  expect(get(tree, Check, t.insertTitle).props.checked).toBe(true);
  const after = get(tree, RayScene).props.params;
  expect(after.layers.map((l: { mat: string }) => l.mat)).toEqual(["brick", "marble", "custom", "marble", "glass"]);
  expect(after.ds.reduce((sum: number, d: number) => sum + d, 0)).toBeCloseTo(before.totalCm / 100, 14);
  get(tree, Check, t.insertTitle).props.onChange(false);
  tree = render();
  expect(get(tree, RayScene).props.params.R).toBe(before.R);
  expect(get(tree, RayScene).props.params.T).toBe(before.T);
});

it("keeps the quarter-wave insertion action disabled with a fit reason for a thin wall", () => {
  harness.lang = "en";
  harness.sim = { ...harness.sim, layers: [mkLayer("marble", 0.1)], freq: 5.5 };
  const tree = render();
  expect(button(tree, DICTS.en.insertQuarterCreate).props.disabled).toBe(true);
  expect(tree.some((n) => n.props.children === DICTS.en.insertQuarterFit)).toBe(true);
});

it("rejects an invalid host shrink with visible feedback, and keeps disabled retained designs editable to recover", () => {
  harness.lang = "en";
  let tree = render();
  get(tree, Check, DICTS.en.insertTitle).props.onChange(true);
  tree = render();
  get(tree, Slider, DICTS.en.insertThickness).props.onChange(0.4);
  tree = render();
  get(tree, Slider, DICTS.en.thickness).props.onChange(0.1);
  tree = render();
  expect(current().sim.layers[0].thickness).toBe(2);
  expect(current().reason).toBe("insertFit");
  expect(tree.some((n) => n.props.role === "status" && n.props.children === DICTS.en.insertFit)).toBe(true);
  get(tree, Check, DICTS.en.insertTitle).props.onChange(false);
  tree = render();
  get(tree, Slider, DICTS.en.thickness).props.onChange(0.1);
  tree = render();
  expect(get(tree, Slider, DICTS.en.insertThickness)).toBeDefined();
  get(tree, Slider, DICTS.en.insertThickness).props.onChange(0.01);
  tree = render();
  get(tree, Check, DICTS.en.insertTitle).props.onChange(true);
  expect(current().reason).toBeNull();
  expect(current().sim.layers[0].embeddedInsert).toEqual({ enabled: true, eps: 2.25, thickness: 0.01 });
});

it("disables insert activation without physical capacity and on fixed matching/air hosts", () => {
  harness.lang = "en";
  for (const layers of [Array.from({ length: 5 }, () => mkLayer("glass", 1)), [{ ...mkLayer("custom", 2), matching: true }], [mkLayer("air", 1)]]) {
    harness.states = [];
    harness.sim = { ...harness.sim, layers };
    const tree = render();
    expect(get(tree, Check, DICTS.en.insertTitle).props.disabled).toBe(true);
    expect(tree.some((n) => n.props.children === (layers.length === 5 ? DICTS.en.insertCapacity : DICTS.en.insertHost))).toBe(true);
  }
});

it("preserves live-coating duplication restrictions and prevents an enabled-host duplicate from overflowing capacity", () => {
  harness.lang = "en";
  harness.sim = addMatching(harness.sim, 0).sim;
  harness.sim.layers[0] = { ...harness.sim.layers[0], matchingDesign: "quarter-wave-live" };
  let tree = render();
  const liveDup = tree.find((n) => n.type === "button" && n.props["aria-label"] === DICTS.en.duplicate)!;
  expect(liveDup.props.disabled).toBe(true);
  liveDup.props.onClick();
  expect(current().sim.layers).toHaveLength(2);
  harness.states = [];
  harness.sim = { ...harness.sim, sel: 0, layers: [{ ...mkLayer("glass", 2), id: "insert-host", embeddedInsert: { enabled: true, eps: 2.25, thickness: 0.01 } }, mkLayer("glass", 1)] };
  tree = render();
  const hostDup = tree.find((n) => n.type === "button" && n.props["aria-label"] === DICTS.en.duplicate)!;
  expect(hostDup.props.disabled).toBe(true);
  hostDup.props.onClick();
  expect(current().sim.layers).toHaveLength(2);
});

it("duplicates the complete insert group and edits only the selected copy", () => {
  harness.lang = "en";
  harness.sim = { ...harness.sim, layers: [{ ...harness.sim.layers[0], embeddedInsert: { enabled: true, eps: 2.25, thickness: 0.01 } }] };
  let tree = render();
  const duplicate = tree.find((n) => n.type === "button" && n.props["aria-label"] === DICTS.en.duplicate)!;
  expect(duplicate.props.disabled).toBe(false);
  duplicate.props.onClick();
  tree = render();
  expect(current().sim.sel).toBe(1);
  expect(current().sim.layers[1].id).not.toBe(current().sim.layers[0].id);
  expect(get(tree, RayScene).props.params.layers).toHaveLength(6);
  get(tree, Slider, DICTS.en.insertIndex).props.onChange(2);
  tree = render();
  expect(current().sim.layers[0].embeddedInsert!.eps).toBe(2.25);
  expect(current().sim.layers[1].embeddedInsert!.eps).toBe(4);
  get(tree, Check, DICTS.en.insertTitle).props.onChange(false);
  tree = render();
  expect(get(tree, RayScene).props.params.layers).toHaveLength(4);
  const remove = tree.filter((n) => n.type === "button" && n.props["aria-label"] === DICTS.en.remove)[0];
  remove.props.onClick();
  tree = render();
  expect(current().sim.layers).toHaveLength(1);
  expect(get(tree, RayScene).props.params.layers).toHaveLength(1);
});

it.each(["en", "fr"] as const)("matches the wall with editable coatings and explicit recalculation in the actual editor (%s)", (lang) => {
  harness.lang = lang;
  harness.sim = { ...harness.sim, angle: 0, layers: [mkLayer("custom", 2, 9, 0)] };
  const t = DICTS[lang];
  let tree = render();
  // This environment defaults to the profiled preference; the action must select flat R/T.
  expect(loadRtView()).toBe("profiled");
  button(tree, t.arMatchWall).props.onClick();
  tree = render();
  expect(current().reason).toBeNull();
  expect(current().sim.layers).toHaveLength(3);
  expect(current().sim.sel).toBe(0);
  expect(harness.states).toContain("flat");
  expect(get(tree, RayScene).props.params.T).toBeGreaterThan(1 - 1e-6);
  expect(get(tree, Slider, t.epsCustom)).toBeDefined();
  expect(get(tree, Slider, t.sigmaCustom)).toBeDefined();
  expect(get(tree, Slider, t.thickness)).toBeDefined();
  get(tree, Slider, t.epsCustom).props.onChange(5);
  get(tree, Slider, t.sigmaCustom).props.onChange(0.1);
  get(tree, Slider, t.thickness).props.onChange(1.1);
  tree = render();
  expect(current().sim.layers[0]).toMatchObject({ eps: 5, sigma: 0.1, thickness: 1.1, matching: true });
  const mode = tree.find((n) => n.props.ariaLabel === t.epsCustom && n.props.options)!;
  mode.props.onChange("nk");
  tree = render();
  get(tree, Slider, "κ").props.onChange(0.02);
  tree = render();
  const k = current().sim.layers[0];
  get(tree, Slider, "n").props.onChange(2);
  tree = render();
  expect(current().sim.layers[0].eps).toBeCloseTo(epsSigmaOfNK(2, 0.02, 10).eps, 3);
  expect(current().sim.layers[0].sigma).not.toBe(k.sigma);
  // Fixed coat values do not silently follow material or frequency edits.
  const before = current().sim.layers[0];
  const selectHost = tree.find((n) => n.props.className === "om-layer-main" && n.props["aria-pressed"] === false)!;
  selectHost.props.onClick();
  tree = render();
  get(tree, Slider, t.epsCustom).props.onChange(16);
  tree = render();
  get(tree, Slider, t.frequency).props.onChange(20);
  tree = render();
  expect(current().sim.layers[0]).toBe(before);
  tree.find((n) => n.props.className === "om-layer-main")!.props.onClick();
  tree = render();
  const details = tree.find((n) => n.type === "details" && nodes(n.props.children).some((p) => p.type === "p" && Array.isArray(p.props.children) && p.props.children[0] === "nₘ = "))!;
  expect(details.props.open).toBeUndefined();
  button(tree, t.arRecalculate).props.onClick();
  tree = render();
  expect(current().sim.layers[0]).toMatchObject({ eps: 4, sigma: 0, thickness: quarterWaveMatch(1, 4, 20)!.cm, matching: true, customMode: "nk" });
  expect(current().sim.layers[0].matchingDesign).toBeUndefined();
  button(tree, t.arMatchWall).props.onClick();
  tree = render();
  expect(current().sim.layers).toHaveLength(3);
  expect(tree.some((n) => n.props.role === "status" && n.props.children === t.arCoated)).toBe(true);
});

it.each(["en", "fr"] as const)("calculates a fixed coating at the selected internal boundary and reports recalculation errors (%s)", (lang) => {
  harness.lang = lang;
  const t = DICTS[lang];
  harness.sim = { ...harness.sim, layers: [mkLayer("custom", 2, 4, 0), mkLayer("custom", 3, 9, 0)] };
  let tree = render();
  tree.find((n) => n.type === "select" && n.props["aria-label"] === t.arPosition)!.props.onChange({ target: { value: "1" } });
  tree = render();
  button(tree, t.arAdd).props.onClick();
  tree = render();
  expect(current().sim.sel).toBe(1);
  expect(current().sim.layers[1]).toMatchObject({ matching: true, eps: 6, sigma: 0 });
  expect(current().sim.layers[1].matchingDesign).toBeUndefined();
  const firstLayer = tree.find((n) => n.props.className === "om-layer-main")!;
  firstLayer.props.onClick();
  tree = render();
  get(tree, Slider, t.epsCustom).props.onChange(9);
  tree = render();
  tree.filter((n) => n.props.className === "om-layer-main")[1].props.onClick();
  tree = render();
  const before = current().sim;
  button(tree, t.arRecalculate).props.onClick();
  tree = render();
  expect(current().sim).toBe(before);
  expect(tree.some((n) => n.props.role === "status" && n.props.children === t.arEqual)).toBe(true);
});
