import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_STATE } from "./state/presets";
import { DICTS, type Lang } from "./i18n";
import { App } from "./App";

const harness = vi.hoisted(() => ({ lang: "en" as Lang, index: 0, present: false, copied: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    // Drive App's presentation/copied slots without running browser effects.
    const index = harness.index++;
    return react.useState(index === 8 ? harness.present : index === 9 ? harness.copied : initial);
  } };
});
vi.mock("./state/persistence", async (original) => ({
  ...await original<typeof import("./state/persistence")>(),
  loadInitial: () => ({ sim: DEFAULT_STATE, lang: harness.lang, theme: "dark" }),
}));

beforeEach(() => {
  harness.index = 0;
  harness.present = false;
  harness.copied = false;
  vi.stubGlobal("navigator", { userAgent: "Chrome/140", language: "en" });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["en", "fr"] as const)("keeps language, help, About, theme, share and primary actions in the rendered %s header", (lang) => {
  harness.lang = lang;
  const html = renderToStaticMarkup(<App />);
  const header = html.match(/<header[\s\S]*?<\/header>/)![0];
  const t = DICTS[lang];
  for (const label of [t.language, t.helpTitle, t.about, t.theme]) expect(header).toContain(`aria-label="${label}"`);
  for (const label of ["FR", "EN", t.share, t.present, t.pause]) expect(header).toContain(`>${label}<`);
  expect(header).toContain('class="om-icon-btn om-icon-link om-header-repo"');
  expect(header).toContain('class="om-presentbtn om-present-action ');
});

it("renders the copied SVG alongside translated success text and exposes presentation controls", () => {
  harness.lang = "en";
  harness.present = true;
  harness.copied = true;
  const html = renderToStaticMarkup(<App />);
  expect(html).toContain('data-present="true"');
  const share = html.match(/<button[^>]*class="om-presentbtn is-on"[\s\S]*?<\/button>/)![0];
  expect(share).toContain('<svg viewBox="0 0 24 24" aria-hidden="true"');
  expect(share).toContain(DICTS.en.copied);
  expect(html).toContain('<div class="om-presentbar">');
  expect(html).toContain(`aria-label="${DICTS.en.frequency}"`);
  expect(html).toContain(`aria-label="${DICTS.en.angle}"`);
});
