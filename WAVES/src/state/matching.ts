import { MAX_LAYERS, canEmbed, embeddedQuarterWave, insertMatchingLayer, insertReason, physicalLayerCount, layerEpsSigma, nkOf, quarterWaveMatch, type Layer, type InsertReason } from "./layers";
import type { SimState } from "./results";

export type MatchingReason = "arAdjacent" | "arRange" | "arEqual" | "arFull" | "arReadOnly" | "arFrontSkipped" | "arBackSkipped" | "arCoated" | "insertQuarterFit" | InsertReason;
/** A rejected edit is more informative than the passive capacity reminder. */
export const matchingFeedback = (reason: MatchingReason | null, full: boolean): MatchingReason | null =>
  reason ?? (full ? "arFull" : null);
export const isLiveMatching = (l: Layer | undefined) => l?.matchingDesign === "quarter-wave-live";
const isCoating = (l: Layer | undefined) => !!l && (!!l.matching || isLiveMatching(l));
export const referenceIndex = (l: Layer | undefined, freq: number) => {
  if (!l) return 1;
  const p = layerEpsSigma(l, freq);
  return nkOf(p.epsR, p.sigma, freq).n;
};

/** Immediate physical neighbours only; no coating chains or complex-impedance claim. */
export function matchingReference(layers: Layer[], index: number, freq: number) {
  const n1 = referenceIndex(layers[index - 1], freq);
  const n2 = referenceIndex(layers[index + 1], freq);
  return { n1, n2, z1: 376.730313668 / n1, z2: 376.730313668 / n2, design: quarterWaveMatch(n1, n2, freq) };
}

export function resolveMatching(sim: SimState): { sim: SimState; reason: MatchingReason | null } {
  let reason: MatchingReason | null = null;
  const layers = sim.layers.map((l, i) => {
    if (!isLiveMatching(l)) return l;
    if (isCoating(sim.layers[i - 1]) || isCoating(sim.layers[i + 1])) { reason = "arAdjacent"; return l; }
    const { design } = matchingReference(sim.layers, i, sim.freq);
    if (!design) { reason = "arRange"; return l; }
    if (l.mat === "custom" && l.matching && l.eps === design.eps && l.sigma === 0 && l.thickness === design.cm) return l;
    return { ...l, mat: "custom" as const, matching: true, eps: design.eps, sigma: 0, thickness: design.cm };
  });
  return { sim: layers.every((l, i) => l === sim.layers[i]) ? sim : { ...sim, layers }, reason };
}

/** One atomic interactive transition. Invalid edits preserve the entire previous state. */
export function transitionMatching(previous: SimState, candidate: SimState) {
  const invalidInsert = insertReason(candidate.layers);
  if (invalidInsert) return { sim: previous, reason: invalidInsert };
  for (const l of candidate.layers) {
    const old = previous.layers.find((p) => p.id === l.id);
    if (old && isLiveMatching(old) && ["mat", "eps", "sigma", "thickness", "customMode", "matching", "matchingDesign"].some((k) => old[k as keyof Layer] !== l[k as keyof Layer])) {
      return { sim: previous, reason: "arReadOnly" as MatchingReason };
    }
  }
  const resolved = resolveMatching(candidate);
  return resolved.reason ? { sim: previous, reason: resolved.reason } : resolved;
}

/** Add a fixed quarter-wave insert to the selected host, never replace the stack. */
export function insertInternalQuarterWave(sim: SimState) {
  const host = sim.layers[sim.sel];
  if (!host || !canEmbed(host)) return { sim, reason: "insertHost" as const };
  if (!host.embeddedInsert?.enabled && physicalLayerCount(sim.layers) + 2 > MAX_LAYERS) return { sim, reason: "arFull" as const };
  const eps = host.embeddedInsert?.eps ?? 2.25;
  const thickness = embeddedQuarterWave(Math.sqrt(eps), sim.freq, host.thickness);
  if (thickness === null) return { sim, reason: "insertQuarterFit" as const };
  const layers = sim.layers.map((layer, index) => index === sim.sel
    ? { ...layer, embeddedInsert: { enabled: true, eps, thickness } } : layer);
  return transitionMatching(sim, { ...sim, layers });
}

