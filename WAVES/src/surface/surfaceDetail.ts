import { DEG } from "../physics";
import { MONO, SANS } from "../theme";
import { profileHeight, type ProfileParams, type ProfileSlice } from "./profiles";
import type { RcwaSweep } from "./rcwa";

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
  orders: DetailOrder[];
  rigorous: boolean;
  slices: ProfileSlice[] | null;
  bubbles: { fraction: number; water: boolean; diameterMm: number; target: number } | null;
  fog: number;
  lang: "fr" | "en";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  const dash = [10, 7];
  const beam = (x0: number, y0b: number, dx: number, dy: number, color: string, width: number, alpha: number, len: number, label?: string) => {
    if (len < 4) return;
    const x1 = x0 + dx * len;
    const y1 = y0b + dy * len;
    ctx.save();
    ctx.strokeStyle = hexA(color, alpha * 0.25);
    ctx.lineWidth = width * 3.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0b);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -time * 40;
    ctx.strokeStyle = hexA(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0b);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    const ah = 6 + width;
    const ang = Math.atan2(dy, dx);
    ctx.fillStyle = hexA(color, alpha);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ah * Math.cos(ang - 0.4), y1 - ah * Math.sin(ang - 0.4));
    ctx.lineTo(x1 - ah * Math.cos(ang + 0.4), y1 - ah * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
      ctx.textAlign = dx < 0 ? "left" : "right";
      ctx.textBaseline = "middle";
      const tx = clamp(x1 + (dx < 0 ? 4 : -4), 4, w - 4);
      const ty = clamp(y1 + (dy >= 0 ? -10 : 10), 12, h - 8);
      ctx.fillStyle = pal.dark ? "rgba(8,14,24,.85)" : "rgba(255,255,255,.9)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(dx < 0 ? tx - 2 : tx - tw - 2, ty - 7, tw + 4, 14);
      ctx.fillStyle = color;
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
  beam(hit.x - Math.cos(theta) * inLen, hit.y - Math.sin(theta) * inLen, Math.cos(theta), Math.sin(theta), pal.inc, 2.6, 1, inLen);
  if (p.thetaDeg >= 3) {
    ctx.save();
    ctx.strokeStyle = hexA(pal.inc, 0.8);
    ctx.beginPath();
    ctx.arc(hit.x, hit.y, 34, Math.PI, Math.PI + theta);
    ctx.stroke();
    ctx.fillStyle = pal.inc;
    ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(`θ ${fmt(p.thetaDeg, 1)}°`, hit.x - 38, hit.y - 6);
    ctx.restore();
  }

  const weight = (e: number) => (Number.isFinite(e) ? { width: 1 + 6 * Math.sqrt(e), alpha: 0.25 + 0.75 * Math.sqrt(e) } : { width: 1.4, alpha: 0.55 });
  const pct = (e: number) => (Number.isFinite(e) ? ` · ${fmt(e * 100, e < 0.1 ? 1 : 0)}%` : "");
  for (const o of p.orders) {
    const a = o.angleDeg * DEG;
    if (!p.rigorous || o.R > 1e-4) {
      const dx = -Math.cos(a);
      const dy = Math.sin(a);
      const len = Math.min(rayLength(hit.x, hit.y, dx, dy, w, h, 14), faceX - 14) * 0.92;
      const { width, alpha } = weight(p.rigorous ? o.R : NaN);
      beam(hit.x, hit.y, dx, dy, pal.ref, width, alpha, len, `${o.m > 0 ? "+" : ""}${o.m}${pct(p.rigorous ? o.R : NaN)}`);
    }
    if (!p.rigorous || o.T > 1e-4) {
      if (p.rigorous && !(o.T > 1e-4)) continue;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const len = rayLength(backX, yc, dx, dy, w, h, 14) * 0.9;
      const { width, alpha } = weight(p.rigorous ? o.T : NaN);
      beam(backX, yc, dx, dy, pal.tra, width, alpha, len, `${o.m > 0 ? "+" : ""}${o.m}${pct(p.rigorous ? o.T : NaN)}`);
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
  if (!p.rigorous) {
    ctx.textAlign = "right";
    ctx.fillText(fr ? "directions seules (mode rapide)" : "directions only (fast mode)", w - 14, h - 10);
  }
  ctx.restore();
}

export function drawOrderSweep(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sweep: RcwaSweep | null,
  angle: number,
  pal: LabPalette,
  lang: "fr" | "en",
  fmt: (v: number, d?: number) => string,
) {
  const fr = lang === "fr";
  ctx.clearRect(0, 0, w, h);
  const L = 36;
  const R = 12;
  const T = 14;
  const B = 22;
  const xMax = 85;
  const X = (a: number) => L + ((w - L - R) * a) / xMax;
  const Y = (v: number) => T + (h - T - B) * (1 - clamp(v, 0, 1));
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
  for (let a = 0; a <= xMax; a += 15) ctx.fillText(`${a}°`, X(a), h - B + 6);
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
  Object.entries(sweep.orderR).forEach(([m, ys]) => {
    if (Number(m) !== 0 && ys.some((v) => v > 0.005)) line(ys, hexA(pal.inc, 0.85), 1.2, true);
  });
  line(sweep.A, hexA(pal.abs, 0.9), 1.2, true);
  line(sweep.R0, pal.ref, 2);
  line(sweep.T0, pal.tra, 2);
  ctx.save();
  ctx.strokeStyle = hexA(pal.ink, 0.5);
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(X(clamp(angle, 0, xMax)) + 0.5, T);
  ctx.lineTo(X(clamp(angle, 0, xMax)) + 0.5, h - B);
  ctx.stroke();
  ctx.restore();
}
