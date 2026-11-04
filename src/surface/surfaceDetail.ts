import { DEG, type PolMode } from "../physics";
import { drawWaveRibbon } from "../render/waveRibbon";
import { MONO, SANS } from "../theme";
import { profileHeight, type ProfileParams, type ProfileSlice } from "./profiles";
import type { RcwaSweep } from "./rcwa";
import type { SweepAxis } from "./labState";
import type { DetailSegment } from "./detailPaths";

/* Detail cross-section of a profiled wall and its diffraction orders.
   Screen x = depth into the wall (z), screen y = along the period (x).
   The profile is drawn to scale; flat layers are compressed when thick. */

export interface LabPalette {
  dark: boolean;
  bg0: string;
  ink: string;
  muted: string;
  faint: string;
  inc: string;
  ref: string;
  tra: string;
  abs: string;
  grid: string;
}

export interface DetailOrder {
  m: number;
  angleDeg: number;
  /** NaN when only the direction is known (fast mode) */
  R: number;
  T: number;
}

export interface DetailParams {
  profile: ProfileParams;
  tint: string;
  materialName: string;
  below: { tint: string; cm: number; name: string }[];
  thetaDeg: number;
  frequency: number;
  pol: PolMode;
  /** resultant reflectance / transmittance (sum of all orders), drawn as the single R and T beams */
  R: number;
  T: number;
  /** diffracted orders drawn as extra beams; null (default): only the summed R and T */
  orders: DetailOrder[] | null;
  slices: ProfileSlice[] | null;
  bubbles: { fraction: number; water: boolean; diameterMm: number; target: number } | null;
  fog: number;
  lang: "fr" | "en";
  /** draw the local surface normals (outward, towards the air) */
  normals: boolean;
  /** order-0 path inside the wall (profile region, then each flat layer) */
  paths?: DetailSegment[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* Sweep chart axes: angle (linear, degrees) or frequency (log, GHz). */
export const SWEEP_ANGLE_MAX = 85;
export const SWEEP_F_MIN = 0.5;
export const SWEEP_F_MAX = 40;
/** horizontal plot margins of drawOrderSweep, in CSS px (pointer mapping uses them too) */
export const SWEEP_PAD = { l: 36, r: 12 };

/** position of a value along the sweep axis, 0 to 1 */
export const sweepFrac = (axis: SweepAxis, v: number) =>
  axis === "angle" ? v / SWEEP_ANGLE_MAX : Math.log(v / SWEEP_F_MIN) / Math.log(SWEEP_F_MAX / SWEEP_F_MIN);

/** inverse of sweepFrac */
export const sweepValue = (axis: SweepAxis, frac: number) =>
  axis === "angle" ? frac * SWEEP_ANGLE_MAX : SWEEP_F_MIN * Math.pow(SWEEP_F_MAX / SWEEP_F_MIN, frac);

const hexA = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
};

const shade = (hex: string, t: number) => {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  const target = t < 0 ? 0 : 255;
  const k = Math.abs(t);
  const c = [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * (1 - k) + target * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** distance along (dx, dy) from (x, y) to the canvas border, with a margin */
function rayLength(x: number, y: number, dx: number, dy: number, w: number, h: number, margin: number) {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (w - margin - x) / dx);
  if (dx < -1e-9) t = Math.min(t, (margin - x) / dx);
  if (dy > 1e-9) t = Math.min(t, (h - margin - y) / dy);
  if (dy < -1e-9) t = Math.min(t, (margin - y) / dy);
  return Math.max(0, t);
}

export function drawSurfaceDetail(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  p: DetailParams,
  pal: LabPalette,
  fmt: (v: number, d?: number) => string,
) {
  const fr = p.lang === "fr";
  const compact = w < 560;
  ctx.clearRect(0, 0, w, h);

  const top = 40;
  const bottom = h - 34;
  const span = bottom - top;
  const yc = (top + bottom) / 2;
  const prof = p.profile;
  const depth = Math.max(0, prof.depth);
  const faceX = Math.round(w * (compact ? 0.4 : 0.42));
  const periodsWanted = compact ? 3 : 4;
  const scale = clamp(Math.min(span / (periodsWanted * Math.max(prof.period, 1e-3)), (w * 0.2) / Math.max(depth, 0.05)), 1.5, 600);
  const periodPx = prof.period * scale;
  const depthPx = depth * scale;
  const baseX = faceX + depthPx;
  const avail = Math.max(30, w - baseX - (compact ? 80 : 130));
  const totalBelow = p.below.reduce((s, l) => s + l.cm, 0);
  const belowPx = p.below.map((l) => (totalBelow > 0 ? Math.max(8, Math.min(l.cm * scale, (avail * l.cm) / totalBelow)) : 0));
  const backX = baseX + belowPx.reduce((s, v) => s + v, 0);
  const height = profileHeight(prof);
  const y0 = yc - periodPx / 2;
  const surfaceX = (y: number) => {
    const u = (((y - y0) / periodPx) % 1 + 1) % 1;
    return faceX + depthPx * (1 - height(u));
  };

  /* grid */
  ctx.save();
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  for (let gx = (w / 2) % 28; gx < w; gx += 28) {
    ctx.beginPath();
    ctx.moveTo(Math.round(gx) + 0.5, top - 8);
    ctx.lineTo(Math.round(gx) + 0.5, bottom + 8);
    ctx.stroke();
  }
  ctx.restore();

  /* fog haze on the air sides */
  if (p.fog > 0) {
    const a = Math.min(0.3, 0.05 + p.fog * 0.5);
    ctx.save();
    for (const [x0, x1] of [[0, faceX], [backX, w]] as const) {
      if (x1 - x0 < 2) continue;
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, hexA(pal.muted, a * 0.6));
      g.addColorStop(0.5, hexA(pal.muted, a));
      g.addColorStop(1, hexA(pal.muted, a * 0.6));
      ctx.fillStyle = g;
      ctx.fillRect(x0, top - 10, x1 - x0, span + 20);
      for (let k = 0; k < 5; k++) {
        const cx0 = x0 + ((k * 0.23 + time * 0.015 * (k + 1)) % 1) * (x1 - x0);
        const cy0 = top + ((k * 0.37) % 1) * span;
        const r = 40 + k * 14;
        const blob = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, r);
        blob.addColorStop(0, hexA(pal.muted, a * 0.7));
        blob.addColorStop(1, hexA(pal.muted, 0));
        ctx.fillStyle = blob;
        ctx.fillRect(cx0 - r, cy0 - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }

  /* profiled region */
  const pts: { x: number; y: number }[] = [];
  for (let y = top; y <= bottom; y += 1) pts.push({ x: surfaceX(y), y });
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(baseX, top);
  pts.forEach((q) => ctx.lineTo(q.x, q.y));
  ctx.lineTo(baseX, bottom);
  ctx.closePath();
  const face = ctx.createLinearGradient(faceX, 0, baseX + 1, 0);
  face.addColorStop(0, shade(p.tint, 0.25));
  face.addColorStop(1, shade(p.tint, -0.25));
  ctx.fillStyle = face;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;
  // bevel: lit edge, then a dark contact line just inside
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.strokeStyle = pal.dark ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x + 1.5, q.y) : ctx.moveTo(q.x + 1.5, q.y)));
  ctx.strokeStyle = hexA(shade(p.tint, -0.6), 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  /* local normals: surface x = s(y), tangent (s′, 1), outward normal (−1, s′)/|…| */
  if (p.normals && prof.id !== "flat" && depthPx > 2) {
    const stepY = clamp(periodPx / 8, 9, 28);
    const len = compact ? 9 : 12;
    ctx.save();
    ctx.strokeStyle = hexA(pal.ink, 0.6);
    ctx.fillStyle = hexA(pal.ink, 0.6);
    ctx.lineWidth = 1;
    for (let y = top + stepY / 2; y < bottom; y += stepY) {
      const sx = surfaceX(y);
      const slope = (surfaceX(y + 0.75) - surfaceX(y - 0.75)) / 1.5;
      // skip the vertical jumps of créneaux / dents de scie / marches
      if (!Number.isFinite(slope) || Math.abs(slope) > 40) continue;
      const n = Math.hypot(1, slope);
      const nx = -1 / n;
      const ny = slope / n;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx + nx * len, y + ny * len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* flat layers */
  let x = baseX;
  p.below.forEach((layer, i) => {
    const lw = belowPx[i];
    const g = ctx.createLinearGradient(x, 0, x + lw, 0);
    g.addColorStop(0, shade(layer.tint, 0.15));
    g.addColorStop(1, shade(layer.tint, -0.3));
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, top, lw, span);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.dark ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.8)";
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, bottom);
    ctx.stroke();
    if (lw < layer.cm * scale - 1) {
      // compressed layer: draw a break mark
      ctx.strokeStyle = hexA(pal.ink, 0.5);
      ctx.beginPath();
      ctx.moveTo(x + lw / 2 - 4, yc - 6);
      ctx.lineTo(x + lw / 2 + 4, yc - 2);
      ctx.moveTo(x + lw / 2 - 4, yc + 2);
      ctx.lineTo(x + lw / 2 + 4, yc + 6);
      ctx.stroke();
    }
    ctx.fillStyle = pal.faint;
    ctx.font = `500 ${compact ? 8.5 : 9.5}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.fillText(`${fmt(layer.cm, layer.cm < 10 ? 1 : 0)}`, x + lw / 2, bottom + 14);
    x += lw;
  });

  /* bubbles */
  if (p.bubbles && p.bubbles.fraction > 0) {
    const b = p.bubbles;
    const rand = seeded(17 + b.target * 31);
    const r = clamp(((b.diameterMm / 10) * scale) / 2, 1.2, 14);
    const regionX0 = b.target < 0 ? faceX : baseX + belowPx.slice(0, b.target).reduce((s, v) => s + v, 0);
    const regionX1 = b.target < 0 ? baseX : regionX0 + (belowPx[b.target] ?? 0);
    const area = Math.max(0, regionX1 - regionX0) * span;
    const count = Math.min(500, Math.round((b.fraction * area) / (Math.PI * r * r)));
    ctx.save();
    for (let k = 0, tries = 0; k < count && tries < count * 4; tries++) {
      const bx = regionX0 + r + rand() * Math.max(0, regionX1 - regionX0 - 2 * r);
      const by = top + r + rand() * (span - 2 * r);
      if (b.target < 0 && bx - r < surfaceX(by)) continue;
      k++;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = b.water ? "rgba(70,160,255,.55)" : pal.dark ? "rgba(10,20,32,.55)" : "rgba(255,255,255,.7)";
      ctx.fill();
      ctx.strokeStyle = b.water ? "rgba(170,215,255,.7)" : "rgba(255,255,255,.45)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* slices */
  if (p.slices && p.slices.length > 1) {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = hexA(pal.inc, 0.55);
    let acc = 0;
    p.slices.forEach((s) => {
      acc += s.cm;
      const sx = faceX + acc * scale;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, top);
      ctx.lineTo(sx + 0.5, bottom);
      ctx.stroke();
    });
    ctx.restore();
  }

  /* dimensions: Λ and h */
  ctx.save();
  ctx.strokeStyle = hexA(pal.ink, 0.6);
  ctx.fillStyle = pal.muted;
  ctx.lineWidth = 1;
  ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
  if (periodPx > 10) {
    const dx = faceX - 16;
    ctx.beginPath();
    ctx.moveTo(dx, y0);
    ctx.lineTo(dx, y0 + periodPx);
    ctx.moveTo(dx - 4, y0);
    ctx.lineTo(dx + 4, y0);
    ctx.moveTo(dx - 4, y0 + periodPx);
    ctx.lineTo(dx + 4, y0 + periodPx);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(`Λ ${fmt(prof.period, 2)} cm`, dx - 6, y0 + 10);
  }
  if (depthPx > 6) {
    const dy = top - 10;
    ctx.beginPath();
    ctx.moveTo(faceX, dy);
    ctx.lineTo(baseX, dy);
    ctx.moveTo(faceX, dy - 4);
    ctx.lineTo(faceX, dy + 4);
    ctx.moveTo(baseX, dy - 4);
    ctx.lineTo(baseX, dy + 4);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(`h ${fmt(depth, 2)} cm`, (faceX + baseX) / 2, dy - 6);
  }
  ctx.restore();

  /* beams */
  const theta = p.thetaDeg * DEG;
  const hit = { x: faceX, y: yc };
  const beam = (x0: number, y0b: number, dx: number, dy: number, color: string, power: number | null, len: number, label?: string) => {
    if (len < 4) return;
    const x1 = x0 + dx * len;
    const y1 = y0b + dy * len;
    ctx.save();
    drawWaveRibbon(ctx, { x: x0, y: y0b }, { x: x1, y: y1 }, color, power, power, 1, 0, {
      time, frequency: p.frequency, compact, dark: pal.dark, display: "both", pol: p.pol,
    });
    if (label) {
      ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
      ctx.textAlign = dx < 0 ? "left" : "right";
      ctx.textBaseline = "middle";
      const tx = clamp(x1 + (dx < 0 ? 4 : -4), 4, w - 4);
      const ty = clamp(y1 + (dy >= 0 ? -10 : 10), 12, h - 8);
      ctx.fillStyle = pal.dark ? "rgba(8,14,24,.85)" : "rgba(255,255,255,.9)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(dx < 0 ? tx - 2 : tx - tw - 2, ty - 7, tw + 4, 14);
      // pastel wave colours are too light for text on a light background
      ctx.fillStyle = pal.dark ? color : shade(color, -0.4);
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  };

  // normal and incidence angle
  ctx.save();
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = hexA(pal.muted, 0.6);
  ctx.beginPath();
  ctx.moveTo(faceX - (compact ? 60 : 90), yc);
  ctx.lineTo(faceX + 10, yc);
  ctx.stroke();
  ctx.restore();

  const inLen = Math.min(rayLength(hit.x, hit.y, -Math.cos(theta), -Math.sin(theta), w, h, 14), faceX - 14);
  beam(hit.x - Math.cos(theta) * inLen, hit.y - Math.sin(theta) * inLen, Math.cos(theta), Math.sin(theta), pal.inc, 1, inLen);
  if (p.thetaDeg >= 3) {
    ctx.save();
    ctx.strokeStyle = hexA(pal.inc, 0.8);
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, 34, Math.PI, Math.PI + theta);
    ctx.stroke();
    ctx.fillStyle = pal.dark ? pal.inc : shade(pal.inc, -0.4);
    ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(`θ ${fmt(p.thetaDeg, 1)}°`, hit.x - 38, hit.y - 6);
    ctx.restore();
  }

  /* order 0 inside the wall: refraction per segment and a partial reflection at
     each interface behind the front face (profile base, layer boundaries, back face).
     These stay inside the wall: their share of the power is already in the
     resultant R and T beams drawn below. */
  let exitY = yc;
  const segs = p.paths ?? [];
  if (segs.length) {
    const style = { time, frequency: p.frequency, compact, dark: pal.dark, display: "both" as const, pol: p.pol };
    let cur = baseX;
    const spans = segs.map((s) => {
      if (s.kind === "profile") return [faceX, baseX] as const;
      const x0 = cur;
      cur = x0 + (belowPx[s.index] ?? 0);
      return [x0, cur] as const;
    });
    const drops = spans.map(([x0, x1], i) => (x1 - x0) * Math.tan(Math.min(80, segs[i].thetaDeg) * DEG));
    const total = drops.reduce((s, d) => s + d, 0);
    const factor = Math.min(1, ((bottom - yc - 24) * 0.45) / Math.max(1, total));
    const ys = [yc];
    drops.forEach((d) => ys.push(ys[ys.length - 1] + d * factor));
    let phase = 0;
    segs.forEach((s, i) => {
      const [x0, x1] = spans[i];
      if (x1 - x0 < 1) return;
      const start = { x: x0, y: ys[i] };
      const end = { x: x1, y: ys[i + 1] };
      ctx.save();
      phase = drawWaveRibbon(ctx, start, end, pal.inc, s.fluxIn, s.fluxOut, s.n, phase, style);
      ctx.restore();
      if (s.back > 1e-5) {
        const back = { x: x0, y: Math.min(bottom - 6, end.y + Math.max(15, end.y - start.y)) };
        ctx.save();
        drawWaveRibbon(ctx, end, back, pal.ref, s.back, s.back, s.n, phase + Math.PI, style, 0.55);
        ctx.restore();
      }
    });
    exitY = ys[ys.length - 1];
  }

  // one reflected and one transmitted beam: the resultant R and T
  // (sum of all orders, every internal reflection and absorption included)
  const pct = (e: number) => `${fmt(e * 100, e < 0.1 ? 2 : 1)} %`;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rLen = Math.min(rayLength(hit.x, hit.y, -cos, sin, w, h, 14), faceX - 14) * 0.92;
  beam(hit.x, hit.y, -cos, sin, pal.ref, p.R, rLen, `R · ${pct(p.R)}`);
  beam(backX, exitY, cos, sin, pal.tra, p.T, rayLength(backX, exitY, cos, sin, w, h, 14) * 0.9, `T · ${pct(p.T)}`);

  // optional: the diffracted orders as extra beams (m = 0 is the specular direction of R and T)
  const orderPct = (e: number) => (Number.isFinite(e) ? ` · ${fmt(e * 100, e < 0.1 ? 1 : 0)}%` : fr ? " · schém." : " · schematic");
  for (const o of p.orders ?? []) {
    if (o.m === 0) continue;
    const a = o.angleDeg * DEG;
    const tag = `${o.m > 0 ? "+" : ""}${o.m}`;
    if (!(o.R <= 1e-4)) {
      const dx = -Math.cos(a);
      const dy = Math.sin(a);
      const len = Math.min(rayLength(hit.x, hit.y, dx, dy, w, h, 14), faceX - 14) * 0.92;
      beam(hit.x, hit.y, dx, dy, pal.ref, Number.isFinite(o.R) ? o.R : null, len, `${tag}${orderPct(o.R)}`);
    }
    if (!(o.T <= 1e-4)) {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const len = rayLength(backX, exitY, dx, dy, w, h, 14) * 0.9;
      beam(backX, exitY, dx, dy, pal.tra, Number.isFinite(o.T) ? o.T : null, len, `${tag}${orderPct(o.T)}`);
    }
  }

  /* titles */
  ctx.save();
  ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fr ? "COUPE DÉTAILLÉE · PROFIL" : "DETAIL SECTION · PROFILE", 14, 16);
  ctx.textAlign = "right";
  ctx.fillStyle = pal.faint;
  ctx.fillText(p.materialName.toUpperCase(), w - 14, 16);
  ctx.font = `500 ${compact ? 8 : 9}px ${SANS}`;
  ctx.textAlign = "left";
  ctx.fillText(
    fr ? "Profil à l’échelle · couches planes comprimées · épaisseurs en cm" : "Profile to scale · flat layers compressed · thickness in cm",
    14,
    h - 10,
  );
  if (segs.length && !compact) {
    ctx.fillText(
      fr ? "réflexions partielles : illustratif" : "partial reflections: illustrative",
      14,
      29,
    );
  }
  ctx.restore();
}

export function drawOrderSweep(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sweep: RcwaSweep | null,
  axis: SweepAxis,
  cursor: number,
  pal: LabPalette,
  lang: "fr" | "en",
  fmt: (v: number, d?: number) => string,
) {
  const fr = lang === "fr";
  ctx.clearRect(0, 0, w, h);
  const L = SWEEP_PAD.l;
  const R = SWEEP_PAD.r;
  const T = 14;
  const B = 22;
  const X = (v: number) => L + (w - L - R) * clamp(sweepFrac(axis, v), 0, 1);
  const Y = (v: number) => T + (h - T - B) * (1 - clamp(v, 0, 1));
  const ticks =
    axis === "angle"
      ? [0, 15, 30, 45, 60, 75].map((a) => ({ v: a, label: `${a}°` }))
      : [0.5, 1, 2, 5, 10, 20, 40].map((f) => ({ v: f, label: fmt(f, f < 1 ? 1 : 0) }));
  ctx.save();
  ctx.strokeStyle = pal.grid;
  ctx.fillStyle = pal.faint;
  ctx.font = `500 9px ${MONO}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= 1.0001; v += 0.25) {
    ctx.beginPath();
    ctx.moveTo(L, Y(v) + 0.5);
    ctx.lineTo(w - R, Y(v) + 0.5);
    ctx.stroke();
    ctx.fillText(`${fmt(v * 100, 0)}%`, L - 4, Y(v));
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tk of ticks) {
    if (axis === "freq") {
      ctx.beginPath();
      ctx.moveTo(Math.round(X(tk.v)) + 0.5, T);
      ctx.lineTo(Math.round(X(tk.v)) + 0.5, h - B);
      ctx.stroke();
    }
    ctx.fillText(tk.label, X(tk.v), h - B + 6);
  }
  if (axis === "freq") {
    ctx.textAlign = "right";
    ctx.fillText("GHz", w - R, T - 12);
  }
  ctx.restore();
  if (!sweep || sweep.x.length < 2) {
    ctx.fillStyle = pal.muted;
    ctx.font = `500 11px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fr ? "Calcul RCWA en cours…" : "RCWA sweep running…", w / 2, h / 2);
    return;
  }
  const line = (ys: number[], color: string, width: number, dashed = false) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    sweep.x.forEach((a, i) => (i ? ctx.lineTo(X(a), Y(ys[i])) : ctx.moveTo(X(a), Y(ys[i]))));
    ctx.stroke();
    ctx.restore();
  };
  // resultant R and T (sum of all orders), so R + T + A = 1 at every point
  line(sweep.A, hexA(pal.abs, 0.9), 1.2, true);
  line(sweep.R, pal.ref, 2);
  line(sweep.T, pal.tra, 2);
  ctx.save();
  ctx.strokeStyle = hexA(pal.ink, 0.5);
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(X(cursor) + 0.5, T);
  ctx.lineTo(X(cursor) + 0.5, h - B);
  ctx.stroke();
  ctx.restore();
}
