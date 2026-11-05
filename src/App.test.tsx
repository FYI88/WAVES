import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_STATE } from "./state/presets";
import { DICTS, type Lang } from "./i18n";
import { App } from "./App";
import type { ReactNode } from "react";
import { LAB_TEXT } from "./surface/labText";
import { NO_INCLUSIONS } from "./media/mixing";

const harness = vi.hoisted(() => ({ lang: "en" as Lang, index: 0, present: false, copied: false, help: false, about: false, scene: "main", target: {}, inclusions: null as null | typeof NO_INCLUSIONS }));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    // Drive App's presentation/copied slots without running browser effects.
    const index = harness.index++;
    return react.useState(index === 4 ? harness.scene : index === 16 ? harness.target : index === 17 ? harness.inclusions : index === 8 ? harness.present : index === 9 ? harness.copied : index === 10 ? harness.help : index === 11 ? harness.about : initial);
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
  harness.help = false;
  harness.about = false;
  harness.inclusions = null;
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

it.each(["en", "fr"] as const)("renders an academic About sheet with visible model text and one equations disclosure (%s)", (lang) => {
  harness.lang = lang;
  harness.about = true;
  const html = renderToStaticMarkup(<App />);
  const sheet = html.slice(html.indexOf('<div class="om-about"'));
  const t = DICTS[lang];
  expect(sheet).toContain('aria-labelledby="om-about-title"');
  expect(sheet).toContain(`<h2 id="om-about-title">${t.aboutTitle}</h2>`);
  expect(sheet).toContain('class="om-about-body"');
  expect(sheet).toContain(t.author);
  expect(sheet).toContain(t.school);
  expect(sheet).toContain('href="mailto:chetaine.younes@etu.uae.ac.ma"');
  expect(sheet).toContain('href="mailto:youneschetaine@gmail.com"');
  expect(sheet).toContain('href="https://github.com/FYI88/WAVES"');
  expect(sheet).toContain(`<p class="om-about-note">${t.modelNote}</p>`);
  expect(sheet).toContain('ITU-R P.2040 § 3');
  expect(sheet.match(/<details/g)).toHaveLength(1);
  expect(sheet).toContain(`<details class="om-model-more"><summary>${t.physicsEquations}</summary>`);
  expect(sheet).not.toContain('<details class="om-model-more" open');
  for (const label of [t.eqPermittivity, t.eqImpedance, t.eqSnell, t.eqFresnel]) expect(sheet).toContain(`<figcaption>${label}</figcaption>`);
  expect(sheet).toContain('class="om-about-build"');
  expect(sheet).not.toContain('om-about-mark');
});

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

it.each(["en", "fr"] as const)("renders compact SVG inclusion indicators and validity warnings only when active (%s)", (lang) => {
  harness.lang = lang;
  expect(renderToStaticMarkup(<App />)).not.toContain('class="om-inclusion-note');
  harness.index = 0;
  harness.inclusions = { ...NO_INCLUSIONS, fraction: 0.1, diameterMm: 30 };
  const html = renderToStaticMarkup(<App />);
  const label = `${LAB_TEXT[lang].inclusions} · ${LAB_TEXT[lang].air} 10 %`;
  expect(html.match(new RegExp(label, "g"))).toHaveLength(2);
  const line = html.match(/<p class="om-inclusion-note is-warn"[\s\S]*?<\/p>/)![0];
  expect(line).toContain('role="status"');
  expect(line).toContain('<svg viewBox="0 0 24 24" aria-hidden="true"');
  expect(line).toContain(LAB_TEXT[lang].valid.invalid);
  harness.index = 0;
  harness.inclusions = { ...harness.inclusions, fraction: 0 };
  expect(renderToStaticMarkup(<App />)).not.toContain('class="om-inclusion-note');
});
