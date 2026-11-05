import { describe, expect, it } from "vitest";
import { buildShareUrl } from "./native";
import { decodeShare, encodeShare, shareHashOf, type ShareState } from "./share";

describe("share URL platform base", () => {
  const sim: ShareState = {
    layers: [{ id: "glass", mat: "glass", thickness: 0.4, eps: 4, sigma: 0.05, customMode: "eps" }],
    sel: 0, freq: 5, angle: 35, pol: "TE",
  };
  const lab = { profile: { id: "sine", period: 3 }, mode: "rigorous" };
  const encoded = encodeShare(sim, "fr", "dark", lab);

  it.each([
    [true, "https://localhost", "/index.html", "https://waves-pearl.vercel.app/"],
    [false, "https://preview.example", "/waves/index.html", "https://preview.example/waves/index.html"],
    [false, "https://localhost", "/", "https://localhost/"],
  ] as const)("uses the correct base (native=%s, origin=%s)", (native, origin, pathname, base) => {
    const url = buildShareUrl(encoded, { origin, pathname }, native);
    expect(url).toBe(`${base}#s=${encoded}`);
    expect(decodeShare(shareHashOf(new URL(url).hash)!)).toMatchObject({ sim, lang: "fr", theme: "dark", lab });
  });
});
