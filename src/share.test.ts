import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, shareHashOf, SHARE_VERSION, type ShareState } from "./share";

const SIM: ShareState = {
  layers: [
    { id: "a1", mat: "glass", thickness: 0.4, eps: 4, sigma: 0.05, customMode: "eps" },
    { id: "a2", mat: "air", thickness: 1.6, eps: 4, sigma: 0.05, customMode: "eps" },
    { id: "a3", mat: "glass", thickness: 0.4, eps: 4, sigma: 0.05, customMode: "eps" },
  ],
  sel: 0,
  freq: 5,
  angle: 35,
  pol: "TE",
};

describe("share-link codec", () => {
  it("round-trips a full setup", () => {
    const hash = encodeShare(SIM, "fr", "dark");
    expect(hash).toMatch(/^[A-Za-z0-9\-_]+$/);
    const back = decodeShare(hash);
    expect(back).not.toBeNull();
    expect(back?.v).toBe(SHARE_VERSION);
    expect(back?.sim).toEqual(SIM);
    expect(back?.lang).toBe("fr");
    expect(back?.theme).toBe("dark");
  });

  it("rejects garbage, wrong versions and truncated payloads", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("!!!not-base64!!!")).toBeNull();
    expect(decodeShare(encodeShare(SIM, "en", "light").slice(0, 24))).toBeNull();
    // hand-made v999 payload, correctly encoded
    const fake = btoa(JSON.stringify({ v: 999, sim: SIM, lang: "en", theme: "dark" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeShare(fake)).toBeNull();
  });

  it("extracts #s= from a location hash", () => {
    expect(shareHashOf("#s=abc123")).toBe("abc123");
    expect(shareHashOf("")).toBeNull();
    expect(shareHashOf("#other=1")).toBeNull();
  });
});
