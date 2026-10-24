import { MATERIALS, CUSTOM_TINT, solveStack, abs2, type Cx, type MaterialId, type PolMode } from "./physics";
import { drawMaterialSurface } from "./materialSurfaces";

interface Point { x: number; y: number }
interface Layer { mat: MaterialId | "air"; cm: number; thetaT: number; nRe: number; fluxIn: number; fluxOut: number; absorbed?: number; name: string }
interface Parameters { layers: Layer[]; etas: Cx[]; ds: number[]; theta: number; freq: number; pol: PolMode; R: number; T: number; sel: number; hover: number }
interface Palette { dark: boolean; ink: string; muted: string; faint: string; inc: string; ref: string; tra: string; abs?: string; grid: string }
export interface RayOptions {
  display: "field" | "fronts" | "both";
  reflections: boolean;
  annotations: boolean;
  lang: "fr" | "en";
  /** mobile tier: coarser crest sampling, fewer wavefronts, no particle halos */
  lowPower?: boolean;
  /** canvas shadowBlur is very expensive on Mali GPUs; disable it on phones */
  shadows?: boolean;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = '"Inter Tight", system-ui, sans-serif';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rgba = (hex: string, opacity: number) => {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${clamp(opacity, 0, 1)})`;
};
const mix = (a: string, b: string, t: number) => {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  return "#" + [16, 8, 0].map(shift => Math.round(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t).toString(16).padStart(2, "0")).join("");
};
const tintOf = (material: Layer["mat"]) => material === "air" ? "#83c6dd" : material === "custom" ? CUSTOM_TINT : MATERIALS[material].tint;

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
  const compact = width < 640;
  const french = options.lang === "fr";
  const dark = palette.dark;
  const lowPower = options.lowPower === true;
  const shadows = options.shadows !== false;
  const absColor = palette.abs ?? (dark ? "#edc17f" : "#8d5b13");
  const count = params.layers.length;

  /* ── Geometry ─────────────────────────────────────────────────────── */
  const titleY = compact ? 68 : 82;
  const tileY = compact ? 80 : 94;
  const tileH = compact ? 22 : 24;
  const top = compact ? 118 : 140;
  const bottom = height - (compact ? 96 : 86);
  const middle = top + (bottom - top) * 0.4;
  const total = params.layers.reduce((sum, layer) => sum + layer.cm, 0) || 1;
  const minWidth = compact ? 14 : 20;
  const stackWidth = Math.max(minWidth * count + 12, clamp(width * 0.24, compact ? 92 : 150, 300));
  const bx = [width / 2 - stackWidth / 2];
  params.layers.forEach(layer => bx.push(bx[bx.length - 1] + minWidth + (stackWidth - minWidth * count) * layer.cm / total));
  const left = bx[0];
  const right = bx[count];
  const depth = { x: compact ? 7 : 12, y: compact ? -5 : -8 };
  const theta = params.theta * DEG;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const margin = compact ? 40 : 70;
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
    const size = compact ? 9.5 : 11;
    ctx.font = `600 ${size}px ${MONO}`;
    const textWidth = ctx.measureText(text).width;
    ctx.font = `500 ${size}px ${MONO}`;
    const subWidth = sub ? ctx.measureText(sub).width + 8 : 0;
    const w = textWidth + subWidth + 32;
    const h = compact ? 22 : 26;
    const x = clamp(at.x - w / 2, 8, width - w - 8);
    const y = clamp(at.y, h / 2 + 4, height - h / 2 - 4);
    ctx.shadowColor = dark ? "rgba(0,0,0,.5)" : "rgba(30,60,80,.16)";
    ctx.shadowBlur = shadows ? 6 : 0;
    ctx.shadowOffsetY = shadows ? 5 : 0;
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
  const gap = 6;
  const tileWidth = Math.min(compact ? 104 : 150, (width - 36 - gap * (count - 1)) / count);
  const tileStart = (width - (tileWidth + gap) * count + gap) / 2;
  params.layers.forEach((layer, index) => {
    const tint = tintOf(layer.mat);
    const selected = index === params.sel;
    const hovered = index === params.hover;
    const x = tileStart + index * (tileWidth + gap);
    tiles.push({ x0: x, x1: x + tileWidth, y0: tileY, y1: tileY + tileH, index });
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, tileY, tileWidth, tileH, tileH / 2);
    ctx.fillStyle = selected ? rgba(palette.inc, dark ? 0.16 : 0.1) : rgba(tint, hovered ? 0.16 : 0.07);
    ctx.fill();
    ctx.strokeStyle = selected ? rgba(palette.inc, 0.75) : rgba(tint, hovered ? 0.6 : 0.32);
    ctx.lineWidth = selected ? 1.2 : 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 12, tileY + tileH / 2, 4, 0, TAU);
    ctx.fillStyle = layer.mat === "air" ? rgba(tint, 0.35) : tint;
    ctx.fill();
    ctx.font = `600 ${compact ? 9 : 10.5}px ${SANS}`;
    let text = `${index + 1} · ${layer.name}`;
    while (ctx.measureText(text).width > tileWidth - 28 && text.length > 4) text = text.slice(0, -2) + "…";
    ctx.fillStyle = selected ? palette.ink : palette.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 21, tileY + tileH / 2 + 0.5);
    const anchor = (bx[index] + bx[index + 1]) / 2 + depth.x / 2;
    ctx.setLineDash([2, 3]);
    path([{ x: x + tileWidth / 2, y: tileY + tileH + 2 }, { x: x + tileWidth / 2, y: tileY + tileH + 8 }, { x: anchor, y: top + depth.y - 4 }]);
    ctx.strokeStyle = selected ? rgba(palette.inc, 0.6) : rgba(tint, 0.3);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
  });

  /* ── Material slabs ───────────────────────────────────────────────── */
  params.layers.forEach((layer, index) => {
    const x0 = bx[index];
    const x1 = bx[index + 1];
    const tint = tintOf(layer.mat);
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
    ctx.shadowBlur = shadows ? (dark ? 14 : 6) : 0;
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
      const radius = compact ? 32 : 46;
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
      ctx.fillText(`θi ${format(params.theta, 1)}°`, left + Math.cos(mid) * (radius + 8), middle + Math.sin(mid) * (radius + 8) - 2);
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
  const lambdaPx = clamp(70 * Math.pow(2.4 / params.freq, 0.2), 32, 96) * (compact ? 0.7 : 1);
  const omega = time * TAU * 0.85;
  const amplitude = compact ? 13 : 21;
  const wave = (from: Point, to: Point, color: string, p0: number, p1: number, index: number, phase: number, opacity = 1) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance < 0.5) return phase;
    const dir = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance };
    const nor = { x: -dir.y, y: dir.x };
    const k = TAU / Math.max(10, lambdaPx / Math.max(index, 1));
    const power = (f: number) => Math.sqrt(Math.max(0, p0 + (p1 - p0) * f));
    const peak = Math.max(p0, p1);
    if (peak < 1e-7) {
      ctx.setLineDash([2, 6]);
      path([from, to]);
      ctx.strokeStyle = rgba(color, 0.2 * opacity);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      return phase + k * distance;
    }
    const alphaAt = (f: number) => opacity * clamp(0.22 + 0.78 * Math.min(1, power(f) * 1.2), 0, 1);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (dark) ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    halo.addColorStop(0, rgba(color, alphaAt(0) * (dark ? 0.09 : 0.08)));
    halo.addColorStop(1, rgba(color, alphaAt(1) * (dark ? 0.09 : 0.08)));
    path([from, to]);
    ctx.strokeStyle = halo;
    ctx.lineWidth = amplitude * 2.7 * Math.max(0.35, Math.min(1, Math.sqrt(peak)));
    ctx.stroke();
    path([from, to]);
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = rgba(color, 0.28 * opacity);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.setLineDash([]);
    if (options.display !== "fronts") {
      const crest: Point[] = [];
      const base: Point[] = [];
      const steps = Math.max(2, Math.ceil(distance / (lowPower ? 3.2 : 1.5)));
      for (let step = 0; step <= steps; step++) {
        const along = distance * step / steps;
        const offset = Math.sin(phase + k * along - omega) * amplitude * power(along / distance);
        const x = from.x + dir.x * along;
        const y = from.y + dir.y * along;
        crest.push({ x: x + nor.x * offset, y: y + nor.y * offset });
        base.push({ x, y });
      }
      const ribbon = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      ribbon.addColorStop(0, rgba(color, alphaAt(0) * (dark ? 0.16 : 0.12)));
      ribbon.addColorStop(1, rgba(color, alphaAt(1) * (dark ? 0.16 : 0.12)));
      path([...crest, ...base.reverse()], true);
      ctx.fillStyle = ribbon;
      ctx.fill();
      const stroke = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      stroke.addColorStop(0, rgba(color, alphaAt(0)));
      stroke.addColorStop(1, rgba(color, alphaAt(1)));
      path(crest);
      if (!dark) {
        ctx.strokeStyle = "rgba(255,255,255,.7)";
        ctx.lineWidth = 4.6;
        ctx.stroke();
      }
      ctx.strokeStyle = stroke;
      ctx.globalAlpha = dark ? 0.22 : 0.14;
      ctx.lineWidth = compact ? 5 : 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = shadows && dark ? 4 : 0;
      ctx.lineWidth = compact ? 1.8 : 2.3;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (options.display !== "field") {
      const spacing = TAU / k;
      let first = ((omega - phase + Math.PI / 2) / k) % spacing;
      if (first < 0) first += spacing;
      for (let along = first; along < distance; along += lowPower ? spacing * 2 : spacing) {
        const f = along / distance;
        const extent = amplitude * (0.75 + 0.9 * power(f));
        const center = { x: from.x + dir.x * along, y: from.y + dir.y * along };
        const a = { x: center.x - nor.x * extent, y: center.y - nor.y * extent };
        const b = { x: center.x + nor.x * extent, y: center.y + nor.y * extent };
        const front = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        front.addColorStop(0, rgba(color, 0));
        front.addColorStop(0.5, rgba(color, alphaAt(f) * 0.8));
        front.addColorStop(1, rgba(color, 0));
        ctx.beginPath();
        ctx.moveTo(a.x - dir.x * 3, a.y - dir.y * 3);
        ctx.quadraticCurveTo(center.x + dir.x * 5, center.y + dir.y * 5, b.x - dir.x * 3, b.y - dir.y * 3);
        ctx.strokeStyle = front;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (params.pol === "TE" && index === 1) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, 3.2, 0, TAU);
          ctx.strokeStyle = rgba(color, alphaAt(f) * 0.9);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = rgba(color, alphaAt(f));
          ctx.fillRect(center.x - 0.8, center.y - 0.8, 1.6, 1.6);
        }
      }
    }
    const particles = Math.max(1, Math.floor(distance / 120));
    const speed = 64 / Math.max(1, index);
    for (let p = 0; p < particles; p++) {
      const along = (time * speed + p * distance / particles) % distance;
      const f = along / distance;
      const edge = Math.min(1, along / 14, (distance - along) / 14);
      const strength = alphaAt(f) * edge * Math.min(1, power(f) * 1.4 + 0.15);
      const x = from.x + dir.x * along;
      const y = from.y + dir.y * along;
      const tail = Math.min(along, 30 / Math.max(1, index) + 10);
      const trail = ctx.createLinearGradient(x - dir.x * tail, y - dir.y * tail, x, y);
      trail.addColorStop(0, rgba(color, 0));
      trail.addColorStop(1, rgba(color, 0.9 * strength));
      path([{ x: x - dir.x * tail, y: y - dir.y * tail }, { x, y }]);
      ctx.strokeStyle = trail;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      if (!lowPower) glow(x, y, 11, color, 0.5 * strength);
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, TAU);
      ctx.fillStyle = rgba(dark ? "#ffffff" : color, strength);
      ctx.fill();
    }
    if (distance > 24) {
      const along = distance * 0.86;
      const c = { x: from.x + along * dir.x, y: from.y + along * dir.y };
      path([{ x: c.x - dir.x * 7 + nor.x * 4, y: c.y - dir.y * 7 + nor.y * 4 }, c, { x: c.x - dir.x * 7 - nor.x * 4, y: c.y - dir.y * 7 - nor.y * 4 }]);
      ctx.strokeStyle = rgba(color, alphaAt(0.86));
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
    return phase + k * distance;
  };

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
    ctx.shadowBlur = shadows ? 12 : 0;
    ctx.shadowOffsetY = shadows ? 4 : 0;
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
    ctx.shadowBlur = shadows && dark ? 6 : 0;
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
    ctx.shadowBlur = shadows ? 12 : 0;
    ctx.shadowOffsetY = shadows ? 4 : 0;
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
    ctx.shadowBlur = shadows && dark ? 10 * Math.min(1, Math.sqrt(power) * 2) : 0;
    ctx.fill();
    ctx.restore();
  };
  dish(receiver, theta, palette.tra, params.T);
  dish(refEnd, Math.PI - theta, palette.ref, params.R);
  meter(receiver.x + 18 * scale, receiver.y - 14 * scale, params.T, palette.tra);
  meter(refEnd.x - 48 * scale, refEnd.y - 14 * scale, params.R, palette.ref);

  if (options.annotations) {
    const polGlyph = params.pol === "TE" ? "E ⊙" : params.pol === "TM" ? "E ↕" : "TE+TM";
    pill(french ? "INCIDENTE" : "INCIDENT", { x: source.x, y: source.y - (compact ? 30 : 38) }, palette.inc, polGlyph);
    pill(french ? "TRANSMISE" : "TRANSMITTED", { x: receiver.x, y: Math.min(bottom + 4, receiver.y + (compact ? 30 : 38)) }, palette.tra, `${format(params.T * 100, params.T < 0.01 ? 2 : 1)} %`);
    pill(french ? "RÉFLÉCHIE" : "REFLECTED", { x: refEnd.x, y: Math.min(bottom + 4, refEnd.y + (compact ? 30 : 38)) }, palette.ref, `${format(params.R * 100, 1)} %`);
  }

  /* ── Dimension ruler ──────────────────────────────────────────────── */
  const ruler = bottom + 22;
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
  ctx.font = `600 ${compact ? 9.5 : 10.5}px ${MONO}`;
  ctx.fillStyle = palette.muted;
  ctx.fillText(`${format(total, total < 10 ? 2 : 1)} cm${count > 1 ? ` · ${count} ${french ? "milieux" : "media"}` : ""}`, width / 2, ruler + 8);
  ctx.restore();

  return { rects, tiles };
}
