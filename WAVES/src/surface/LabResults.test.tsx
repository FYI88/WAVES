import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { LabResults } from "./LabResults";
import { DEFAULT_PROFILE } from "./profiles";
import { LAB_TEXT } from "./labText";

const defaults: ComponentProps<typeof LabResults> = {
  lang: "en", fmtNum: (v, digits = 0) => v.toFixed(digits), R: 0.2, T: 0.7, A: 0.1,
  freq: 5, angle: 30, pol: "TE", profile: DEFAULT_PROFILE, material: "glass", below: [], mode: "fast",
  harmonics: 3, slices: 10, source: "emt", validity: "ok", mixValidity: null, outOfRange: false,
  busy: false, sweepBusy: false, error: null, sweepError: null, fog: null,
};
const render = (overrides: Partial<typeof defaults> = {}) => renderToStaticMarkup(<LabResults {...defaults} {...overrides} />);

describe("lab result sheet", () => {
  it.each(["en", "fr"] as const)("gives %s percentages a clear hierarchy and a labelled energy figure", (lang) => {
    const html = render({ lang });
    expect(html).toContain('<article class="om-lab-results" data-current="true">');
    expect(html.match(/class="om-ring"/g)).toHaveLength(2);
    expect(html.match(/class="om-hero-value"/g)).toHaveLength(2);
    expect(html).toContain('class="om-budget-legend"');
    expect(html).toContain('aria-label="R 20.0 %, T 70.0 %, A 10.0 %"');
    expect(html).toContain("width:70%");
    expect(html).toContain(LAB_TEXT[lang].energyBalance);
    expect(html).toContain("dB");
    expect(html).toContain(LAB_TEXT[lang].configuration);
    expect(html).toContain("100.0 %");
    expect(html).not.toContain("linear-gradient");
  });

  it("keeps previous-result, preview, busy and error messages visible above the figures", () => {
    const html = render({ source: "previous", busy: true, sweepBusy: true, error: "point failed", sweepError: "sweep failed" });
    expect(html).toContain('data-current="false"');
    expect(html).toContain(LAB_TEXT.en.previousResult);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("RCWA error: point failed");
    expect(html).toContain("sweep failed");
    expect(html.indexOf(LAB_TEXT.en.previousResult)).toBeLessThan(html.indexOf('class="om-lab-energy-sheet"'));
    expect(render({ source: "preview" })).toContain(LAB_TEXT.en.emtPreview);
  });

  it("does not normalize a nonconserving balance or hide zero and full values", () => {
    const html = render({ T: 0.6 });
    expect(html).toContain("90.0 %");
    expect(html).toContain("width:60%");
    expect(html).not.toContain("width:66.");
    const full = render({ R: 0, T: 1, A: 0 });
    expect(full).toContain('aria-label="R 0.00 %, T 100.0 %, A 0.00 %"');
    expect(full).toContain("width:0%");
    expect(full).toContain("width:100%");
    const excess = render({ R: 0.7, T: 0.6 });
    expect(excess).toContain("140.0 %");
    expect(excess).toContain('aria-label="R 70.0 %, T 60.0 %, A 10.0 %"');
  });

  it("organizes backing layers, calculation details, validity and fog separately", () => {
    const html = render({
      mode: "rigorous", source: "rcwa", pol: "AVG", validity: "invalid", mixValidity: "marginal", outOfRange: true,
      profile: { ...DEFAULT_PROFILE, id: "triangle", period: 1.2 },
      below: [{ material: "brick", cm: 4, customEps: 4, customSigma: 0.05 }, { material: "glass", cm: 0.4, customEps: 4, customSigma: 0.05 }],
      fog: { R: 0.18, T: 0.68, lossDb: 0.23 },
    });
    expect(html).toContain('<abbr title="Average">AVG</abbr>');
    expect(html.match(/class="om-lab-layer-row"/g)).toHaveLength(2);
    expect(html).toContain("Brick");
    expect(html).toContain("4.00 cm");
    expect(html).toContain("0.40 cm");
    expect(html).toContain('<details class="om-lab-calculation-details">');
    expect(html).not.toContain('<details class="om-lab-calculation-details" open');
    expect(html).toContain("Harmonics");
    expect(html).toContain('data-state="invalid"');
    expect(html).toContain('data-state="marginal"');
    expect(html).toContain("Link with fog");
    expect(html).toContain("0.230 dB");
    expect(html).toContain('<svg viewBox="0 0 24 24" aria-hidden="true"');
  });
});
