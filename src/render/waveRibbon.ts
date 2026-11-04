import { TAU, clamp, rgba } from "./util";

export interface WavePoint { x: number; y: number }
export type WaveDisplay = "field" | "fronts" | "both";
export interface WaveStyle {
  time: number;
  frequency: number;
  compact: boolean;
  dark: boolean;
  display: WaveDisplay;
  pol?: "TE" | "TM" | "AVG";
}

/** Visual wavelength, deliberately compressed as in the original section view. */
export function visualWavelength(frequency: number, compact: boolean, index = 1): number {
  const air = clamp(70 * Math.pow(2.4 / frequency, 0.2), 32, 96) * (compact ? 0.7 : 1);
  return Math.max(10, air / Math.max(index, 1));
}

/** Field envelope from power (not field amplitude). Null means schematic, not measured. */
export function waveEnvelope(p0: number | null, p1: number | null, fraction: number): number {
  if (p0 === null || p1 === null) return 0.45;
  return Math.sqrt(Math.max(0, p0 + (p1 - p0) * clamp(fraction, 0, 1)));
}

/** Shared section/lab wave glyph. Phase is illustrative, not a reconstructed RCWA field. */
export function drawWaveRibbon(
  ctx: CanvasRenderingContext2D, from: WavePoint, to: WavePoint, color: string,
  p0: number | null, p1: number | null, index: number, phase: number,
  style: WaveStyle, opacity = 1,
): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 0.5) return phase;
  const dx = (to.x - from.x) / distance;
  const dy = (to.y - from.y) / distance;
  const k = TAU / visualWavelength(style.frequency, style.compact, index);
  const omega = style.time * TAU * 0.85;
  const amplitude = style.compact ? 13 : 21;
  const unknown = p0 === null || p1 === null;
  const envelope = (f: number) => waveEnvelope(p0, p1, f);
  const alpha = (f: number) => opacity * (unknown ? 0.45 : clamp(0.22 + 0.78 * Math.min(1, envelope(f) * 1.2), 0, 1));
  const path = (points: WavePoint[]) => {
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  };
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (!unknown && Math.max(p0!, p1!) < 1e-7) {
    path([from, to]);
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = rgba(color, 0.2 * opacity);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    return phase + k * distance;
  }
  if (style.dark) ctx.globalCompositeOperation = "lighter";
  const gradient = (strength: number) => {
    const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    g.addColorStop(0, rgba(color, alpha(0) * strength));
    g.addColorStop(1, rgba(color, alpha(1) * strength));
    return g;
  };
  path([from, to]);
  ctx.strokeStyle = gradient(style.dark ? 0.09 : 0.08);
  ctx.lineWidth = amplitude * 2.7 * Math.max(0.35, Math.min(1, Math.max(envelope(0), envelope(1))));
  ctx.stroke();
  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = rgba(color, 0.28 * opacity);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.setLineDash([]);
  if (style.display !== "fronts") {
    const crest: WavePoint[] = [];
    const steps = Math.max(2, Math.ceil(distance / 1.5));
    for (let i = 0; i <= steps; i++) {
      const along = distance * i / steps;
      const offset = Math.sin(phase + k * along - omega) * amplitude * envelope(i / steps);
      crest.push({ x: from.x + dx * along - dy * offset, y: from.y + dy * along + dx * offset });
    }
    path([...crest, to, from]);
    ctx.closePath();
    ctx.fillStyle = gradient(style.dark ? 0.16 : 0.12);
    ctx.fill();
    path(crest);
    if (!style.dark) {
      ctx.strokeStyle = "rgba(255,255,255,.7)";
      ctx.lineWidth = 4.6;
      ctx.stroke();
    }
    ctx.strokeStyle = gradient(1);
    ctx.globalAlpha = style.dark ? 0.22 : 0.14;
    ctx.lineWidth = style.compact ? 5 : 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = style.dark ? 4 : 0;
    ctx.lineWidth = style.compact ? 1.8 : 2.3;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (style.display !== "field") {
    const spacing = TAU / k;
    const first = (((omega - phase + Math.PI / 2) / k) % spacing + spacing) % spacing;
    for (let along = first; along < distance; along += spacing) {
      const f = along / distance;
      const extent = amplitude * (0.75 + 0.9 * envelope(f));
      const x = from.x + dx * along;
      const y = from.y + dy * along;
      const g = ctx.createLinearGradient(x + dy * extent, y - dx * extent, x - dy * extent, y + dx * extent);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.5, rgba(color, alpha(f) * 0.8));
      g.addColorStop(1, rgba(color, 0));
      ctx.beginPath();
      ctx.moveTo(x + dy * extent - dx * 3, y - dx * extent - dy * 3);
      ctx.quadraticCurveTo(x + dx * 5, y + dy * 5, x - dy * extent - dx * 3, y + dx * extent - dy * 3);
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (style.pol === "TE" && index === 1) {
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, TAU);
        ctx.strokeStyle = rgba(color, alpha(f) * 0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = rgba(color, alpha(f));
        ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      }
    }
  }
  const particles = Math.max(1, Math.floor(distance / 120));
  for (let p = 0; p < particles; p++) {
    const along = (style.time * 64 / Math.max(1, index) + p * distance / particles) % distance;
    const f = along / distance;
    const edge = Math.min(1, along / 14, (distance - along) / 14);
    const strength = alpha(f) * edge * Math.min(1, envelope(f) * 1.4 + 0.15);
    const x = from.x + dx * along;
    const y = from.y + dy * along;
    const tail = Math.min(along, 30 / Math.max(1, index) + 10);
    const trail = ctx.createLinearGradient(x - dx * tail, y - dy * tail, x, y);
    trail.addColorStop(0, rgba(color, 0));
    trail.addColorStop(1, rgba(color, strength * 0.9));
    path([{ x: x - dx * tail, y: y - dy * tail }, { x, y }]);
    ctx.strokeStyle = trail;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    const glowStrength = 0.5 * strength;
    if (glowStrength > 0.003) {
      const radius = 11;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
      halo.addColorStop(0, rgba(color, glowStrength));
      halo.addColorStop(0.35, rgba(color, glowStrength * 0.35));
      halo.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, TAU);
    ctx.fillStyle = rgba(style.dark ? "#ffffff" : color, strength);
    ctx.fill();
  }
  if (distance > 24) {
    // direction chevron at 86 % of the length
    const along = distance * 0.86;
    const cx = from.x + dx * along;
    const cy = from.y + dy * along;
    path([
      { x: cx - dx * 7 - dy * 4, y: cy - dy * 7 + dx * 4 },
      { x: cx, y: cy },
      { x: cx - dx * 7 + dy * 4, y: cy - dy * 7 - dx * 4 },
    ]);
    ctx.strokeStyle = rgba(color, alpha(0.86));
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
  return phase + k * distance;
}
