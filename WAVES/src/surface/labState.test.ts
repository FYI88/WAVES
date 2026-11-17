import { describe, expect, it, vi } from "vitest";
import { encodeShare, type ShareState } from "../share";
import { DEFAULT_LAB, LAB_MAX_BELOW, LAB_STORAGE_KEY, labForShare, labFromHash, loadLab, saveLab, sanitizeLab, setLabSnapshot, type LabState } from "./labState";

const SIM: ShareState = {
  layers: [{ id: "a1", mat: "concrete", thickness: 20, eps: 4, sigma: 0.05, customMode: "eps" }],
  sel: 0,
  freq: 5,
  angle: 35,
  pol: "TE",
};

const LAB: LabState = {
  ...DEFAULT_LAB,
  profile: { ...DEFAULT_LAB.profile, id: "sawtooth", period: 6, depth: 1.5 },
  material: "metal",
  below: [],
  mode: "rigorous",
  harmonics: 8,
  axis: "freq",
};

describe("lab state", () => {
  it("fills a missing or empty payload with the defaults", () => {
    expect(sanitizeLab(null)).toBeNull();
    expect(sanitizeLab("x")).toBeNull();
    expect(sanitizeLab([])).toBeNull();
    expect(sanitizeLab({})).toEqual(DEFAULT_LAB);
    expect(sanitizeLab(DEFAULT_LAB)).toEqual(DEFAULT_LAB);
  });

  it("clamps values to the control ranges and rejects unknown ids", () => {
    const s = sanitizeLab({
      profile: { id: "spiral", period: 999, depth: -1, steps: 3.6, seed: 1e9 },
      material: "unobtainium",
      harmonics: 100,
      slices: 1,
      mode: "magic",
      axis: "time",
      inclusions: { kind: "oil", fraction: 2 },
      fog: { lwc: -1, toWallM: 1e6 },
      showInMain: "yes",
      mainEfficiencies: 1,
    });
    expect(s?.showInMain).toBe(true);
    // retired option (older links and saved states): dropped, not carried
    expect(s && "mainEfficiencies" in s).toBe(false);
    // orders are opt-in: off unless explicitly true
    expect(s?.showOrders).toBe(false);
    expect(sanitizeLab({ showOrders: true })?.showOrders).toBe(true);
    expect(s?.profile.id).toBe(DEFAULT_LAB.profile.id);
    expect(s?.profile.period).toBe(30);
    expect(s?.profile.depth).toBe(0.05);
    expect(s?.profile.steps).toBe(4);
    expect(s?.profile.seed).toBe(99);
    expect(s?.material).toBe(DEFAULT_LAB.material);
    expect(s?.harmonics).toBe(20);
    expect(s?.slices).toBe(4);
    expect(s?.mode).toBe("fast");
    expect(s?.axis).toBe("angle");
    expect(s?.inclusions.kind).toBe("air");
    expect(s?.inclusions.fraction).toBe(0.6);
    expect(s?.fog.lwc).toBe(0);
    expect(s?.fog.toWallM).toBe(2000);
  });

  it("caps the flat layers and keeps the bubble target in range", () => {
    const layer = { material: "brick", cm: 10, customEps: 4, customSigma: 0.05 };
    const s = sanitizeLab({ below: [layer, layer, layer, layer, layer, layer, "junk"], incTarget: 9 });
    expect(s?.below).toHaveLength(LAB_MAX_BELOW);
    expect(s?.incTarget).toBe(LAB_MAX_BELOW - 1);
    expect(sanitizeLab({ below: [], incTarget: 2 })?.incTarget).toBe(-1);
  });

  it("round-trips through a share link", () => {
    expect(labFromHash(`#s=${encodeShare(SIM, "fr", "dark", LAB)}`)).toEqual(LAB);
    expect(labFromHash(`#s=${encodeShare(SIM, "fr", "dark")}`)).toBeUndefined();
    expect(labFromHash("#other=1")).toBeNull();
  });

  it("leaves an untouched lab out of share links", () => {
    setLabSnapshot(DEFAULT_LAB);
    expect(labForShare()).toBeUndefined();
    setLabSnapshot(LAB);
    expect(labForShare()).toEqual(LAB);
  });

  it("round-trips whole-wall scope and the opt-in main toggle through storage and share", () => {
    const lab: LabState = { ...LAB, incTarget: "all", applyInclusionsToMain: true, inclusions: { ...LAB.inclusions, kind: "water", fraction: 0.1 } };
    const values = new Map<string, string>();
    vi.stubGlobal("window", { location: { hash: "" }, localStorage: {
      setItem: (key: string, value: string) => values.set(key, value),
      getItem: (key: string) => values.get(key) ?? null,
    } });
    try {
      saveLab(lab);
      expect(JSON.parse(values.get(LAB_STORAGE_KEY)!)).toEqual(lab);
      expect(loadLab()).toEqual(lab);
      setLabSnapshot(lab);
      const hash = `#s=${encodeShare(SIM, "en", "dark", labForShare())}`;
      expect(labFromHash(hash)).toEqual(lab);
      window.location.hash = hash;
      saveLab(DEFAULT_LAB);
      expect(loadLab()).toEqual(lab); // shared config wins
    } finally { vi.unstubAllGlobals(); }
  });

  it("sanitizes unknown scope/toggle values and still accepts legacy numeric scopes", () => {
    for (const incTarget of ["whole", "0", {}, null, NaN, Infinity]) expect(sanitizeLab({ incTarget })?.incTarget).toBe(-1);
    for (const applyInclusionsToMain of ["true", 1, null, {}, undefined]) expect(sanitizeLab({ applyInclusionsToMain })?.applyInclusionsToMain).toBe(false);
    for (const incTarget of [-1, 0]) expect(sanitizeLab({ incTarget })?.incTarget).toBe(incTarget);
    expect(sanitizeLab({ below: [], incTarget: "all", applyInclusionsToMain: true })).toMatchObject({ incTarget: "all", applyInclusionsToMain: true });
    expect(labFromHash(`#s=${encodeShare(SIM, "fr", "dark", { incTarget: 0 })}`)).toMatchObject({ incTarget: 0, applyInclusionsToMain: false });
  });

  it.each(["v1", "v2 omitted", "v2 enabled", "v2 disabled", "absent", "malformed"])("loads %s without inheriting unshared main-wall mixing", (kind) => {
    const saved: LabState = { ...LAB, applyInclusionsToMain: true, inclusions: { ...LAB.inclusions, fraction: 0.2 } };
    const shared: LabState = { ...DEFAULT_LAB, applyInclusionsToMain: kind === "v2 enabled", inclusions: { ...DEFAULT_LAB.inclusions, fraction: 0.1 } };
    const hash = kind === "v1"
      ? `#s=${btoa(JSON.stringify({ v: 1, sim: SIM, lang: "en", theme: "dark" })).replace(/=+$/, "")}`
      : kind === "absent" ? "" : kind === "malformed" ? "#s=not-valid"
      : `#s=${encodeShare(SIM, "en", "dark", kind === "v2 omitted" ? undefined : shared)}`;
    vi.stubGlobal("window", { location: { hash }, localStorage: { getItem: () => JSON.stringify(saved) } });
    try {
      const expected = kind === "v1" || kind === "v2 omitted" ? { ...saved, applyInclusionsToMain: false }
        : kind === "absent" || kind === "malformed" ? saved : shared;
      expect(loadLab()).toEqual(expected);
      expect(labFromHash(hash)).toEqual(kind === "v1" || kind === "v2 omitted" ? undefined
        : kind === "absent" || kind === "malformed" ? null : shared);
    } finally { vi.unstubAllGlobals(); }
  });
});
