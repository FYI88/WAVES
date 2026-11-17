import type { PhysicalLayer } from "./layers";

/** Main-wall inclusions belong to physical hosts, never air or ideal inserts/coatings. */
export const isInclusionHost = (layer: PhysicalLayer): boolean =>
  layer.mat !== "air" && !layer.matching && !layer.matchingDesign && layer.part !== "insert";
