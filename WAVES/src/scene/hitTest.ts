import { cssZoom } from "./canvas";
import type { Pt } from "./dragStack";

/* ════════════════════════════════════════════════════════════════════════
   Scene layout (geometry returned by the renderers) and hit testing
   ════════════════════════════════════════════════════════════════════════ */

export interface SceneLayout {
  rects: { x0: number; x1: number; y0: number; y1: number }[];
  polygons?: Pt[][];
  /** back-to-front draw order of `polygons` (spatial view) */
  order?: number[];
  tiles?: { x0: number; x1: number; y0: number; y1: number; index: number }[];
  /** Section view: x of the n + 1 layer boundaries and the minimum layer width */
  boundaries?: number[];
  minWidth?: number;
  /** Section view: incoming ray and its fixed wall-entry pivot. */
  incident?: { source: Pt; entry: Pt };
  /** Spatial view: screen position of each of the n + 1 boundaries (stack axis) */
  slots?: Pt[];
}

export function hitIncident(layout: SceneLayout, point: Pt, band: number): boolean {
  const ray = layout.incident;
  if (!ray || point.x >= ray.entry.x - 8) return false;
  const dx = ray.entry.x - ray.source.x, dy = ray.entry.y - ray.source.y;
  const length2 = dx * dx + dy * dy;
  if (!length2) return false;
  const t = Math.max(0, Math.min(1, ((point.x - ray.source.x) * dx + (point.y - ray.source.y) * dy) / length2));
  return Math.hypot(point.x - ray.source.x - t * dx, point.y - ray.source.y - t * dy) <= band;
}

export function incidentAngle(entry: Pt, point: Pt): number {
  return Math.max(0, Math.min(89, Math.round(Math.atan2(entry.y - point.y, Math.max(0, entry.x - point.x)) * 180 / Math.PI * 2) / 2));
}

/** Pointer position in layout px (client coordinates divided by the body zoom). */
export function pointOf(event: { clientX: number; clientY: number; currentTarget: Element }): Pt {
  const bounds = event.currentTarget.getBoundingClientRect();
  const z = cssZoom();
  return { x: (event.clientX - bounds.left) / z, y: (event.clientY - bounds.top) / z };
}

export interface LayerHit {
  /** layer index, −1 when nothing is under the pointer */
  index: number;
  /** true when the hit is a label tile above the wall (click only, not draggable) */
  tile: boolean;
}

function inPolygon(polygon: Pt[], point: Pt) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const left = polygon[current];
    const right = polygon[previous];
    if ((left.y > point.y) !== (right.y > point.y) && point.x < (right.x - left.x) * (point.y - left.y) / (right.y - left.y) + left.x) inside = !inside;
  }
  return inside;
}

/** Same rules as before the drag feature: tiles, then polygons (Spatial) or padded rects (Section). */
export function hitLayer(layout: SceneLayout, point: Pt): LayerHit {
  const tile = layout.tiles?.find(item => point.x >= item.x0 && point.x <= item.x1 && point.y >= item.y0 && point.y <= item.y1);
  if (tile) return { index: tile.index, tile: true };
  const polygons = layout.polygons;
  if (polygons) {
    // topmost first: walk the draw order backwards
    const order = layout.order ?? polygons.map((_, index) => index);
    for (let rank = order.length - 1; rank >= 0; rank--) {
      if (inPolygon(polygons[order[rank]], point)) return { index: order[rank], tile: false };
    }
    return { index: -1, tile: false };
  }
  return { index: layout.rects.findIndex(rect => point.x >= rect.x0 - 3 && point.x <= rect.x1 + 3 && point.y >= rect.y0 - 6 && point.y <= rect.y1 + 4), tile: false };
}

/** True when the point is inside the vertical extent of the wall (Section view). */
export function inWallBand(layout: SceneLayout, point: Pt): boolean {
  const r = layout.rects[0];
  return !!r && point.y >= r.y0 - 6 && point.y <= r.y1 + 4;
}