export function addMatching(sim: SimState, slot: number) {
  let reason: MatchingReason | null = null;
  if (physicalLayerCount(sim.layers) >= MAX_LAYERS) reason = "arFull";
  else if (!Number.isInteger(slot) || slot < 0 || slot > sim.layers.length) reason = "arRange";
  else if (isCoating(sim.layers[slot - 1]) || isCoating(sim.layers[slot])) reason = "arAdjacent";
  else if (Math.abs(referenceIndex(sim.layers[slot - 1], sim.freq) - referenceIndex(sim.layers[slot], sim.freq)) < 1e-6) reason = "arEqual";
  if (reason) return { sim, reason };
  const layers = insertMatchingLayer(sim.layers, slot, sim.freq);
  return layers ? transitionMatching(sim, { ...sim, layers, sel: slot }) : { sim, reason: "arRange" as MatchingReason };
}

/** Fill only missing outer faces. Capacity/design failures roll back both insertions. */
export function matchWall(sim: SimState) {
  if (!sim.layers.length) return { sim, reason: "arRange" as MatchingReason };
  const front = isCoating(sim.layers[0]), back = isCoating(sim.layers.at(-1));
  if (front && back) return { sim, reason: "arCoated" as MatchingReason };
  if (physicalLayerCount(sim.layers) + Number(!front) + Number(!back) > MAX_LAYERS) return { sim, reason: "arFull" as MatchingReason };
  let next = sim;
  for (const slot of [...(!front ? [0] : []), ...(!back ? [sim.layers.length + Number(!front)] : [])]) {
    const added = addMatching(next, slot);
    if (added.reason) return { sim, reason: added.reason };
    next = added.sim;
  }
  const result = transitionMatching(sim, { ...next, sel: 0 });
  return result.reason ? result : { sim: result.sim, reason: front ? "arFrontSkipped" as const : back ? "arBackSkipped" as const : null };
}

/** Fixed coatings change only on this explicit request; imported live coatings stay read-only. */
export function recalculateMatching(sim: SimState, index: number) {
  if (!Number.isInteger(index) || !isCoating(sim.layers[index])) return { sim, reason: "arRange" as MatchingReason };
  if (isLiveMatching(sim.layers[index])) return { sim, reason: "arReadOnly" as MatchingReason };
  if (isCoating(sim.layers[index - 1]) || isCoating(sim.layers[index + 1])) return { sim, reason: "arAdjacent" as MatchingReason };
  const { n1, n2, design } = matchingReference(sim.layers, index, sim.freq);
  if (Math.abs(n1 - n2) < 1e-6) return { sim, reason: "arEqual" as MatchingReason };
  if (!design) return { sim, reason: "arRange" as MatchingReason };
  const layers = sim.layers.map((l, i) => i === index ? { ...l, mat: "custom" as const, eps: design.eps, sigma: 0, thickness: design.cm } : l);
  return transitionMatching(sim, { ...sim, layers });
}

/** Trust-boundary fallback: invalid live metadata becomes a fixed snapshot, not a rejected import.
 * Determine offenders together before stripping, so adjacent live coats never depend on iteration order. */
export function importMatching(sim: SimState): SimState {
  const layers = sim.layers.map((l, i) => {
    if (!isLiveMatching(l)) return l;
    if (!isCoating(sim.layers[i - 1]) && !isCoating(sim.layers[i + 1]) && matchingReference(sim.layers, i, sim.freq).design) return l;
    const { matchingDesign: _design, ...fixed } = l;
    return fixed;
  });
  return resolveMatching({ ...sim, layers }).sim;
}
