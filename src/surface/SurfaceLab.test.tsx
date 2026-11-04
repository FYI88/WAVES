import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { PALETTES } from "../theme";
import { SurfaceLab } from "./SurfaceLab";

const harness = vi.hoisted(() => ({
  effects: [] as Array<{ effect: () => void | (() => void); deps: unknown[] }>,
  refs: [] as unknown[],
  refIndex: 0,
  portal: vi.fn(), draw: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => { harness.effects.push({ effect, deps }); },
    useRef: (value: unknown) => react.useRef(harness.refs[harness.refIndex++] ?? value),
  };
});
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode, target: HTMLElement) => { harness.portal(node, target); return null; } }));
vi.mock("./surfaceDetail", async (importOriginal) => ({
  ...await importOriginal<typeof import("./surfaceDetail")>(), drawSurfaceDetail: harness.draw,
}));

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
});
