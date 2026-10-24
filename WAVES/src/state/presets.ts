import { TEMPLATES, mkLayer } from "./layers";
import { computeResults, type SimState } from "./results";

export const DEFAULT_STATE: SimState = {
  layers: TEMPLATES.glazing(),
  sel: 0,
  freq: 5,
  angle: 35,
  pol: "TE",
};

/** Scenario presets (keys match the `presetNames` i18n entries). */
export function presetState(key: string, sim: SimState): SimState {
  switch (key) {
    case "wifi24":
      return { ...sim, layers: TEMPLATES.cavity(), sel: 0, freq: 2.4, angle: 0, pol: "AVG" };
    case "wifi5":
      return { ...sim, layers: TEMPLATES.partition(), sel: 0, freq: 5.5, angle: 30, pol: "AVG" };
    case "lte":
      return { ...sim, layers: TEMPLATES.plastered(), sel: 1, freq: 3.5, angle: 20, pol: "TE" };
    case "mmw":
      return { ...sim, layers: TEMPLATES.glazing(), sel: 0, freq: 28, angle: 45, pol: "AVG" };
    default: {
      const base: SimState = { ...sim, layers: [mkLayer("glass", 1)], sel: 0, freq: 5, pol: "TM" };
      const b = computeResults(base).layers[0].brewster;
      return { ...base, angle: Math.round(b * 2) / 2 };
    }
  }
}
