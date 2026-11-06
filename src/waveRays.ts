import { solveStack, abs2, type Cx, type MaterialId, type PolMode } from "./physics";
import { drawMaterialSurface } from "./materialSurfaces";
import { TAU, DEG, MONO, SANS, clamp, rgba, mix, tintOf } from "./render/util";
import { profileHeight } from "./surface/profiles";
import { drawWaveRibbon } from "./render/waveRibbon";
import type { SceneSurface } from "./surface/sceneOverlay";
import { sectionGeometry } from "./scene/sectionGeometry";

interface Point { x: number; y: number }
interface Layer { mat: MaterialId | "air"; cm: number; thetaT: number; nRe: number; fluxIn: number; fluxOut: number; absorbed?: number; name: string; insert?: boolean }
interface Parameters { layers: Layer[]; etas: Cx[]; ds: number[]; theta: number; freq: number; pol: PolMode; R: number; T: number; sel: number; hover: number; surface?: SceneSurface }
interface Palette { dark: boolean; ink: string; muted: string; faint: string; inc: string; ref: string; tra: string; abs?: string; grid: string }
export interface RayOptions { display: "field" | "fronts" | "both"; reflections: boolean; annotations: boolean; lang: "fr" | "en" }

export function drawWaveRays(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  params: Parameters,
  palette: Palette,
  format: (value: number, decimals?: number) => string,
  options: RayOptions,
) {
  const { compact, gap, columns, rows, tileY, tileH, tileWidth, tileStart, top, bottom, total, minWidth, stackWidth, bx } = sectionGeometry(width, height, params.layers.map(layer => layer.cm));
  const french = options.lang === "fr";
  const dark = palette.dark;
  const absColor = palette.abs ?? (dark ? "#edc17f" : "#8d5b13");
  const count = params.layers.length;

  /* ── Geometry ─────────────────────────────────────────────────────── */
  const middle = top + (bottom - top) * 0.4;
  const left = bx[0];
  const right = bx[count];
  const depth = { x: compact ? 7 : 12, y: compact ? -5 : -8 };
  const theta = params.theta * DEG;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const margin = compact ? 36 : 70;
  const entry = { x: left, y: middle };
  const drops = params.layers.map((layer, index) => (bx[index + 1] - bx[index]) * Math.tan(Math.min(85, layer.thetaT) * DEG));
  const dropTotal = drops.reduce((sum, drop) => sum + drop, 0);
  const factor = Math.min(1, (bottom - middle) * 0.36 / Math.max(1, dropTotal));
  const ys = [middle];
  drops.forEach(drop => ys.push(ys[ys.length - 1] + drop * factor));
  const exit = { x: right, y: ys[count] };
  const inLength = Math.max(16, Math.min((left - margin) / Math.max(cos, 1e-4), (middle - top - 24) / Math.max(sin, 1e-4)));
  const outLength = Math.max(16, Math.min((width - margin - right) / Math.max(cos, 1e-4), (bottom - exit.y - 16) / Math.max(sin, 1e-4)));
  const source = { x: left - inLength * cos, y: middle - inLength * sin };
  const receiver = { x: right + outLength * cos, y: exit.y + outLength * sin };
  const refOffset = params.theta < 8 ? (compact ? 40 : 54) : 0;
  const refStart = { x: left, y: middle + refOffset };
  const refLength = Math.max(16, Math.min((left - margin) / Math.max(cos, 1e-4), (bottom - refStart.y - 16) / Math.max(sin, 1e-4)));
  const refEnd = { x: left - refLength * cos, y: refStart.y + refLength * sin };
  const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const tiles: { x0: number; x1: number; y0: number; y1: number; index: number }[] = [];

  /* ── Helpers ──────────────────────────────────────────────────────── */
  const path = (points: Point[], close = false) => {
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    if (close) ctx.closePath();
  };
  const glow = (x: number, y: number, radius: number, color: string, opacity: number) => {
    if (opacity <= 0.003 || radius <= 0) return;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(color, opacity));
    gradient.addColorStop(0.35, rgba(color, opacity * 0.35));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  const metal = (y0: number, y1: number) => {
    const gradient = ctx.createLinearGradient(0, y0, 0, y1);
    gradient.addColorStop(0, dark ? "#8ea6b8" : "#ffffff");
    gradient.addColorStop(0.45, dark ? "#2c4152" : "#c3d3de");
    gradient.addColorStop(1, dark ? "#0b141d" : "#7c95a6");
    return gradient;
  };
  const pill = (text: string, at: Point, color: string, sub?: string) => {
    ctx.save();
    const size = compact ? 11.5 : 11;
    ctx.font = `600 ${size}px ${MONO}`;
    const textWidth = ctx.measureText(text).width;
    ctx.font = `500 ${size}px ${MONO}`;
    const subWidth = sub ? ctx.measureText(sub).width + 8 : 0;
    const w = textWidth + subWidth + 32;
    const h = 26;
    const x = clamp(at.x - w / 2, 8, width - w - 8);
    const y = clamp(at.y, h / 2 + 4, height - h / 2 - 4);
    ctx.shadowColor = dark ? "rgba(0,0,0,.5)" : "rgba(30,60,80,.16)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 5;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, w, h, h / 2);
    ctx.fillStyle = dark ? "rgba(8,14,24,.88)" : "rgba(255,255,255,.94)";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = rgba(color, dark ? 0.42 : 0.32);
    ctx.lineWidth = 1;
    ctx.stroke();
    glow(x + 13, y, 10, color, dark ? 0.55 : 0.22);
    ctx.beginPath();
    ctx.arc(x + 13, y, 3.2, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `600 ${size}px ${MONO}`;
    ctx.fillStyle = dark ? palette.ink : mix(color, "#000000", 0.2);
    ctx.fillText(text, x + 22, y + 0.5);
    if (sub) {
      ctx.font = `500 ${size}px ${MONO}`;
      ctx.fillStyle = color;
      ctx.fillText(sub, x + 22 + textWidth + 8, y + 0.5);
    }
    ctx.restore();
  };

  /* ── Backdrop: flat, the stage colour is painted by .om-scene in CSS ── */
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  const gridStep = compact ? 22 : 28;
  const horizontal = ctx.createLinearGradient(16, 0, width - 16, 0);
  horizontal.addColorStop(0, rgba(palette.muted, 0));
  horizontal.addColorStop(0.5, rgba(palette.muted, dark ? 0.08 : 0.1));
  horizontal.addColorStop(1, rgba(palette.muted, 0));
  ctx.strokeStyle = horizontal;
  ctx.lineWidth = 1;
  for (let gy = top + ((middle - top) % gridStep); gy <= bottom + 8; gy += gridStep) path([{ x: 16, y: Math.round(gy) + 0.5 }, { x: width - 16, y: Math.round(gy) + 0.5 }]), ctx.stroke();
  for (let gx = (width / 2) % gridStep; gx < width; gx += gridStep) {
    const fade = 1 - Math.abs(gx - width / 2) / (width * 0.56);
    if (fade <= 0) continue;
    ctx.strokeStyle = rgba(palette.muted, (dark ? 0.06 : 0.075) * fade);
    path([{ x: Math.round(gx) + 0.5, y: top - 6 }, { x: Math.round(gx) + 0.5, y: bottom + 8 }]);
    ctx.stroke();
  }
  ctx.restore();

  /* ── Title row ────────────────────────────────────────────────────── */
  if (!compact) {
  const titleY = 82;
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = `600 ${compact ? 9 : 10}px ${MONO}`;
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "left";
  ctx.fillText(compact ? (french ? "COUPE" : "SECTION") : (french ? "PROPAGATION · VUE EN COUPE" : "PROPAGATION · CROSS-SECTION"), 18, titleY);
  ctx.textAlign = "right";
  ctx.fillStyle = palette.faint;
  const lambda0 = 30 / params.freq;
  ctx.fillText(`${format(params.freq, 2)} GHz · λ₀ ${format(lambda0, lambda0 < 10 ? 2 : 1)} cm · ${params.pol === "AVG" ? (french ? "MOY." : "AVG") : params.pol}`, width - 18, titleY);
  ctx.restore();
  }

  /* ── Floor shadow ─────────────────────────────────────────────────── */
  ctx.save();
  ctx.translate(width / 2 + depth.x / 2, bottom + 6);
  ctx.scale(1, 0.13);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, stackWidth * 1.05);
  shadow.addColorStop(0, dark ? "rgba(0,0,0,.75)" : "rgba(30,60,80,.28)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(-stackWidth * 1.1, -stackWidth * 1.1, stackWidth * 2.2, stackWidth * 2.2);
  ctx.restore();

  /* ── Layer tiles ──────────────────────────────────────────────────── */
  params.layers.forEach((layer, index) => {
    const tint = layer.insert ? palette.tra : tintOf(layer.mat);
    const selected = index === params.sel;
    const hovered = index === params.hover;
    const x = tileStart + (index % columns) * (tileWidth + gap);
    const y = tileY + Math.floor(index / columns) * (tileH + gap);
    tiles.push({ x0: x, x1: x + tileWidth, y0: y, y1: y + tileH, index });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, tileWidth, tileH, tileH / 2);
    ctx.fillStyle = selected ? rgba(palette.inc, dark ? 0.16 : 0.1) : rgba(tint, hovered ? 0.16 : 0.07);
    ctx.fill();
    ctx.strokeStyle = selected ? rgba(palette.inc, 0.75) : rgba(tint, hovered ? 0.6 : 0.32);
    ctx.lineWidth = selected ? 1.2 : 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 12, y + tileH / 2, 4, 0, TAU);
    ctx.fillStyle = layer.mat === "air" ? rgba(tint, 0.35) : tint;
    ctx.fill();
    ctx.font = `600 ${compact ? 11.5 : 10.5}px ${SANS}`;
    let text = `${index + 1} · ${layer.name}`;
    while (ctx.measureText(text).width > tileWidth - 28 && text.length > 4) text = text.slice(0, -2) + "…";
    ctx.fillStyle = selected ? palette.ink : palette.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 21, y + tileH / 2 + 0.5);
    if (!compact) {
    const anchor = (bx[index] + bx[index + 1]) / 2 + depth.x / 2;
    ctx.setLineDash([2, 3]);
    path([{ x: x + tileWidth / 2, y: tileY + tileH + 2 }, { x: x + tileWidth / 2, y: tileY + tileH + 8 }, { x: anchor, y: top + depth.y - 4 }]);
    ctx.strokeStyle = selected ? rgba(palette.inc, 0.6) : rgba(tint, 0.3);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    }
    ctx.restore();
  });
  if (compact && params.layers[params.sel]) {
    const selected = params.layers[params.sel];
    ctx.save();
    ctx.font = `600 11.5px ${SANS}`;
    ctx.fillStyle = palette.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let name = `${params.sel + 1} · ${selected.name} · ${format(selected.cm, selected.cm < 1 ? 3 : 1)} cm`;
    while (ctx.measureText(name).width > width - 24 && name.length > 4) name = name.slice(0, -2) + "…";
    ctx.fillText(name, width / 2, tileY + rows * (tileH + gap) + 10);
    ctx.restore();
  }

  /* ── Material slabs ───────────────────────────────────────────────── */
  params.layers.forEach((layer, index) => {
    const x0 = bx[index];
    const x1 = bx[index + 1];
    const tint = layer.insert ? palette.tra : tintOf(layer.mat);
    const air = layer.mat === "air";
    const glass = layer.mat === "glass";
    const opacity = air ? 0.05 : glass ? 0.2 : 0.7;
    const corners = [{ x: x0, y: top }, { x: x1, y: top }, { x: x1, y: bottom }, { x: x0, y: bottom }];
    const face = ctx.createLinearGradient(x0, top, x1, bottom);
    face.addColorStop(0, rgba(mix(tint, "#ffffff", 0.22), opacity));
    face.addColorStop(0.55, rgba(tint, opacity));
    face.addColorStop(1, rgba(mix(tint, "#000000", 0.38), opacity));
    path(corners, true);
    ctx.fillStyle = face;
    ctx.fill();
    drawMaterialSurface(ctx, layer.mat, corners, x1 - x0, bottom - top, dark, air ? 0.25 : glass ? 0.4 : 0.55);
    const shade = ctx.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, "rgba(255,255,255,.10)");
    shade.addColorStop(0.18, "rgba(255,255,255,0)");
    shade.addColorStop(0.8, "rgba(0,0,0,0)");
    shade.addColorStop(1, dark ? "rgba(0,0,0,.38)" : "rgba(20,40,60,.16)");
    path(corners, true);
    ctx.fillStyle = shade;
    ctx.fill();
    if (glass) {
      ctx.save();
      path(corners, true);
      ctx.clip();
      for (const offset of [0.18, 0.52]) {
        const y = top + (bottom - top) * offset;
        path([{ x: x0, y: y + 36 }, { x: x1, y: y - 6 }, { x: x1, y: y + 18 }, { x: x0, y: y + 60 }], true);
        ctx.fillStyle = "rgba(225,252,255,.16)";
        ctx.fill();
      }
      ctx.restore();
      path([{ x: x0 + 1, y: top }, { x: x0 + 1, y: bottom }]);
      ctx.strokeStyle = "rgba(230,255,255,.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (air) {
      ctx.setLineDash([3, 5]);
      path(corners, true);
      ctx.strokeStyle = rgba(tint, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      for (let k = 0; k < 7; k++) {
        const py = top + ((k * 97 + time * 14) % (bottom - top));
        const px = x0 + ((k * 37) % Math.max(4, x1 - x0 - 4)) + 2;
        ctx.fillStyle = rgba(tint, 0.35);
        ctx.fillRect(px, py, 1.4, 1.4);
      }
    } else {
      path([{ x: x0 + 0.5, y: top }, { x: x0 + 0.5, y: bottom }]);
      ctx.strokeStyle = dark ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
      path([{ x: x1 - 0.5, y: top }, { x: x1 - 0.5, y: bottom }]);
      ctx.strokeStyle = rgba(mix(tint, "#000000", 0.6), 0.5);
      ctx.stroke();
    }
    const cap = [{ x: x0, y: top }, { x: x0 + depth.x, y: top + depth.y }, { x: x1 + depth.x, y: top + depth.y }, { x: x1, y: top }];
    path(cap, true);
    ctx.fillStyle = rgba(mix(tint, "#ffffff", 0.4), air ? 0.1 : glass ? 0.35 : 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(mix(tint, "#ffffff", 0.6), air ? 0.3 : 0.5);
    ctx.lineWidth = 0.7;
    ctx.stroke();
    const absorbed = layer.absorbed ?? 0;
    if (absorbed > 0.004) {
      ctx.save();
      path(corners, true);
      ctx.clip();
      const cy = (ys[index] + ys[index + 1]) / 2;
      const pulse = 0.9 + 0.1 * Math.sin(time * 3 + index);
      glow((x0 + x1) / 2, cy, (24 + Math.sqrt(absorbed) * 90) * pulse, absColor, Math.min(0.6, 0.14 + absorbed * 0.9));
      ctx.restore();
    }
    rects.push({ x0, x1, y0: top + depth.y, y1: bottom });
  });
  {
    const tint = tintOf(params.layers[count - 1].mat);
    const air = params.layers[count - 1].mat === "air";
    const side = [{ x: right, y: top }, { x: right + depth.x, y: top + depth.y }, { x: right + depth.x, y: bottom + depth.y }, { x: right, y: bottom }];
    path(side, true);
    ctx.fillStyle = rgba(mix(tint, "#000000", 0.42), air ? 0.08 : 0.9);
    ctx.fill();
  }
  const outline = (index: number, color: string, lineWidth: number) => {
    const x0 = bx[index];
    const x1 = bx[index + 1];
    path([{ x: x0, y: bottom }, { x: x0, y: top }, { x: x0 + depth.x, y: top + depth.y }, { x: x1 + depth.x, y: top + depth.y }, { x: x1 + depth.x, y: bottom + depth.y }, { x: x1, y: bottom }], true);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  };
  if (params.hover >= 0 && params.hover !== params.sel && params.hover < count) outline(params.hover, rgba(palette.inc, 0.45), 1);
  if (params.sel >= 0 && params.sel < count) {
    ctx.save();
    ctx.shadowColor = palette.inc;
    ctx.shadowBlur = dark ? 14 : 6;
    outline(params.sel, rgba(palette.inc, 0.95), 1.6);
    ctx.restore();
    const x0 = bx[params.sel] - 6;
    const x1 = bx[params.sel + 1] + depth.x + 6;
    const y0 = top + depth.y - 6;
    const y1 = bottom + 6;
    const arm = 9;
    ctx.strokeStyle = rgba(palette.inc, 0.85);
    ctx.lineWidth = 1.4;
    for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
      path([{ x: cx + arm * sx, y: cy }, { x: cx, y: cy }, { x: cx, y: cy + arm * sy }]);
      ctx.stroke();
    }
  }

  /* ── Normal + angle annotations ───────────────────────────────────── */
  if (options.annotations) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    path([{ x: left - (compact ? 56 : 86), y: middle }, { x: left + 28, y: middle }]);
    ctx.strokeStyle = rgba(palette.muted, 0.55);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.setLineDash([]);
    if (params.theta >= 3) {
      const radius = compact ? 22 : 46;
      ctx.beginPath();
      ctx.arc(left, middle, radius, Math.PI, Math.PI + theta);
      ctx.strokeStyle = rgba(palette.inc, 0.85);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      const mid = Math.PI + theta / 2;
      ctx.font = `600 ${compact ? 9 : 10.5}px ${MONO}`;
      ctx.fillStyle = palette.inc;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      if (!compact) ctx.fillText(`θi ${format(params.theta, 1)}°`, left + Math.cos(mid) * (radius + 8), middle + Math.sin(mid) * (radius + 8) - 2);
      const sel = clamp(params.sel, 0, count - 1);
      const layer = params.layers[sel];
      const w = bx[sel + 1] - bx[sel];
      if (layer && layer.mat !== "air" && w >= 22) {
        const drawn = Math.atan2(ys[sel + 1] - ys[sel], w);
        const r = Math.min(26, w * 0.7);
        ctx.setLineDash([3, 4]);
        path([{ x: bx[sel], y: ys[sel] }, { x: bx[sel] + r + 10, y: ys[sel] }]);
        ctx.strokeStyle = rgba(palette.ink, 0.5);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(bx[sel], ys[sel], r, 0, drawn);
        ctx.strokeStyle = rgba(palette.tra, 0.95);
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ── Waves ────────────────────────────────────────────────────────── */
  const wave = (from: Point, to: Point, color: string, p0: number | null, p1: number | null, index: number, phase: number, opacity = 1) =>
    drawWaveRibbon(ctx, from, to, color, p0, p1, index, phase, {
      frequency: params.freq, time, compact, dark, display: options.display, pol: params.pol,
    }, opacity);

  let phase = wave(source, entry, palette.inc, 1, 1, 1, 0);
  const reflectionPhase = phase;
  if (refOffset) {
    ctx.setLineDash([2, 4]);
    path([entry, refStart]);
    ctx.strokeStyle = rgba(palette.ref, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  wave(refStart, refEnd, palette.ref, params.R, params.R, 1, reflectionPhase + Math.PI);
  const solutions = options.reflections
    ? [solveStack(params.etas, params.ds, params.freq, theta, params.pol === "TM" ? "TM" : "TE"), ...(params.pol === "AVG" ? [solveStack(params.etas, params.ds, params.freq, theta, "TM")] : [])]
    : [];
  params.layers.forEach((layer, index) => {
    const start = { x: bx[index], y: ys[index] };
    const end = { x: bx[index + 1], y: ys[index + 1] };
    phase = wave(start, end, palette.inc, layer.fluxIn, layer.fluxOut, layer.nRe, phase);
    if (options.reflections && index < count - 1 && solutions.length) {
      const strength = solutions.reduce((sum, solution) => sum + abs2(solution.rho[index + 1]), 0) / solutions.length;
      const back = { x: start.x, y: Math.min(bottom - 18, end.y + Math.max(15, end.y - start.y)) };
      const attenuation = Math.exp(-2 * Math.abs(solutions[0].kz[index + 1].im) * params.ds[index]);
      wave(end, back, palette.ref, layer.fluxOut * strength, layer.fluxOut * strength * attenuation, layer.nRe, phase + Math.PI, 0.5);
    }
  });
  wave(exit, receiver, palette.tra, params.T, params.T, 1, phase);

  /* ── Interface flares ─────────────────────────────────────────────── */
  {
    const pulse = 0.85 + 0.15 * Math.sin(time * 4.2);
    ctx.save();
    if (dark) ctx.globalCompositeOperation = "lighter";
    glow(entry.x, entry.y, 34, palette.inc, (dark ? 0.3 : 0.18) * pulse);
    glow(refStart.x, refStart.y, 26, palette.ref, Math.sqrt(params.R) * 0.3 * pulse);
    glow(exit.x, exit.y, 30, palette.tra, Math.sqrt(params.T) * (dark ? 0.35 : 0.2) * pulse);
    ctx.restore();
  }

  /* ── Instruments ──────────────────────────────────────────────────── */
  const scale = compact ? 0.72 : 1;
  const meter = (x: number, y: number, power: number, color: string) => {
    const level = clamp((10 * Math.log10(Math.max(power, 1e-9)) + 40) / 40, 0, 1);
    const lit = Math.round(level * 6);
    for (let bar = 0; bar < 6; bar++) {
      const h = (4 + bar * 2) * scale;
      ctx.fillStyle = bar < lit ? color : rgba(palette.muted, 0.22);
      ctx.beginPath();
      ctx.roundRect(x + bar * 5 * scale, y - h, 3.2 * scale, h, 1);
      ctx.fill();
    }
  };
  {
    ctx.save();
    ctx.translate(source.x, source.y);
    ctx.rotate(theta);
    ctx.scale(scale, scale);
    for (let ring = 0; ring < 3; ring++) {
      const progress = (time * 0.9 + ring / 3) % 1;
      ctx.beginPath();
      ctx.arc(4, 0, 12 + progress * 36, -0.55, 0.55);
      ctx.strokeStyle = rgba(palette.inc, (1 - progress) * 0.6);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.shadowColor = "rgba(0,0,0,.4)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.roundRect(-46, -8, 16, 16, 3);
    ctx.fillStyle = metal(-8, 8);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-31, -6.5); ctx.lineTo(-14, -6.5); ctx.lineTo(4, -16); ctx.lineTo(4, 16); ctx.lineTo(-14, 6.5); ctx.lineTo(-31, 6.5);
    ctx.closePath();
    ctx.fillStyle = metal(-16, 16);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = rgba(palette.inc, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    path([{ x: 4, y: -16 }, { x: 4, y: 16 }]);
    ctx.strokeStyle = palette.inc;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = palette.inc;
    ctx.shadowBlur = dark ? 6 : 0;
    ctx.stroke();
    ctx.restore();
  }
  const dish = (at: Point, angle: number, color: string, power: number) => {
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    glow(-10, 0, 34, color, (dark ? 0.4 : 0.2) * Math.min(1, Math.sqrt(power) * 1.6));
    ctx.shadowColor = "rgba(0,0,0,.4)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(-22, 0, 25, -0.8, 0.8);
    ctx.arc(-27, 0, 25, 0.72, -0.72, true);
    ctx.closePath();
    ctx.fillStyle = metal(-18, 18);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 1;
    ctx.stroke();
    const tipX = -22 + 25 * Math.cos(0.8);
    const tipY = 25 * Math.sin(0.8);
    path([{ x: tipX, y: -tipY }, { x: -15, y: 0 }, { x: tipX, y: tipY }]);
    ctx.strokeStyle = rgba(palette.muted, 0.7);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-15, 0, 2.6, 0, TAU);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = dark ? 10 * Math.min(1, Math.sqrt(power) * 2) : 0;
    ctx.fill();
    ctx.restore();
  };
  dish(receiver, theta, palette.tra, params.T);
  dish(refEnd, Math.PI - theta, palette.ref, params.R);
  meter(receiver.x + 18 * scale, receiver.y - 14 * scale, params.T, palette.tra);
  meter(refEnd.x - 48 * scale, refEnd.y - 14 * scale, params.R, palette.ref);

  /* ── Surface lab overlay: profile on the front face ──────────────────
     No extra beams: the single R and T beams above carry the resultant
     R and T, summed over all diffraction orders. */
  const surface = params.surface;
  if (surface && surface.profile.id !== "flat") {
    const prof = surface.profile;
    const faceTop = top + 4;
    const faceBottom = bottom - 4;
    const periods = clamp(Math.round((faceBottom - faceTop) / 28), 3, 14);
    const periodPx = (faceBottom - faceTop) / periods;
    // schematic: Λ is fitted to the face, h keeps its ratio to Λ
    const depthPx = clamp((periodPx * prof.depth) / Math.max(prof.period, 1e-3), 3, compact ? 18 : 28);
    const heightOf = profileHeight(prof);
    const xAt = (y: number) => {
      const u = ((((y - faceTop) / periodPx) % 1) + 1) % 1;
      return left - depthPx * heightOf(u);
    };
    const tint = tintOf(params.layers[0]?.mat ?? "air");
    const outlinePts: Point[] = [];
    for (let y = faceTop; y <= faceBottom; y += 1) outlinePts.push({ x: xAt(y), y });
    ctx.save();
    path([{ x: left, y: faceTop }, ...outlinePts, { x: left, y: faceBottom }], true);
    const fill = ctx.createLinearGradient(left - depthPx, 0, left, 0);
    fill.addColorStop(0, rgba(mix(tint, "#ffffff", 0.25), 0.9));
    fill.addColorStop(1, rgba(tint, 0.9));
    ctx.fillStyle = fill;
    ctx.fill();
    path(outlinePts);
    ctx.strokeStyle = dark ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.95)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    // optional: the diffracted orders as separate beams (m = 0 is the specular beam already drawn)
    const reach = (from: Point, dx: number, dy: number) => {
      let t = Infinity;
      if (dx > 1e-9) t = Math.min(t, (width - 14 - from.x) / dx);
      if (dx < -1e-9) t = Math.min(t, (14 - from.x) / dx);
      if (dy > 1e-9) t = Math.min(t, (bottom + 10 - from.y) / dy);
      if (dy < -1e-9) t = Math.min(t, (top - from.y) / dy);
      return Math.max(0, t);
    };
    const face = { x: left - depthPx / 2, y: middle };
    for (const o of surface.orders ?? []) {
      if (o.m === 0) continue;
      const a = o.angleDeg * DEG;
      for (const side of ["R", "T"] as const) {
        const e = side === "R" ? o.R : o.T;
        const known = Number.isFinite(e);
        if (known && !(e > 1e-4)) continue;
        const from = side === "R" ? face : exit;
        const dx = side === "R" ? -Math.cos(a) : Math.cos(a);
        const dy = Math.sin(a);
        const len = reach(from, dx, dy) * 0.88;
        if (len < 12) continue;
        const color = side === "R" ? palette.ref : palette.tra;
        const to = { x: from.x + dx * len, y: from.y + dy * len };
        ctx.save();
        wave(from, to, color, known ? e : null, known ? e : null, 1,
          side === "R" ? reflectionPhase + Math.PI : phase, 0.7);
        if (options.annotations) {
          if (compact && Math.abs(o.m) > 1) continue;
          const label = compact ? `m${o.m > 0 ? "+" : ""}${o.m}` : `${o.m > 0 ? "+" : ""}${o.m} · ${format(o.angleDeg, 1)}°${known ? ` · ${format(e * 100, e < 0.1 ? 1 : 0)} %` : (french ? " · schém." : " · schematic")}`;
          ctx.font = `600 ${compact ? 11.5 : 10}px ${MONO}`;
          ctx.textBaseline = "middle";
          ctx.textAlign = dx < 0 ? "left" : "right";
          const tx = clamp(to.x + (dx < 0 ? 6 : -6), 6, width - 6);
          const ty = clamp(to.y + (dy >= 0 ? -10 : 10), 10, height - 8);
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = dark ? "rgba(8,14,24,.85)" : "rgba(255,255,255,.92)";
          ctx.fillRect(dx < 0 ? tx - 3 : tx - tw - 3, ty - 7, tw + 6, 14);
          ctx.fillStyle = dark ? color : mix(color, "#000000", 0.4);
          ctx.fillText(label, tx, ty);
        }
        ctx.restore();
      }
    }

    if (options.annotations && !compact) {
      ctx.save();
      ctx.font = `500 9.5px ${SANS}`;
      ctx.fillStyle = palette.faint;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const rt = surface.rt;
      const rtText = !rt || rt.source === "flat"
        ? (french ? "R/T : mur plan" : "R/T: flat wall")
        : rt.source === "rcwa"
          ? (french ? "R/T : mur profilé · RCWA · somme des ordres" : "R/T: profiled wall · RCWA · sum of all orders")
          : (french ? `R/T : mur profilé · EMT${rt.busy ? " · RCWA en cours…" : ""}` : `R/T: profiled wall · EMT${rt.busy ? " · RCWA running…" : ""}`);
      const caption = french
        ? `Profil du labo · Λ ${format(prof.period, 2)} cm · h ${format(prof.depth, 2)} cm · ${rtText}`
        : `Lab profile · Λ ${format(prof.period, 2)} cm · h ${format(prof.depth, 2)} cm · ${rtText}`;
      ctx.fillText(caption, 18, bottom + 52);
      ctx.restore();
    }
  }

  if (options.annotations) {
    const polGlyph = params.pol === "TE" ? "E ⊙" : params.pol === "TM" ? "E ↕" : "TE+TM";
    // A dedicated phone readout rail stays clear of horns, beams and slabs,
    // including normal/grazing incidence where labels otherwise collide.
    pill(compact ? "Tx" : french ? "INCIDENTE" : "INCIDENT", compact ? { x: width / 6, y: bottom + 22 } : { x: source.x, y: source.y - 38 }, palette.inc, compact ? params.pol : polGlyph);
    pill(compact ? "T" : french ? "TRANSMISE" : "TRANSMITTED", compact ? { x: width * 5 / 6, y: bottom + 22 } : { x: receiver.x, y: Math.min(bottom + 4, receiver.y + 38) }, palette.tra, `${format(params.T * 100, params.T < 0.01 ? 2 : 1)} %`);
    pill(compact ? "R" : french ? "RÉFLÉCHIE" : "REFLECTED", compact ? { x: width / 2, y: bottom + 22 } : { x: refEnd.x, y: Math.min(bottom + 4, refEnd.y + 38) }, palette.ref, `${format(params.R * 100, 1)} %`);
  }

  /* ── Dimension ruler ──────────────────────────────────────────────── */
  const ruler = bottom + (compact ? 48 : 22);
  ctx.save();
  path([{ x: left, y: ruler }, { x: right, y: ruler }]);
  ctx.strokeStyle = rgba(palette.muted, 0.55);
  ctx.lineWidth = 0.9;
  ctx.stroke();
  bx.forEach(boundary => { path([{ x: boundary, y: ruler - 4 }, { x: boundary, y: ruler + 4 }]); ctx.stroke(); });
  if (params.sel >= 0 && params.sel < count) {
    path([{ x: bx[params.sel], y: ruler }, { x: bx[params.sel + 1], y: ruler }]);
    ctx.strokeStyle = palette.inc;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${compact ? 11.5 : 10.5}px ${MONO}`;
  ctx.fillStyle = palette.muted;
  ctx.fillText(`${format(total, total < 10 ? 2 : 1)} cm${count > 1 ? ` · ${count} ${french ? "milieux" : "media"}` : ""}${compact ? ` · θi ${format(params.theta, 1)}°` : ""}`, width / 2, ruler + 8);
  ctx.restore();

  /** `boundaries` / `minWidth`: geometry for edge hit-testing (thickness drag) */
  return { rects, tiles, boundaries: bx, minWidth, incident: { source, entry } };
}
