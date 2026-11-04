import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PALETTES } from "../theme";
import { RayScene, type SceneParams } from "./RayScene";

const harness = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, canvas: {} }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  // Run the component's actual effects explicitly: no DOM package is required.
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect); },
}));
vi.mock("./canvas", () => ({
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
    raf = vi.fn(() => 17);
    cancel = vi.fn();
    events = new EventTarget();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      matchMedia: () => ({ matches: false }),
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
});
