import { MONO, rgba, tintOf } from "../render/util";
import type { Palette } from "../theme";
import type { SceneLayout } from "./hitTest";
import type { SceneLayer } from "./RayScene";

/* ════════════════════════════════════════════════════════════════════════
   Drag affordances, painted on top of the scene by RayScene only while a
   boundary is hovered or a drag is in progress (nothing is drawn otherwise):
   drop indicator, lifted ghost of the dragged layer, thickness tooltip and
   the highlight of the hovered boundary. Colours: the canvas palette only.
   ════════════════════════════════════════════════════════════════════════ */

export interface DragUi {
  kind: "reorder" | "resize";
  /** layer being moved / resized */
  index: number;
  /** reorder: insertion slot 0…n (before layer `slot`) */
  slot: number;
  /** pointer travel since the drag started, layout px */
  dx: number;
  dy: number;
}

type Ctx = CanvasRenderingContext2D;

function pill(ctx: Ctx, pal: Palette, text: string, cx: number, cy: number, width: number, color: string) {
  ctx.save();
  ctx.font = `600 11px ${MONO}`;
  const w = ctx.measureText(text).width + 18;
  const h = 22;
  const x = Math.min(width - w - 6, Math.max(6, cx - w / 2));
  const y = Math.max(h / 2 + 4, cy);
  ctx.shadowColor = pal.dark ? "rgba(0,0,0,.5)" : "rgba(30,60,80,.2)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.roundRect(x, y - h / 2, w, h, h / 2);
  ctx.fillStyle = pal.label;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = rgba(color, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = pal.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + 0.5);
  ctx.restore();
}

function edgeLine(ctx: Ctx, pal: Palette, x: number, y0: number, y1: number, strong: boolean) {
  ctx.save();
  ctx.strokeStyle = rgba(pal.inc, strong ? 0.95 : 0.8);
  ctx.lineWidth = strong ? 2.4 : 2;
  ctx.shadowColor = pal.inc;
  ctx.shadowBlur = pal.dark ? 10 : 4;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // grip: a small pill in the middle of the boundary
  const mid = (y0 + y1) / 2;
  ctx.beginPath();
  ctx.roundRect(x - 4, mid - 14, 8, 28, 4);
  ctx.fillStyle = pal.label;
  ctx.fill();
  ctx.strokeStyle = rgba(pal.inc, 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 1, mid - 6);
  ctx.lineTo(x - 1, mid + 6);
  ctx.moveTo(x + 1.5, mid - 6);
  ctx.lineTo(x + 1.5, mid + 6);
  ctx.strokeStyle = rgba(pal.inc, 0.8);
  ctx.stroke();
  ctx.restore();
}

function dropMark(ctx: Ctx, pal: Palette, x: number, y0: number, y1: number, noop: boolean) {
  ctx.save();
  ctx.strokeStyle = rgba(pal.inc, noop ? 0.4 : 1);
  ctx.fillStyle = rgba(pal.inc, noop ? 0.4 : 1);
  ctx.lineWidth = noop ? 1.5 : 3;
  if (noop) ctx.setLineDash([4, 4]);
  else {
    ctx.shadowColor = pal.inc;
    ctx.shadowBlur = pal.dark ? 12 : 5;
  }
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!noop) {
    for (const [y, dir] of [[y0, 1], [y1, -1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x - 6, y - dir * 8);
      ctx.lineTo(x + 6, y - dir * 8);
      ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawDragOverlay(
  ctx: Ctx,
  view: "wave" | "spatial",
  layout: SceneLayout,
  ui: DragUi | null,
  edge: number,
  layers: SceneLayer[],
  pal: Palette,
  fmtNum: (v: number, d?: number) => string,
  width: number,
) {
  const rects = layout.rects;
  if (!rects.length) return;

  /* ── Section view ─────────────────────────────────────────────── */
  if (view === "wave") {
    const bd = layout.boundaries;
    if (!bd) return;
    const y0 = rects[0].y0;
    const y1 = rects[0].y1;
    const edgeIndex = ui?.kind === "resize" ? ui.index + 1 : edge;
    if (edgeIndex > 0 && edgeIndex < bd.length) edgeLine(ctx, pal, bd[edgeIndex], y0, y1, ui?.kind === "resize");
    if (ui?.kind === "resize") {
      const layer = layers[ui.index];
      if (layer) pill(ctx, pal, `${fmtNum(layer.cm, layer.cm < 10 ? 2 : 1)} cm`, bd[edgeIndex], y0 - 24, width, pal.inc);
      return;
    }
    if (ui?.kind === "reorder") {
      const r = rects[ui.index];
      const layer = layers[ui.index];
      if (!r || !layer) return;
      const noop = ui.slot === ui.index || ui.slot === ui.index + 1;
      // the layer left behind is dimmed, a lifted copy follows the pointer
      ctx.save();
      ctx.fillStyle = rgba(pal.bg0, 0.6);
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
      dropMark(ctx, pal, bd[ui.slot], y0 - 8, y1 + 8, noop);
      const tint = tintOf(layer.mat);
      ctx.save();
      ctx.shadowColor = pal.dark ? "rgba(0,0,0,.6)" : "rgba(30,60,80,.35)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 8;
      ctx.beginPath();
      ctx.roundRect(r.x0 + ui.dx, r.y0 - 6, r.x1 - r.x0, r.y1 - r.y0, 3);
      ctx.fillStyle = rgba(tint, 0.62);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = rgba(pal.inc, 0.95);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
      const label = `${ui.index + 1} · ${layer.name}`;
      pill(ctx, pal, label, (r.x0 + r.x1) / 2 + ui.dx, y0 - 30, width, pal.inc);
    }
    return;
  }

  /* ── Spatial view ─────────────────────────────────────────────── */
  if (ui?.kind !== "reorder" || !layout.polygons || !layout.slots) return;
  const polygon = layout.polygons[ui.index];
  const layer = layers[ui.index];
  const r = rects[ui.index];
  if (!polygon || !layer || !r) return;
  const trace = (dx: number, dy: number) => {
    ctx.beginPath();
    polygon.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
    ctx.closePath();
  };
  ctx.save();
  trace(0, 0);
  ctx.fillStyle = rgba(pal.bg0, 0.55);
  ctx.fill();
  ctx.restore();
  const noop = ui.slot === ui.index || ui.slot === ui.index + 1;
  const at = layout.slots[ui.slot];
  const half = Math.max(30, (r.y1 - r.y0) / 2 + 8);
  dropMark(ctx, pal, at.x, at.y - half, at.y + half, noop);
  ctx.save();
  ctx.shadowColor = pal.dark ? "rgba(0,0,0,.6)" : "rgba(30,60,80,.35)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;
  trace(ui.dx, ui.dy - 6);
  ctx.fillStyle = rgba(tintOf(layer.mat), 0.55);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = rgba(pal.inc, 0.95);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
  pill(ctx, pal, `${ui.index + 1} · ${layer.name}`, (r.x0 + r.x1) / 2 + ui.dx, r.y0 + ui.dy - 22, width, pal.inc);
}
