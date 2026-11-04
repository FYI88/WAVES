import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { PALETTES } from "../theme";
import { SurfaceLab } from "./SurfaceLab";
import { DEFAULT_LAB } from "./labState";
import { wallAt } from "./rcwaJobs";
import { emtSolve } from "./emt";
import { LAB_TEXT } from "./labText";
import { rcwaPoint, rcwaSweep } from "./rcwaClient";
import type { RcwaResult } from "./rcwa";

const harness = vi.hoisted(() => ({
  effects: [] as Array<{ effect: () => void | (() => void); deps: unknown[] }>,
  refs: [] as unknown[],
  refIndex: 0,
  portal: vi.fn(), draw: vi.fn(),
  states: new Map<number, unknown>(), stateIndex: 0,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { harness.effects.push({ effect, deps }); },
    useRef: (value: unknown) => react.useRef(harness.refs[harness.refIndex++] ?? value),
    useState: (initial: unknown) => {
      const index = harness.stateIndex++;
      const [value] = react.useState(harness.states.has(index) ? harness.states.get(index) : initial);
      return [value, (next: unknown) => harness.states.set(index, typeof next === "function" ? next(value) : next)];
    },
  };
});
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode, target: HTMLElement) => { harness.portal(node, target); return null; } }));
vi.mock("./surfaceDetail", async (importOriginal) => ({
  ...await importOriginal<typeof import("./surfaceDetail")>(), drawSurfaceDetail: harness.draw,
}));
vi.mock("./rcwaClient", () => ({ rcwaPoint: vi.fn(), rcwaSweep: vi.fn() }));

function canvas(w: number, h: number) {
  const ctx = { setTransform: vi.fn() };
  return { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => ctx, ctx };
}

