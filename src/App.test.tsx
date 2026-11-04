import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_STATE } from "./state/presets";
import { DICTS, type Lang } from "./i18n";
import { App } from "./App";
import type { ReactNode } from "react";
import { LAB_TEXT } from "./surface/labText";

const harness = vi.hoisted(() => ({ lang: "en" as Lang, index: 0, present: false, copied: false, scene: "main", target: {} }));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    // Drive App's presentation/copied slots without running browser effects.
    const index = harness.index++;
    return react.useState(index === 4 ? harness.scene : index === 16 ? harness.target : index === 8 ? harness.present : index === 9 ? harness.copied : initial);
  } };
});
vi.mock("./state/persistence", async (original) => ({
  ...await original<typeof import("./state/persistence")>(),
  loadInitial: () => ({ sim: DEFAULT_STATE, lang: harness.lang, theme: "dark" }),
}));

beforeEach(() => {
  harness.index = 0;
  harness.present = false;
  harness.scene = "main";
  harness.copied = false;
  vi.stubGlobal("navigator", { userAgent: "Chrome/140", language: "en" });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
});

it.each(["en", "fr"] as const)("renders results for the selected scene without a second lab in %s", (lang) => {
  harness.lang = lang;
  const main = renderToStaticMarkup(<App />);
  const mainResults = main.match(/<section class="om-results"[\s\S]*?<\/section>/)![0];
  expect(mainResults).toContain('class="om-stats"');
  expect(mainResults).toContain(DICTS[lang].reflected);
  expect(mainResults).not.toContain("om-lab-results-host");
  harness.index = 0;
  harness.scene = "lab";
  const lab = renderToStaticMarkup(<App />);
  const labResults = lab.match(/<section class="om-results"[\s\S]*?<\/section>/)![0];
  expect(labResults).toContain('class="om-lab-results-host"');
  expect(labResults).not.toContain('class="om-stats"');
  expect(lab).toContain('class="om-lab-results"');
  expect(lab).toContain(LAB_TEXT[lang].material);
  expect(lab.match(/class="om-card sl-lab"/g)).toHaveLength(1);
  expect(lab).toContain('class="sl-detail"');
  expect(lab).toContain('role="tablist"');
  harness.index = 0;
  harness.scene = "main";
  const restored = renderToStaticMarkup(<App />).match(/<section class="om-results"[\s\S]*?<\/section>/)![0];
  expect(restored).toBe(mainResults);
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
