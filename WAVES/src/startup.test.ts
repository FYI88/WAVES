import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import startupSource from "../public/startup.js?raw";
import indexSource from "../index.html?raw";

// Execute the actual pre-module bootstrap with a minimal DOM, not string checks.
class ElementStub extends EventTarget {
  textContent = "";
  hidden = true;
  removed = false;
  attributes = new Map<string, string>();
  onclick: (() => void) | null = null;
  click() { this.dispatchEvent(new Event("click")); this.onclick?.(); }
  remove() { this.removed = true; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  focus = vi.fn();
}

describe("static startup lifecycle", () => {
  let elements: Record<string, ElementStub>;
  let frames: Map<number, FrameRequestCallback>;
  let reload: ReturnType<typeof vi.fn>;
  let id: number;
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const boot = (lang = "en") => {
    vi.stubGlobal("navigator", { language: lang });
    new Function(startupSource)();
    return window.wavesStartup;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    id = 0;
    frames = new Map();
    reload = vi.fn();
    elements = Object.fromEntries(["startup-shell", "startup-status", "startup-retry", "root"].map((key) => [key, new ElementStub()]));
    elements.root.setAttribute("aria-busy", "true");
    vi.stubGlobal("document", Object.assign(new EventTarget(), { getElementById: (key: string) => elements[key], activeElement: null }));
    vi.stubGlobal("window", {
      setTimeout, clearTimeout, location: { reload },
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
      cancelAnimationFrame: (key: number) => frames.delete(key),
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("paints before initialization and removes the shell immediately on commit, without a minimum delay", async () => {
    const startup = boot();
    const cleanup = vi.fn();
    const load = vi.fn(async () => cleanup);
    startup.start(load);
    startup.start(load);
    expect(load).not.toHaveBeenCalled();
    frame();
    await settle();
    expect(load).not.toHaveBeenCalled();
    frame();
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(elements["startup-shell"].removed).toBe(false); // import != commit
    startup.ready();
    expect(elements["startup-shell"].removed).toBe(true);
    expect(elements.root.attributes.has("aria-busy")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    startup.ready();
    startup.fail();
    vi.advanceTimersByTime(9000);
    expect(elements["startup-retry"].hidden).toBe(true);
    startup.dispose();
    startup.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each(["en", "fr-FR"])("keeps slow %s startup pending after 8 seconds without retry or reload, and accepts a late ready", (lang) => {
    const startup = boot(lang);
    vi.advanceTimersByTime(7999);
    expect(elements["startup-retry"].hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(elements["startup-status"].textContent).toContain(lang === "en" ? "Still loading" : "Chargement en cours");
    expect(elements["startup-retry"].hidden).toBe(true);
    expect(elements["startup-shell"].removed).toBe(false);
    expect(elements["startup-shell"].attributes.get("data-state")).not.toBe("error");
    vi.advanceTimersByTime(60000);
    expect(reload).not.toHaveBeenCalled();
    startup.ready();
    expect(elements["startup-shell"].removed).toBe(true);
  });

  it.each(["en", "fr"])("catches rejected chunk imports and retains a useful %s retry, not a blank screen", async (lang) => {
    const startup = boot(lang);
    startup.start(async () => { throw new Error("chunk unavailable"); });
    frame(); frame();
    await settle();
    expect(elements["startup-shell"].removed).toBe(false);
    expect(elements["startup-status"].textContent).toContain(lang === "fr" ? "Impossible" : "could not load");
    expect(elements["startup-retry"].hidden).toBe(false);
    expect(elements["startup-shell"].attributes.get("data-state")).toBe("error");
    expect(elements["startup-retry"].textContent).toBe(lang === "fr" ? "Recharger l’application" : "Reload app");
    elements["startup-retry"].click();
    expect(reload).toHaveBeenCalledOnce();
    Object.assign(document, { activeElement: elements["startup-retry"] });
    expect(vi.getTimerCount()).toBe(0);
    const error = elements["startup-status"].textContent;
    vi.advanceTimersByTime(9000);
    expect(elements["startup-status"].textContent).toBe(error); // timeout cannot overwrite failure
    startup.ready();
    expect(elements.root.focus).toHaveBeenCalledOnce();
  });

  it("captures an entry failure before imports start", () => {
    boot();
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: { tagName: "SCRIPT", type: "module" } });
    document.dispatchEvent(event);
    expect(elements["startup-retry"].hidden).toBe(false);
    expect(elements["startup-shell"].removed).toBe(false);
  });

  it("ignores nonessential image errors and removes the resource listener after success", () => {
    const startup = boot();
    const image = new Event("error");
    Object.defineProperty(image, "target", { value: { tagName: "IMG" } });
    document.dispatchEvent(image);
    expect(elements["startup-retry"].hidden).toBe(true);
    const remove = vi.spyOn(document, "removeEventListener");
    startup.ready();
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function), true);
  });

  it("disposes scheduled work and ignores late failures/readiness", async () => {
    const startup = boot();
    const load = vi.fn(async () => {});
    startup.start(load);
    frame();
    startup.dispose();
    frame();
    await settle();
    startup.ready(); startup.fail();
    vi.advanceTimersByTime(9000);
    expect(load).not.toHaveBeenCalled();
    expect(elements["startup-shell"].removed).toBe(false);
    expect(elements["startup-retry"].hidden).toBe(true);
    elements["startup-retry"].dispatchEvent(new Event("click"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("cleans up an import that resolves after disposal", async () => {
    const startup = boot();
    let resolve!: (cleanup: () => void) => void;
    const cleanup = vi.fn();
    startup.start(() => new Promise((done) => { resolve = done; }));
    frame(); frame();
    await settle();
    startup.dispose();
    resolve(cleanup);
    await settle();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("does not begin initialization if disposed between a frame and its microtask", async () => {
    const startup = boot();
    const load = vi.fn(async () => {});
    startup.start(load);
    frame(); frame();
    startup.dispose();
    await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps a working inline reload when bootstrap and entry scripts both fail", () => {
    // Execute the actual HTML fallback without executing either external file.
    const fallback = indexSource.match(/<script id="startup-fallback">([\s\S]*?)<\/script>/)![1];
    new Function(fallback)();
    expect(window.wavesStartup).toBeUndefined();
    expect(elements["startup-status"].textContent).toContain("could not start");
    expect(elements["startup-status"].textContent).toContain("Impossible de démarrer");
    expect(elements["startup-retry"].hidden).toBe(false);
    expect(elements["startup-shell"].removed).toBe(false);
    elements["startup-retry"].click();
    expect(reload).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replace a successful bootstrap's pending status or retry handler", () => {
    boot();
    const pending = elements["startup-status"].textContent;
    const fallback = indexSource.match(/<script id="startup-fallback">([\s\S]*?)<\/script>/)![1];
    new Function(fallback)();
    expect(elements["startup-status"].textContent).toBe(pending);
    expect(elements["startup-retry"].hidden).toBe(true);
    expect(elements["startup-retry"].onclick).toBeNull();
  });

  it("loads the real main entry safely when the bootstrap is absent", async () => {
    await expect(import("./main")).resolves.toBeDefined();
    expect(window.wavesStartup).toBeUndefined();
    expect(frames.size).toBe(0);
  });
});