describe("SurfaceLab shared detail rendering", () => {
  let bottom: ReturnType<typeof canvas>;
  let top: ReturnType<typeof canvas>;
  let target: HTMLElement;
  let frames: Map<number, FrameRequestCallback>;
  let observe: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;
  let resize: () => void;
  let clock: { t: number; last: number | null };
  let motion: EventTarget & { matches: boolean };

  beforeEach(() => {
    harness.effects = [];
    harness.refIndex = 0;
    harness.stateIndex = 0;
    harness.states.clear();
    harness.draw.mockClear();
    harness.portal.mockClear();
    bottom = canvas(600, 360);
    top = canvas(900, 500);
    target = {} as HTMLElement;
    clock = { t: 12, last: null };
    harness.refs = [bottom, top, canvas(600, 200), clock];
    frames = new Map();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
    motion = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("window", { devicePixelRatio: 2, matchMedia: () => motion });
    vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
    observe = vi.fn();
    disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(fn: () => void) { resize = fn; }
      observe = observe;
      disconnect = disconnect;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function mount(playing: boolean) {
    const html = renderToStaticMarkup(<SurfaceLab freq={5} angle={30} pol="TE" lang="en" pal={PALETTES.dark}
      playing={playing} fmtNum={String} onFreq={() => {}} onAngle={() => {}} detailTarget={target} />);
    // Execute the actual detail animation effect, not unrelated solver/storage effects.
    const drawing = harness.effects.find(({ deps }) => deps?.length === 5 && deps[4] === target);
    expect(drawing).toBeDefined();
    return { html, cleanup: drawing!.effect() };
  }

  it("retains the bottom lab and portals only the additional canvas; paused views share phase and parameters", () => {
    const { html, cleanup } = mount(false);
    expect(html).toContain('class="om-card sl-lab"');
    expect(html).toContain('class="sl-detail"');
    expect(harness.portal).toHaveBeenCalledTimes(1);
    expect(harness.portal.mock.calls[0][1]).toBe(target);
    const portalHtml = renderToStaticMarkup(harness.portal.mock.calls[0][0]);
    expect(portalHtml).toContain('class="om-lab-canvas"');
    expect(portalHtml).not.toContain("sl-lab");
    expect(harness.draw.mock.calls.map((args) => args.slice(1, 4))).toEqual([[600, 360, 12], [900, 500, 12]]);
    expect(harness.draw.mock.calls[0][4]).toBe(harness.draw.mock.calls[1][4]);
    expect(frames.size).toBe(0);
    expect(observe.mock.calls.map(([node]) => node)).toEqual([bottom, top]);
    resize();
    expect(harness.draw).toHaveBeenCalledTimes(4);
    cleanup?.();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("draws the top lab when presentation hides the bottom, and cleans up its single animation loop", () => {
    bottom.clientWidth = 0;
    bottom.clientHeight = 0;
    const { cleanup } = mount(true);
    expect(harness.draw).toHaveBeenCalledTimes(1);
    expect(harness.draw.mock.calls[0][0]).toBe(top.ctx);
    expect(bottom.width).toBe(0);
    expect(top.width).toBe(1800);
    expect(frames.size).toBe(1);
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    expect(frames.size).toBe(0);
    motion.matches = false;
    motion.dispatchEvent(new Event("change"));
    expect(frames.size).toBe(1);
    // Visibility changes use the same restart path as reduced motion.
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    cleanup?.();
    expect(frames.size).toBe(0);
    motion.dispatchEvent(new Event("change"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
  });

  it.each(["dark", "light"] as const)("uses semantic legend colours and shared ranges in the %s theme", (theme) => {
    const html = renderToStaticMarkup(<SurfaceLab freq={5} angle={30} pol="TE" lang="fr" pal={PALETTES[theme]}
      playing={false} fmtNum={String} onFreq={() => {}} onAngle={() => {}} />);
    const legend = html.match(/<div class="sl-legend">(.*?)<\/div>/)![1];
    for (const token of ["ref", "tra", "abs"]) expect(legend).toContain(`--tone:var(--sl-${token})`);
    expect(legend).toContain('class="is-dash"');
    const ranges = html.match(/<input type="range"[^>]+>/g)!;
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range).toContain('class="om-range"');
      expect(range).toContain('aria-valuetext="');
      const progress = Number(range.match(/--pf:([^";]+)/)![1]);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  function results(pol: "TE" | "TM" | "AVG" = "TE", freq = 5) {
    harness.refIndex = 0;
    harness.stateIndex = 0;
    harness.effects = [];
    harness.portal.mockClear();
    const html = renderToStaticMarkup(<SurfaceLab freq={freq} angle={30} pol={pol} lang="en" pal={PALETTES.dark}
      playing={false} fmtNum={(v, d) => v.toFixed(d)} onFreq={() => {}} onAngle={() => {}}
      detailTarget={target} resultsTarget={target} />);
    const node = harness.portal.mock.calls[0][0];
    return { html, props: node.props, sidebar: renderToStaticMarkup(node) };
  }

  it.each(["TE", "TM", "AVG"] as const)("portals authoritative %s lab computations and metadata, not main-wall values", (pol) => {
    // A deliberately different experiment from the main stack, including a mixed profile and backing.
    const profile = { ...DEFAULT_LAB.profile, id: "triangle" as const, period: 1.2, depth: 1.7 };
    const below = [{ material: "glass" as const, cm: 2, customEps: 4, customSigma: 0.05 }];
    const inclusions = { ...DEFAULT_LAB.inclusions, fraction: 0.12 };
    harness.states.set(1, profile);
    harness.states.set(2, "brick");
    harness.states.set(5, below);
    harness.states.set(6, inclusions);
    const wall = wallAt({ profile, material: "brick", customEps: 4, customSigma: 0.05, below, inclusions, inclusionTarget: -1 }, 5);
    const expected = emtSolve(profile, wall.eta, wall.below, 5, 30, pol, DEFAULT_LAB.slices);
    const { props, sidebar, html } = results(pol);
    expect(props).toMatchObject({ R: expected.R, T: expected.T, A: expected.A, pol, material: "brick", profile, below, source: "emt", busy: false, error: null });
    expect(sidebar).toContain("Fast (EMT)");
    expect(sidebar).toContain("Brick");
    expect(sidebar).toContain(pol);
    expect(sidebar).toContain(`${(expected.R * 100).toFixed(expected.R * 100 < 10 ? 2 : 1)} %`);
    expect(sidebar).not.toContain("Previous RCWA");
    // The exact same values feed the detail drawing in both canvases.
    harness.effects.find(({ deps }) => deps?.length === 5 && deps[4] === target)!.effect();
    expect(harness.draw.mock.calls[0][4]).toMatchObject({ R: expected.R, T: expected.T, pol });
    expect(html.match(/class="om-card sl-lab"/g)).toHaveLength(1);
  });

  it("labels the initial rigorous preview, current solve, stale update and real keyed failure without fake zeros", async () => {
    vi.useFakeTimers();
    Object.assign(window, { setTimeout, clearTimeout });
    try {
      harness.states.set(9, "rigorous");
      let rejectPoint: (reason: Error) => void = () => {};
      const resolved = { R: 0.23, T: 0.61, A: 0.16, orders: [], harmonics: 10 } as unknown as RcwaResult;
      vi.mocked(rcwaPoint).mockResolvedValueOnce(resolved).mockImplementationOnce(() => new Promise((_, reject) => { rejectPoint = reject; }));
      let view = results();
      expect(view.props).toMatchObject({ source: "preview", busy: true, error: null });
      expect(view.sidebar).toContain(LAB_TEXT.en.emtPreview);
      // Run the real debounced point effect; no second solver is introduced by the portal.
      const pointEffect = harness.effects.find(({ deps }) => deps?.length === 2 && deps[0] === "rigorous")!;
      const cleanup = pointEffect.effect();
      await vi.advanceTimersByTimeAsync(120);
      expect(rcwaPoint).toHaveBeenCalledTimes(1);
      view = results();
      expect(view.props).toMatchObject({ R: 0.23, T: 0.61, A: 0.16, source: "rcwa", busy: false, error: null });
      expect(view.sidebar).not.toContain(LAB_TEXT.en.previousResult);
      cleanup?.();
      view = results("TM", 7);
      expect(view.props).toMatchObject({ R: 0.23, source: "previous", busy: true, pol: "TM", freq: 7 });
      expect(view.sidebar).toContain(LAB_TEXT.en.previousResult);
      harness.effects.find(({ deps }) => deps?.length === 2 && deps[0] === "rigorous")!.effect();
      await vi.advanceTimersByTimeAsync(120);
      rejectPoint(new Error("worker unavailable"));
      await vi.advanceTimersByTimeAsync(0);
      view = results("TM", 7);
      expect(view.props).toMatchObject({ R: 0.23, source: "previous", busy: false, error: "worker unavailable" });
      expect(view.sidebar).toContain("RCWA error: worker unavailable");
      view = results("AVG", 8);
      expect(view.props).toMatchObject({ source: "previous", busy: true, error: null });
      expect(view.sidebar).not.toContain("worker unavailable");
      harness.states.set(9, "fast");
      view = results("AVG", 8);
      expect(view.props).toMatchObject({ source: "emt", busy: false, error: null });
      expect(view.props.R).not.toBe(0.23);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an explicitly labelled EMT preview after a failed first RCWA request", async () => {
    vi.useFakeTimers();
    Object.assign(window, { setTimeout, clearTimeout });
    try {
      harness.states.set(9, "rigorous");
      vi.mocked(rcwaPoint).mockRejectedValueOnce(new Error("first point failed"));
      const initial = results();
      const emtR = initial.props.R;
      harness.effects.find(({ deps }) => deps?.length === 2 && deps[0] === "rigorous")!.effect();
      await vi.advanceTimersByTimeAsync(120);
      const failed = results();
      expect(failed.props).toMatchObject({ R: emtR, source: "preview", busy: false, error: "first point failed" });
      expect(failed.sidebar).toContain(LAB_TEXT.en.emtPreview);
      expect(failed.sidebar).toContain("first point failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a sweep failure separately without invalidating the current RCWA point", async () => {
    vi.useFakeTimers();
    Object.assign(window, { setTimeout, clearTimeout });
    try {
      harness.states.set(9, "rigorous");
      vi.mocked(rcwaPoint).mockResolvedValueOnce({ R: 0.17, T: 0.73, A: 0.1, orders: [] } as unknown as RcwaResult);
      vi.mocked(rcwaSweep).mockRejectedValueOnce(new Error("sweep failed"));
      results();
      const point = harness.effects.find(({ deps }) => deps?.length === 2 && deps[0] === "rigorous")!;
      const sweep = harness.effects.find(({ deps }) => deps?.length === 3 && deps[0] === "rigorous")!;
      point.effect();
      sweep.effect();
      await vi.advanceTimersByTimeAsync(350);
      const view = results();
      expect(view.props).toMatchObject({ source: "rcwa", R: 0.17, busy: false, error: null, sweepError: "sweep failed" });
      expect(view.sidebar).toContain("sweep failed");
      expect(view.sidebar).not.toContain(LAB_TEXT.en.previousResult);
    } finally {
      vi.useRealTimers();
    }
  });
});
