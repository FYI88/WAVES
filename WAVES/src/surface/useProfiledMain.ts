import { useEffect, useMemo, useState } from "react";
import type { PolMode } from "../physics";
import type { Inclusions } from "../media/mixing";
import type { Layer } from "../state/layers";
import type { Validity } from "./emt";
import { mainEmt, mainEmtValidity, mainWallSpec } from "./profiledMain";
import type { RcwaOrder, RcwaResult } from "./rcwa";
import { rcwaPoint } from "./rcwaClient";
import type { RtSource, SceneSurface } from "./sceneOverlay";

export type RtView = "flat" | "profiled";

export interface ProfiledRt {
  /** resultant R / T / A, summed over all propagating orders (EMT: order 0 only);
      drawn as the single reflected and transmitted beams */
  R: number;
  T: number;
  A: number;
  source: Exclude<RtSource, "flat">;
  /** rigorous mode selected but the RCWA result for this state is not ready */
  busy: boolean;
  validity: Validity;
  /** main-wall order efficiencies (RCWA only), used when the orders are shown */
  orders: RcwaOrder[] | null;
}

const RT_VIEW_KEY = "waves:rt-view";

export function loadRtView(): RtView {
  try {
    return localStorage.getItem(RT_VIEW_KEY) === "flat" ? "flat" : "profiled";
  } catch {
    return "profiled";
  }
}

export function saveRtView(view: RtView) {
  try {
    localStorage.setItem(RT_VIEW_KEY, view);
  } catch {
    /* storage unavailable: session only */
  }
}

/**
 * R / T of the main wall with the lab profile on its first layer, using the
 * lab's calculation mode. Null when the flat result applies (no profile shown,
 * flat view selected, or no lab settings yet).
 */
export function useProfiledMain(
  surface: SceneSurface | null,
  layers: Layer[],
  freq: number,
  angle: number,
  pol: PolMode,
  view: RtView,
  inclusions?: Inclusions | null,
): ProfiledRt | null {
  const calc = surface?.calc;
  const profile = surface?.profile;
  const active = view === "profiled" && !!profile && profile.id !== "flat" && !!calc;
  const spec = useMemo(() => (active && profile ? mainWallSpec(profile, layers, inclusions) : null), [active, profile, layers, inclusions]);
  const slices = calc?.slices ?? 24;
  const harmonics = calc?.harmonics ?? 10;
  const rigorous = calc?.mode === "rigorous";

  const emt = useMemo(() => (spec ? mainEmt(spec, freq, angle, pol, slices) : null), [spec, freq, angle, pol, slices]);
  const validity = useMemo<Validity>(() => (spec ? mainEmtValidity(spec, freq, angle) : "ok"), [spec, freq, angle]);

  const key = spec && rigorous ? JSON.stringify([spec, freq, angle, pol, harmonics, slices]) : null;
  const [rc, setRc] = useState<{ key: string; result: RcwaResult } | null>(null);

  useEffect(() => {
    if (!key || !spec) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      rcwaPoint({ kind: "point", wall: spec, pol, harmonics, slices, fGHz: freq, thetaDeg: angle })
        .then((result) => {
          if (alive) setRc({ key, result });
        })
        .catch(() => {
          /* keep the EMT value; the lab shows RCWA errors */
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // key captures spec, freq, angle, pol, harmonics and slices
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!spec || !emt) return null;
  const fresh = key !== null && rc !== null && rc.key === key ? rc.result : null;
  if (fresh) {
    return { R: fresh.R, T: fresh.T, A: fresh.A, source: "rcwa", busy: false, validity, orders: fresh.orders };
  }
  return { R: emt.R, T: emt.T, A: emt.A, source: "emt", busy: rigorous, validity, orders: null };
}
