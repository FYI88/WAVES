import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PALETTES } from "../theme";
import { RayScene, type SceneParams } from "./RayScene";
import { prepCanvas } from "./canvas";
import { drawWaveRays } from "../waveRays";

const harness = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, refs: [] as Array<{ current: unknown }>, canvas: { removeAttribute: vi.fn() } }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react,
  useRef: <T,>(value: T) => { const ref = react.useRef(value); harness.refs.push(ref); return ref; },
  // Run the component's actual effects explicitly: no DOM package is required.
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
}; });
vi.mock("../waveRays", () => ({ drawWaveRays: vi.fn(() => ({ rects: [] })) }));
vi.mock("../perf", () => ({ recordFrame: vi.fn() }));
vi.mock("./canvas", () => ({
  prepCanvas: vi.fn(() => ({})),
  useAdaptiveDprCap: () => 2,
  useCanvasSize: (ref: { current: unknown }) => {
    ref.current = harness.canvas;
    return { w: 640, h: 400, dpr: 1 };
  },
}));

const params: SceneParams = {
  etas: [], ds: [], theta: 0, R: 0, T: 1, layers: [], sel: 0, hover: -1,
  freq: 5, pol: "TE", labels: { normal: "Normal", tx: "Tx", rx: "Rx", refl: "R" },
};
const render = (active?: boolean, lang: "fr" | "en" = "en") => renderToStaticMarkup(
  <RayScene active={active} params={params} pal={PALETTES.dark} playing={false} lang={lang}
    fmtNum={String} onSelect={() => {}} onMove={() => {}} onResize={() => {}}
    viewTools={<button>Surface Lab</button>} tools={<button>Flat R/T</button>} />,
);

describe("top scene simulation lifecycle", () => {
  let raf: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let events: EventTarget;

  beforeEach(() => {
    harness.effects = [];
    harness.refs = [];
    harness.canvas.removeAttribute.mockClear();
    vi.mocked(drawWaveRays).mockClear();
    vi.mocked(prepCanvas).mockClear();
    raf = vi.fn(() => 17);
    cancel = vi.fn();
    events = new EventTarget();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.stubGlobal("document", { hidden: false });
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the leading switch but removes all simulation controls and hides its canvas in lab mode", () => {
    const html = render(false);
    expect(html).toContain("Surface Lab");
    expect(html).toContain('data-view="lab"');
    expect(html).toContain('style="display:none"');
    for (const label of ["Section", "Spatial", "Flat R/T", "Curves", "Internal reflections", "Labels", "PNG"]) {
      expect(html).not.toContain(`>${label}<`);
    }
  });

  it("defaults to the active simulation and renders its existing controls after the switch", () => {
    const html = render();
    expect(html).toContain('data-view="wave"');
    expect(html).toContain('style="display:block"');
    expect(html.indexOf(">Surface Lab<")).toBeLessThan(html.indexOf(">Section<"));
    for (const label of ["Flat R/T", "Internal reflections", "Labels", "PNG"]) expect(html).toContain(`>${label}<`);
    expect(render(true, "fr")).toContain(">Coupe<");
  });

  it.each(["en", "fr"] as const)("renders named scene/view controls before separate display utilities in %s", (lang) => {
    const html = render(true, lang);
    const split = html.indexOf('class="om-scene-tool-group om-scene-display-tools"');
    expect(split).toBeGreaterThan(0);
    const scene = html.slice(0, split);
    const display = html.slice(split);
    expect(scene).toContain(`role="group" aria-label="${lang === "fr" ? "Scène et vue" : "Scene and view"}"`);
    for (const label of ["Surface Lab", "Spatial"]) expect(scene).toContain(`>${label}<`);
    expect(html).toContain('<details class="om-display-menu"><summary>');
    expect(display).toContain('>Flat R/T<');
    expect(display).toContain(`role="group" aria-label="${lang === "fr" ? "Options d’affichage" : "Display utilities"}"`);
    expect(display).toContain('type="checkbox" checked=""');
    expect(display).toContain(`aria-pressed="true">${lang === "fr" ? "Repères" : "Labels"}`);
    expect(display).toContain('class="om-scene-toggle om-scene-speed"');
    expect(display).toContain(">PNG<");
    expect(render(false, lang)).not.toContain('class="om-scene-tool-group om-scene-display-tools"');
  });

  it("does not schedule simulation frames or read shortcut payloads while inactive", () => {
    render(false);
    const cleanups = harness.effects.map((effect) => effect());
    expect(raf).not.toHaveBeenCalled();
    for (const name of ["waves:set-view", "waves:set-display"]) {
      const event = new Event(name);
      const detail = vi.fn(() => "toggle");
      Object.defineProperty(event, "detail", { get: detail });
      events.dispatchEvent(event);
      expect(detail).not.toHaveBeenCalled();
    }
    cleanups.forEach((cleanup) => cleanup?.());
  });

  it("schedules a fresh frame even when paused, and cancels it on deactivation/unmount cleanup", () => {
    render(true);
    const cleanups = harness.effects.map((effect) => effect());
    expect(raf).toHaveBeenCalledTimes(1);
    cleanups.forEach((cleanup) => cleanup?.());
    expect(cancel).toHaveBeenCalledWith(17);
  });

  it("keeps the canvas placeholder through missing context, then hides it only after a real draw", () => {
    const html = render(true);
    expect(html).toContain("Preparing scene…");
    const placeholder = { hidden: false };
    harness.refs[1].current = placeholder;
    harness.effects.forEach((effect) => effect());
    vi.mocked(prepCanvas).mockReturnValueOnce(null);
    const firstFrame = raf.mock.calls[0][0] as FrameRequestCallback;
    firstFrame(performance.now() + 1100);
    expect(placeholder.hidden).toBe(false);
    expect(drawWaveRays).not.toHaveBeenCalled();
    // Even paused/reduced-motion frames must retry after a context miss.
    const secondFrame = raf.mock.calls[1][0] as FrameRequestCallback;
    secondFrame(performance.now() + 1200);
    expect(drawWaveRays).toHaveBeenCalledOnce();
    expect(placeholder.hidden).toBe(true);
    expect(harness.canvas.removeAttribute).toHaveBeenCalledWith("aria-busy");
  });
});
