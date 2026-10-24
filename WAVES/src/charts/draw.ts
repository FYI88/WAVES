import { clamp } from "../render/util";
import { MONO, withAlpha, type Palette } from "../theme";

/* ════════════════════════════════════════════════════════════════════════
   Chart renderers (shared canvas primitives)
   ════════════════════════════════════════════════════════════════════════ */

export const PAD = { l: 46, r: 16, t: 18, b: 34 };

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  pal: Palette,
  color: string,
  align: "left" | "center" | "right" = "center",
) {
  ctx.font = `600 11px ${MONO}`;
  const tw = ctx.measureText(text).width;
  const pw = tw + 16;
  const ph = 22;
  let px = x - pw / 2;
  if (align === "left") px = x;
  if (align === "right") px = x - pw;
  ctx.save();
  roundRect(ctx, px, y - ph / 2, pw, ph, 11);
  ctx.fillStyle = pal.label;
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, px + 8, y + 0.5);
  ctx.restore();
}

const hexRgb = (h: string) => {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mixHex = (a: string, b: string, t: number) => {
  const A = hexRgb(a);
  const B = hexRgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pal: Palette,
  xTicks: { v: number; label: string }[],
  yTicks: { v: number; label: string }[],
  xMap: (v: number) => number,
  yMap: (v: number) => number,
) {
  ctx.save();
  ctx.font = `500 10.5px ${MONO}`;
  ctx.fillStyle = pal.faint;
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const t of yTicks) {
    const y = Math.round(yMap(t.v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(w - PAD.r, y);
    ctx.stroke();
    ctx.fillText(t.label, PAD.l - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const t of xTicks) {
    const x = Math.round(xMap(t.v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, h - PAD.b);
    ctx.stroke();
    ctx.fillText(t.label, x, h - PAD.b + 9);
  }
  ctx.restore();
}

export function strokeCurve(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  ys: number[],
  color: string,
  width: number,
  pal: Palette,
  opts: { dash?: number[]; fillTo?: number; glow?: boolean; alpha?: number } = {},
) {
  if (xs.length < 2) return;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.fillTo !== undefined) {
    const minY = Math.min(...ys);
    const g = ctx.createLinearGradient(0, minY, 0, opts.fillTo);
    g.addColorStop(0, withAlpha(color, pal.dark ? 0.26 : 0.18));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(xs[0], opts.fillTo);
    for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.lineTo(xs[xs.length - 1], opts.fillTo);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (opts.dash) ctx.setLineDash(opts.dash);
  if (opts.glow) {
    ctx.shadowColor = withAlpha(color, 0.7);
    ctx.shadowBlur = pal.dark ? 4 : 0;
  }
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i]);
  ctx.stroke();
  ctx.restore();
}

export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, pal: Palette) {
  ctx.save();
  const rg = ctx.createRadialGradient(x, y, 0, x, y, 14);
  rg.addColorStop(0, withAlpha(color, 0.5));
  rg.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pal.dark ? "#0a0c16" : "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function tooltip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  lines: { text: string; color: string }[],
  pal: Palette,
) {
  ctx.save();
  ctx.font = `600 11px ${MONO}`;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l.text).width));
  const bw = tw + 22;
  const bh = lines.length * 17 + 12;
  let bx = x + 14;
  if (bx + bw > w - 8) bx = x - 14 - bw;
  const by = clamp(y - bh / 2, PAD.t, 9999);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 8;
  roundRect(ctx, bx, by, bw, bh, 10);
  ctx.fillStyle = pal.label;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = pal.labelBorder;
  ctx.stroke();
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(bx + 11, by + 14 + i * 17, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pal.ink;
    ctx.fillText(l.text, bx + 19, by + 14.5 + i * 17);
  });
  ctx.restore();
}
