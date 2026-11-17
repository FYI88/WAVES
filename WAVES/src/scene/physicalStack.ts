import { expandLayers, type LayerMat } from "../state/layers";
import type { Results, SimState } from "../state/results";
import { applyMove, applyResize } from "./dragStack";
import type { SceneLayer } from "./RayScene";

/** All drawing indices are physical; all editing indices are host-owned. */
export function physicalScene(res: Results, sel: number, name: (mat: LayerMat) => string, insertName: string, coatingName: string, transmitted = res.T) {
  const subdivided = res.physicalLayers.some((l) => l.part !== "whole");
  const layers: SceneLayer[] = res.physicalLayers.map((l, i) => {
    const r = res.physicalResults[i];
    return {
      mat: l.mat, cm: l.thickness, thetaT: r.thetaT, nRe: r.nRe,
      absorbed: r.absorbed, fluxIn: r.fluxIn,
      fluxOut: res.physicalResults[i + 1]?.fluxIn ?? transmitted,
      name: l.part === "insert" ? insertName : l.matching ? coatingName : `${name(l.mat)}${l.part === "front" ? " · 1/2" : l.part === "back" ? " · 2/2" : ""}`,
      // Virtual boundaries must never resize/reorder individual host pieces.
      // Panel and keyboard still edit/move each complete host normally.
      readOnlyThickness: l.part !== "whole" || l.matchingDesign === "quarter-wave-live",
      readOnlyMove: subdivided,
      insert: l.part === "insert",
    };
  });
  return { layers, sel: res.physicalLayers.findIndex((l) => l.owner === sel) };
}

export function selectPhysical(s: SimState, index: number): SimState {
  const owner = expandLayers(s.layers)[index]?.owner;
  return owner === undefined || owner === s.sel ? s : { ...s, sel: owner };
}
export function resizePhysical(s: SimState, index: number, cm: number): SimState {
  const l = expandLayers(s.layers)[index];
  return !l || l.part !== "whole" ? s : applyResize(s, l.owner, cm);
}
export function movePhysical(s: SimState, from: number, to: number): SimState {
  if (s.layers.some((l) => l.embeddedInsert?.enabled)) return s;
  return applyMove(s, from, to);
}
