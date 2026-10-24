/**
 * Share-link codec (Phase 1) — pure functions, no DOM, no React.
 *
 * A shared setup is the full SimState shape plus lang/theme, JSON-encoded and
 * base64url'd into `#s=…`. Decoding never trusts the payload: it returns the
 * raw object and lets App's sanitizePersisted() clamp/validate everything.
 */
export const SHARE_VERSION = 1;

export interface ShareLayer {
  id: string;
  mat: string;
  thickness: number;
  eps: number;
  sigma: number;
  customMode: string;
}

export interface ShareState {
  layers: ShareLayer[];
  sel: number;
  freq: number;
  angle: number;
  pol: string;
}

export interface SharePayload {
  v: number;
  sim: ShareState;
  lang: string;
  theme: string;
}

const b64urlEncode = (json: string): string => {
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlDecode = (s: string): string => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export function encodeShare(sim: ShareState, lang: string, theme: string): string {
  const payload: SharePayload = {
    v: SHARE_VERSION,
    sim: {
      layers: sim.layers.map((l) => ({
        id: l.id,
        mat: l.mat,
        thickness: l.thickness,
        eps: l.eps,
        sigma: l.sigma,
        customMode: l.customMode,
      })),
      sel: sim.sel,
      freq: sim.freq,
      angle: sim.angle,
      pol: sim.pol,
    },
    lang,
    theme,
  };
  return b64urlEncode(JSON.stringify(payload));
}

export function decodeShare(hash: string): SharePayload | null {
  try {
    if (!hash || /[^A-Za-z0-9\-_]/.test(hash)) return null;
    const p = JSON.parse(b64urlDecode(hash)) as Partial<SharePayload>;
    if (!p || typeof p !== "object" || p.v !== SHARE_VERSION) return null;
    const s = p.sim;
    if (!s || typeof s !== "object" || !Array.isArray(s.layers)) return null;
    return p as SharePayload;
  } catch {
    return null;
  }
}

/** Extract `#s=…` from a location.hash string (empty when absent). */
export function shareHashOf(locationHash: string): string | null {
  const m = /#s=([A-Za-z0-9\-_]+)/.exec(locationHash);
  return m ? m[1] : null;
}
