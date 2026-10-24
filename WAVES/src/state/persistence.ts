import { decodeShare, shareHashOf } from "../share";
import { clamp } from "../render/util";
import type { Lang } from "../i18n";
import type { Theme } from "../theme";
import { LAYER_MATS, MAX_LAYERS, newId, type CustomMode } from "./layers";
import { DEFAULT_STATE } from "./presets";
import type { SimState } from "./results";

export const STORAGE_KEY = "onde-mur:v2";
export const STORAGE_VERSION = 1;

export interface Persisted {
  /** payload version; absent on payloads saved before versioning (treated as v1) */
  v?: number;
  sim: SimState;
  lang: Lang;
  theme: Theme;
}

export function defaultPersisted(): Persisted {
  const sysTheme: Theme =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const sysLang: Lang =
    typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
  return { sim: DEFAULT_STATE, lang: sysLang, theme: sysTheme };
}

/** Clamp/validate an untrusted payload (storage or share-link) into shape. */
export function sanitizePersisted(p: Partial<Persisted>, fallback: Persisted): Persisted {
  const s = (p.sim ?? {}) as Partial<SimState>;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;
  const layers = Array.isArray(s.layers)
    ? s.layers
        .slice(0, MAX_LAYERS)
        .filter((l) => l && LAYER_MATS.includes(l.mat))
        .map((l) => ({
          id: typeof l.id === "string" && l.id ? l.id : newId(),
          mat: l.mat,
          thickness: num(l.thickness, 0.1, 100, 10),
          eps: num(l.eps, 1, 30, 4),
          sigma: num(l.sigma, 0.0001, 10, 0.05),
          customMode: (l.customMode === "nk" ? "nk" : "eps") as CustomMode,
        }))
    : [];
  const ls = layers.length ? layers : fallback.sim.layers;
  return {
    sim: {
      layers: ls,
      sel: Math.round(num(s.sel, 0, ls.length - 1, 0)),
      freq: num(s.freq, 0.5, 40, fallback.sim.freq),
      angle: num(s.angle, 0, 89, fallback.sim.angle),
      pol: s.pol === "TE" || s.pol === "TM" || s.pol === "AVG" ? s.pol : fallback.sim.pol,
    },
    lang: p.lang === "fr" || p.lang === "en" ? p.lang : fallback.lang,
    theme: p.theme === "dark" || p.theme === "light" ? p.theme : fallback.theme,
  };
}

export function loadPersisted(): Persisted {
  const fallback = defaultPersisted();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    // payloads stamped with an unknown future version are rejected outright —
    // silently mis-loading a newer shape would corrupt the simulation state
    if (typeof p.v === "number" && p.v !== STORAGE_VERSION) return fallback;
    return sanitizePersisted(p, fallback);
  } catch {
    return fallback;
  }
}

/** Persist the current state (no-op when storage is unavailable). */
export function savePersisted(sim: SimState, lang: Lang, theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, sim, lang, theme }));
  } catch {
    /* storage unavailable — state simply isn't persisted */
  }
}

/** Decode a `#s=` share hash into a sanitized state, or null. */
export function persistedFromHash(hash: string): Persisted | null {
  const h = shareHashOf(hash);
  if (!h) return null;
  const shared = decodeShare(h);
  if (!shared) return null;
  return sanitizePersisted(
    {
      v: shared.v,
      sim: shared.sim as unknown as SimState,
      lang: shared.lang as Lang,
      theme: shared.theme as Theme,
    },
    defaultPersisted(),
  );
}

/** Boot state: a `#s=` share-link wins over saved storage. */
export function loadInitial(): Persisted {
  try {
    const shared = persistedFromHash(window.location.hash);
    if (shared) return shared;
  } catch {
    /* malformed hash — fall through to storage */
  }
  return loadPersisted();
}
