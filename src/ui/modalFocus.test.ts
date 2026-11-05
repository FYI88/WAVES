import { afterEach, expect, it, vi } from "vitest";
import { containModal } from "./modalFocus";

// Deterministic DOM contract test, not a browser/layout accessibility audit.
function setup() {
  const listeners = new Map<string, (event: any) => void>();
  let active: FakeElement;
  class FakeElement {
    children: FakeElement[] = [];
    parentElement: FakeElement | null = null;
    inert = false;
    isConnected = true;
    tabIndex = 0;
    visible = true;
    disabled = false;
    style = { overflow: "auto" };
    append(...nodes: FakeElement[]) { this.children.push(...nodes); nodes.forEach((node) => { node.parentElement = this; }); }
    focus = vi.fn(() => { active = this; });
    contains(node: FakeElement): boolean { return node === this || this.children.some((child) => child.contains(node)); }
    matches() { return this.disabled; }
    getClientRects() { return this.visible ? [{}] : []; }
    querySelector() { return this.children[0]; }
    querySelectorAll() { return this.children; }
  }
  const body = new FakeElement(), root = new FakeElement(), app = new FakeElement();
  const background = new FakeElement(), previouslyInert = new FakeElement(), backdrop = new FakeElement();
  const dialog = new FakeElement(), close = new FakeElement(), link = new FakeElement(), summary = new FakeElement(), equation = new FakeElement();
  equation.visible = false; // a formula inside the closed disclosure
  previouslyInert.inert = true;
  root.append(body); body.append(app); app.append(background, previouslyInert, backdrop); backdrop.append(dialog);
  dialog.append(close, link, summary, equation);
  active = background;
  const doc = { body, documentElement: root, get activeElement() { return active; },
    addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type) };
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", doc);
  const tab = (shiftKey = false) => {
    const event = { key: "Tab", shiftKey, preventDefault: vi.fn() };
    listeners.get("keydown")?.(event);
    return event;
  };
  return { dialog: dialog as unknown as HTMLElement, close, link, summary, equation, background, previouslyInert, backdrop, doc, listeners, tab };
}
afterEach(() => vi.unstubAllGlobals());

it("focuses close, isolates background, locks scrolling and restores the opener and previous state", () => {
  const s = setup();
  const release = containModal(s.dialog);
  expect(s.doc.activeElement).toBe(s.close);
  expect(s.background.inert).toBe(true);
  expect(s.backdrop.inert).toBe(false);
  expect(s.doc.body.style.overflow).toBe("hidden");
  expect(s.doc.documentElement.style.overflow).toBe("hidden");
  release();
  expect(s.doc.activeElement).toBe(s.background);
  expect(s.background.inert).toBe(false);
  expect(s.previouslyInert.inert).toBe(true);
  expect(s.doc.body.style.overflow).toBe("auto");
  expect(s.doc.documentElement.style.overflow).toBe("auto");
  expect(s.listeners.size).toBe(0);
});

it("wraps Tab in both directions, skips hidden equations and updates when disclosure opens", () => {
  const s = setup();
  const release = containModal(s.dialog);
  expect(s.tab(true).preventDefault).toHaveBeenCalledOnce();
  expect(s.doc.activeElement).toBe(s.summary);
  expect(s.tab().preventDefault).toHaveBeenCalledOnce();
  expect(s.doc.activeElement).toBe(s.close);
  s.link.focus();
  expect(s.tab().preventDefault).not.toHaveBeenCalled();
  s.equation.visible = true;
  s.close.focus(); s.tab(true);
  expect(s.doc.activeElement).toBe(s.equation);
  release();
});

it("contains programmatic focus and tolerates a removed opener", () => {
  const s = setup();
  const release = containModal(s.dialog);
  s.background.focus();
  s.listeners.get("focusin")?.({ target: s.background });
  expect(s.doc.activeElement).toBe(s.close);
  s.background.isConnected = false;
  s.background.focus.mockClear();
  release();
  expect(s.background.focus).not.toHaveBeenCalled();
});
