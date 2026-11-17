import { afterEach, expect, it, vi } from "vitest";
import { frameHeightRef } from "./frameHeight";

vi.mock("./canvas", () => ({ cssZoom: () => 0.8 }));
afterEach(() => { frameHeightRef(null); vi.unstubAllGlobals(); });

it("keeps sidebar height measurement in layout pixels as the available frame changes", () => {
  let resize = () => {};
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  let height = 640;
  const setProperty = vi.fn();
  const node = { getBoundingClientRect: () => ({ height }), style: { setProperty } } as unknown as HTMLElement;
  frameHeightRef(node);
  expect(observe).toHaveBeenCalledWith(node);
  expect(setProperty).toHaveBeenLastCalledWith("--om-frame-h", "800px");
  height = 480;
  resize();
  expect(setProperty).toHaveBeenLastCalledWith("--om-frame-h", "600px");
  frameHeightRef(null);
  expect(disconnect).toHaveBeenCalledOnce();
});
