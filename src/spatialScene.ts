import { MATERIALS, CUSTOM_TINT, type MaterialId } from "./physics";
import { drawMaterialSurface } from "./materialSurfaces";

interface Point { x: number; y: number }
interface Vector { x: number; y: number; z: number }
interface LayerView {
  mat: MaterialId | "air";
  cm: number;
  thetaT: number;
  nRe: number;
  absorbed: number;
  fluxIn: number;
  fluxOut: number;
  name: string;
}
interface Parameters {
  theta: number;
  R: number;
  T: number;
  layers: LayerView[];
  sel: number;
  hover: number;
  freq: number;
  pol: "TE" | "TM" | "AVG";
  labels: { normal: string; tx: string; rx: string; refl: string };
}
interface Palette {
  dark: boolean;
  ink: string;
  muted: string;
  faint: string;
  inc: string;
  ref: string;
  tra: string;
  abs: string;
  grid: string;
  gridStrong: string;
  label: string;
  labelBorder: string;
}
export interface SceneOptions {
  display: "field" | "fronts" | "both";
  annotations: boolean;
  /** free-orbit camera: yaw around z, pitch above the floor plane */
  az: number;
  el: number;
  lang: "fr" | "en";
  /** canvas shadowBlur is very expensive on Mali GPUs; disable it on phones */
  shadows?: boolean;
}
const TAU = Math.PI * 2;
const DEGREE = Math.PI / 180;
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = '"Inter Tight", system-ui, sans-serif';
const bound = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const alpha = (color: string, opacity: number) => {
  const value = parseInt(color.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${bound(opacity, 0, 1)})`;
};
const blend = (first: string, second: string, amount: number) => {
  const left = parseInt(first.slice(1), 16);
  const right = parseInt(second.slice(1), 16);
  return `#${[16, 8, 0].map(shift => Math.round(((left >> shift) & 255) * (1 - amount) + ((right >> shift) & 255) * amount).toString(16).padStart(2, "0")).join("")}`;
};
const tintOf = (material: LayerView["mat"]) => material === "air" ? "#86c6dc" : material === "custom" ? CUSTOM_TINT : MATERIALS[material].tint;

export function drawSpatialScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  intro: number,
  params: Parameters,
  palette: Palette,
  _patterns: (CanvasPattern | null)[],
  format: (value: number, decimals?: number) => string,
  options: SceneOptions,
) {
  const compact = width < 600;
  const scale = Math.min(width / (compact ? 760 : 940), height / 510);
  const shadows = options.shadows !== false;
  const center = { x: width * 0.50, y: height * (compact ? 0.46 : 0.50) };
  const ca = Math.cos(options.az), sa = Math.sin(options.az);
  const se = Math.sin(options.el), ce = Math.cos(options.el);
  const project = (point: Vector): Point => {
    const x1 = point.x * ca + point.y * sa;
    const y1 = -point.x * sa + point.y * ca;
    return {
      x: center.x + scale * x1,
      y: center.y + scale * (y1 * se - point.z * ce),
    };
  };
  const trace = (points: Point[], close = false) => {
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    if (close) ctx.closePath();
  };
  const line = (points: Vector[], color: string, thickness = 1) => {
    trace(points.map(project));
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.stroke();
  };
  const polygon = (points: Vector[], fill: string | CanvasGradient | CanvasPattern, stroke?: string) => {
    trace(points.map(project), true);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8; ctx.stroke(); }
  };
  const glow = (point: Point, radius: number, color: string, opacity: number) => {
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, alpha(color, opacity));
    gradient.addColorStop(0.28, alpha(color, opacity * 0.36));
    gradient.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2);
  };
  const label = (text: string, position: Point, color: string, align: CanvasTextAlign = "center", filled = true) => {
    ctx.save();
    ctx.font = `500 ${compact ? 9 : 10}px ${MONO}`;
    const textWidth = ctx.measureText(text).width;
    if (align === "center") position = { ...position, x: bound(position.x, textWidth / 2 + 12, width - textWidth / 2 - 12) };
    const left = align === "center" ? position.x - textWidth / 2 : align === "right" ? position.x - textWidth : position.x;
    if (filled) {
      ctx.fillStyle = palette.dark ? "rgba(9,19,27,.91)" : "rgba(248,252,255,.94)";
      ctx.beginPath();
      ctx.roundRect(left - 8, position.y - 10, textWidth + 16, 22, 5);
      ctx.fill();
      ctx.strokeStyle = alpha(color, 0.2);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, position.x, position.y + 1);
    ctx.restore();
  };

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.globalAlpha = Math.min(1, intro * 2);

  const floor = -120;
  for (let position = -480; position <= 480; position += 40) {
    ctx.globalAlpha = Math.min(1, intro * 2) * Math.max(0, 1 - Math.abs(position) / 520); line([{ x: position, y: -230, z: floor }, { x: position, y: 250, z: floor }], palette.grid, 0.7);
  }
  for (let position = -230; position <= 250; position += 40) {
    ctx.globalAlpha = Math.min(1, intro * 2) * Math.max(0, 1 - Math.abs(position - 10) / 290); line([{ x: -480, y: position, z: floor }, { x: 480, y: position, z: floor }], palette.grid, 0.7);
  }
  ctx.globalAlpha = Math.min(1, intro * 2); const floorCenter = project({ x: 0, y: 0, z: floor });
  ctx.save();
  ctx.translate(floorCenter.x, floorCenter.y);
  ctx.scale(1, 0.23);
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 220 * scale);
  shadow.addColorStop(0, palette.dark ? "rgba(0,0,0,.85)" : "rgba(41,67,80,.25)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(-240 * scale, -240 * scale, 480 * scale, 480 * scale);
  ctx.restore();

  const total = params.layers.reduce((sum, layer) => sum + layer.cm, 0);
  const minimum = compact ? 14 : 12;
  const stackWidth = bound(90 + Math.sqrt(total) * 13, 115, 255);
  const widths = params.layers.map(layer => minimum + (stackWidth - minimum * params.layers.length) * layer.cm / total);
  const boundaries = [-stackWidth / 2];
  widths.forEach(layerWidth => boundaries.push(boundaries[boundaries.length - 1] + layerWidth));
  const wallHalfDepth = 108;
  const wallTop = 115;
  const wallBottom = -105;
  const angle = params.theta * DEGREE;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const yPositions = [0];
  params.layers.forEach((layer, index) => yPositions.push(yPositions[index] + widths[index] * Math.tan(layer.thetaT * DEGREE)));
  const largestY = yPositions[yPositions.length - 1];
  const schematicScale = largestY > 140 ? 140 / largestY : 1;
  yPositions.forEach((value, index) => yPositions[index] = value * schematicScale - largestY * schematicScale / 2);
  const entry: Vector = { x: boundaries[0], y: yPositions[0], z: 8 };
  const exit: Vector = { x: boundaries[boundaries.length - 1], y: yPositions[yPositions.length - 1], z: 8 };
  const incomingLength = Math.min(compact ? 185 : 300, 205 / Math.max(sine, 0.1), ((compact ? 270 : 340) + entry.x) / Math.max(cosine, 0.1));
  const outgoingLength = Math.min(compact ? 185 : 300, 180 / Math.max(sine, 0.1), ((compact ? 270 : 340) - exit.x) / Math.max(cosine, 0.1));
  const source: Vector = { x: entry.x - incomingLength * cosine, y: entry.y - incomingLength * sine, z: 8 };
  const receiver: Vector = { x: exit.x + outgoingLength * cosine, y: exit.y + outgoingLength * sine, z: 8 };
  const reflectionEnd: Vector = { x: entry.x - incomingLength * cosine, y: entry.y + incomingLength * sine, z: 8 };
  const polygons: Point[][] = [];
  const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];

  params.layers.forEach((layer, index) => {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const tint = tintOf(layer.mat);
    const selected = index === params.sel;
    const air = layer.mat === "air";
    const glass = layer.mat === "glass";
    const edge = alpha(selected ? palette.inc : tint, selected ? 0.76 : 0.4);
    const front: Vector[] = [
      { x: start, y: wallHalfDepth, z: wallBottom }, { x: end, y: wallHalfDepth, z: wallBottom },
      { x: end, y: wallHalfDepth, z: wallTop }, { x: start, y: wallHalfDepth, z: wallTop },
    ];
    const face: Vector[] = [
      { x: start, y: -wallHalfDepth, z: wallBottom }, { x: start, y: wallHalfDepth, z: wallBottom },
      { x: start, y: wallHalfDepth, z: wallTop }, { x: start, y: -wallHalfDepth, z: wallTop },
    ];
    const top: Vector[] = [
      { x: start, y: -wallHalfDepth, z: wallTop }, { x: end, y: -wallHalfDepth, z: wallTop },
      { x: end, y: wallHalfDepth, z: wallTop }, { x: start, y: wallHalfDepth, z: wallTop },
    ];
    const footprint = [...face.map(project), ...front.map(project), ...top.map(project)];
    rects.push({ x0: Math.min(...footprint.map(point => point.x)), x1: Math.max(...footprint.map(point => point.x)), y0: Math.min(...footprint.map(point => point.y)), y1: Math.max(...footprint.map(point => point.y)) });
    polygons.push([
      project({ x: start, y: -wallHalfDepth, z: wallTop }), project({ x: end, y: -wallHalfDepth, z: wallTop }),
      project({ x: end, y: wallHalfDepth, z: wallTop }), project({ x: end, y: wallHalfDepth, z: wallBottom }),
      project({ x: start, y: wallHalfDepth, z: wallBottom }), project({ x: start, y: -wallHalfDepth, z: wallBottom }),
    ]);
    if (air) ctx.setLineDash([2, 5]);
    polygon(face, alpha(blend(tint, palette.dark ? "#182830" : "#ffffff", 0.24), air ? 0.035 : glass ? 0.14 : 0.88), edge);
    polygon(top, alpha(blend(tint, "#ffffff", 0.38), air ? 0.05 : glass ? 0.32 : 0.98), edge);
    const startPoint = project(front[0]);
    const endPoint = project(front[2]);
    const materialGradient = ctx.createLinearGradient(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
    materialGradient.addColorStop(0, alpha(blend(tint, palette.dark ? "#08121a" : "#33434d", 0.28), air ? 0.025 : glass ? 0.35 : 0.98));
    materialGradient.addColorStop(0.7, alpha(tint, air ? 0.035 : glass ? 0.20 : 0.96));
    materialGradient.addColorStop(1, alpha(blend(tint, "#ffffff", 0.28), air ? 0.08 : glass ? 0.5 : 0.98));
    polygon(front, materialGradient, edge);
    ctx.setLineDash([]);
    drawMaterialSurface(ctx, layer.mat, face.map(project), wallHalfDepth * 2, wallTop - wallBottom, palette.dark, air ? 0.85 : 0.72);
    drawMaterialSurface(ctx, layer.mat, top.map(project), end - start, wallHalfDepth * 2, palette.dark, 0.6, true);
    drawMaterialSurface(ctx, layer.mat, front.map(project), end - start, wallTop - wallBottom, palette.dark, 0.88, true);
    if (air) {
      ctx.save();
      ctx.setLineDash([2, 4]);
      for (const braceZ of [wallBottom + 12, wallTop - 12]) {
        line([{ x: start, y: wallHalfDepth, z: braceZ - 5 }, { x: end, y: wallHalfDepth, z: braceZ + 5 }], alpha(tint, 0.7), 0.9);
        line([{ x: start, y: wallHalfDepth, z: braceZ + 5 }, { x: end, y: wallHalfDepth, z: braceZ - 5 }], alpha(tint, 0.7), 0.9);
      }
      ctx.restore();
    } else if (glass) {
      ctx.save();
      trace(face.map(project), true);
      ctx.clip();
      for (const offset of [-62, 46]) {
        polygon([
          { x: start, y: offset - 16, z: wallBottom }, { x: start, y: offset - 5, z: wallBottom },
          { x: start, y: offset + 75, z: wallTop }, { x: start, y: offset + 64, z: wallTop },
        ], "rgba(248,255,255,.46)");
      }
      ctx.restore();
      line([...front, front[0]], alpha("#338ca0", 0.72), Math.max(1, 1.8 * scale));
      line([face[0], face[3], face[2], front[2]], "rgba(245,255,255,.94)", 1.4);
      line([
        { x: start + Math.min(3, (end - start) / 4), y: wallHalfDepth, z: wallBottom + 3 },
        { x: start + Math.min(3, (end - start) / 4), y: wallHalfDepth, z: wallTop - 3 },
      ], "rgba(228,254,255,.9)", 0.9);
    } else {
      line([face[3], face[2], front[2]], alpha("#ffffff", palette.dark ? 0.35 : 0.72), 1.1);
      line([front[0], front[1], front[2]], alpha(blend(tint, "#26313a", 0.65), 0.6), 0.85);
    }
    if (selected) polygon(top, alpha(palette.inc, 0.13));
    else if (index === params.hover) line([...front, front[0]], alpha(palette.inc, 0.72), 1.4);
    if (layer.absorbed > 0.01) {
      const heat = project({ x: (start + end) / 2, y: yPositions[index], z: 8 });
      glow(heat, (35 + Math.sqrt(layer.absorbed) * 60) * scale, palette.abs, Math.min(0.4, layer.absorbed * 0.6));
    }
  });

  if (params.layers[params.sel]) {
    const start = boundaries[params.sel];
    const end = boundaries[params.sel + 1];
    const rim: Vector[] = [
      { x: start, y: -wallHalfDepth, z: wallTop }, { x: end, y: -wallHalfDepth, z: wallTop },
      { x: end, y: wallHalfDepth, z: wallTop }, { x: end, y: wallHalfDepth, z: wallBottom },
      { x: start, y: wallHalfDepth, z: wallBottom }, { x: start, y: wallHalfDepth, z: wallTop },
      { x: start, y: -wallHalfDepth, z: wallTop },
    ];
    ctx.save();
    ctx.lineJoin = "round";
    line(rim, palette.dark ? "#0b1923" : "#ffffff", 4.5);
    line(rim, alpha(palette.inc, 0.95), 2.2);
    line([{ x: start, y: wallHalfDepth, z: wallTop }, { x: end, y: wallHalfDepth, z: wallTop }], alpha(palette.inc, 0.85), 1.4);
    ctx.restore();
  }

  const angularFrequency = time * TAU * 0.65;
  const wavelength = bound(72 * Math.pow(2.4 / params.freq, 0.23), 32, 110);
  const beam = (from: Vector, to: Vector, color: string, powerStart: number, powerEnd: number, index: number, phase: number) => {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length < 0.001) return phase;
    const directionX = deltaX / length;
    const directionY = deltaY / length;
    const waveNumber = TAU * index / wavelength;
    const powerAt = (fraction: number) => Math.sqrt(Math.max(0, powerStart * (1 - fraction) + powerEnd * fraction));
    const at = (distance: number, lateral = 0, vertical = 0): Vector => ({
      x: from.x + directionX * distance - directionY * lateral,
      y: from.y + directionY * distance + directionX * lateral,
      z: from.z + vertical,
    });
    const visible = Math.min(1, Math.sqrt(Math.max(powerStart, powerEnd)));
    if (visible < 0.00001) return phase + waveNumber * length;
    ctx.save();
    const startPoint = project(from);
    const finishPoint = project(to);
    const coreGradient = ctx.createLinearGradient(startPoint.x, startPoint.y, finishPoint.x, finishPoint.y);
    if (palette.dark) ctx.globalCompositeOperation = "lighter"; coreGradient.addColorStop(0, alpha(color, 0.38 * Math.min(1, powerAt(0))));
    coreGradient.addColorStop(1, alpha(color, 0.38 * Math.min(1, powerAt(1))));
    trace([startPoint, finishPoint]);
    ctx.strokeStyle = coreGradient;
    ctx.lineWidth = 12 * scale;
    ctx.stroke();
    trace([startPoint, finishPoint]);
    ctx.lineWidth = 1.1;
    ctx.stroke();
    if (options.display !== "fronts") {
      const polarizations = params.pol === "AVG" ? ["TE", "TM"] : [params.pol];
      polarizations.forEach(polarization => {
        const crest: Vector[] = [];
        const base: Vector[] = [];
        for (let distance = 0; distance <= length + 1; distance += 2.5) {
          const position = Math.min(distance, length);
          const amplitude = 24 * powerAt(position / length);
          const oscillation = Math.sin(phase + waveNumber * position - angularFrequency) * amplitude;
          crest.push(at(position, polarization === "TM" ? oscillation : 0, polarization === "TE" ? oscillation : 0));
          base.push(at(position));
        }
        polygon([...crest, ...base.reverse()], alpha(color, palette.dark ? 0.13 : 0.10));
        ctx.shadowColor = color;
        ctx.shadowBlur = shadows && palette.dark ? 4 : 0;
        line(crest, alpha(color, Math.min(0.96, visible)), polarization === "TE" ? 1.8 : 1.25);
        ctx.shadowBlur = 0;
        for (let distance = 0; distance < length; distance += 10) {
          const amplitude = 24 * powerAt(distance / length);
          const oscillation = Math.sin(phase + waveNumber * distance - angularFrequency) * amplitude;
          line([at(distance), at(distance, polarization === "TM" ? oscillation : 0, polarization === "TE" ? oscillation : 0)], alpha(color, 0.22 * Math.min(1, powerAt(distance / length))), 0.6);
        }
      });
    }
    if (options.display !== "field") {
      const spacing = wavelength / index;
      let offset = ((angularFrequency - phase) / waveNumber) % spacing;
      if (offset < 0) offset += spacing;
      for (let distance = offset; distance < length; distance += spacing) {
        const strength = powerAt(distance / length);
        const edgeFade = Math.min(1, distance / 12, (length - distance) / 12);
        const extent = 34;
        const corners = [at(distance, -extent, -extent), at(distance, extent, -extent), at(distance, extent, extent), at(distance, -extent, extent)];
        polygon(corners, alpha(color, 0.032 * strength * edgeFade), alpha(color, 0.35 * strength * edgeFade));
        line([at(distance, -extent), at(distance, extent)], alpha(color, 0.22 * strength * edgeFade), 0.7);
        line([at(distance, 0, -extent), at(distance, 0, extent)], alpha(color, 0.22 * strength * edgeFade), 0.7);
      }
    }
    for (let packet = 0; packet < 3; packet++) {
      const position = ((time * 65 / index + packet * wavelength * 1.4) % (length + 30)) - 15;
      if (position <= 0 || position >= length) continue;
      const point = project(at(position));
      const opacity = powerAt(position / length) * Math.min(1, position / 12, (length - position) / 12);
      glow(point, 11 * scale, color, 0.7 * opacity); { const tail = project(at(Math.max(0, position - 30 / index))); const trail = ctx.createLinearGradient(tail.x, tail.y, point.x, point.y); trail.addColorStop(0, alpha(color, 0)); trail.addColorStop(1, alpha(color, 0.85 * opacity)); trace([tail, point]); ctx.strokeStyle = trail; ctx.lineWidth = 2.2 * scale; ctx.lineCap = "round"; ctx.stroke(); }
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.7 * scale, 0, TAU);
      ctx.fillStyle = alpha(color, opacity);
      ctx.fill();
    }
    ctx.restore();
    return phase + waveNumber * length;
  };

  ctx.save();
  ctx.setLineDash([3, 6]);
  line([{ x: entry.x - 88, y: entry.y, z: 8 }, { x: entry.x + 48, y: entry.y, z: 8 }], alpha(palette.muted, 0.5), 0.8);
  ctx.restore();
  let phase = beam(source, entry, palette.inc, 1, 1, 1, 0);
  beam(entry, reflectionEnd, palette.ref, params.R, params.R, 1, phase + Math.PI);
  params.layers.forEach((layer, index) => {
    const from: Vector = { x: boundaries[index], y: yPositions[index], z: 8 };
    const to: Vector = { x: boundaries[index + 1], y: yPositions[index + 1], z: 8 };
    phase = beam(from, to, blend(palette.inc, palette.tra, (index + 1) / (params.layers.length + 1)), layer.fluxIn, layer.fluxOut, layer.nRe, phase);
  });
  beam(exit, receiver, palette.tra, params.T, params.T, 1, phase); { const entryPoint = project(entry); const exitPoint = project(exit); const pulse = 0.85 + 0.15 * Math.sin(time * 4.2); ctx.save(); if (palette.dark) ctx.globalCompositeOperation = "lighter"; glow(entryPoint, 46 * scale, palette.inc, (palette.dark ? 0.35 : 0.18) * pulse); glow(entryPoint, 32 * scale, palette.ref, Math.sqrt(params.R) * 0.28 * pulse); glow(exitPoint, 42 * scale, palette.tra, Math.sqrt(params.T) * (palette.dark ? 0.35 : 0.2) * pulse); ctx.restore(); }

  const instrument = (position: Vector, color: string, transmitter: boolean, power: number) => {
    const floorPosition = { ...position, z: floor + 3 };
    const foot: Vector[] = [
      { ...floorPosition, x: position.x - 17, y: position.y - 17 }, { ...floorPosition, x: position.x + 17, y: position.y - 17 },
      { ...floorPosition, x: position.x + 17, y: position.y + 17 }, { ...floorPosition, x: position.x - 17, y: position.y + 17 },
    ];
    polygon(foot, palette.dark ? "#142a35" : "#c6d6df", alpha(color, 0.4));
    line([floorPosition, { ...position, z: position.z - 12 }], palette.dark ? "#32434f" : "#91a9b9", 3.5 * scale);
    const centerPoint = project(position);
    glow(centerPoint, 32 * scale, color, transmitter ? 0.18 : Math.sqrt(power) * 0.18);
    const radius = 16 * scale;
    ctx.save();
    ctx.translate(centerPoint.x, centerPoint.y);
    ctx.rotate(-0.13);
    const housing = ctx.createLinearGradient(-radius, -radius, radius, radius);
    housing.addColorStop(0, palette.dark ? "#657e8d" : "#eef6fa");
    housing.addColorStop(0.4, palette.dark ? "#213643" : "#a9bdca");
    housing.addColorStop(1, palette.dark ? "#0a131c" : "#6c8b9d");
    ctx.beginPath();
    ctx.roundRect(-radius * 0.8, -radius * 1.5, radius * 1.6, radius * 3, radius * 0.25);
    ctx.fillStyle = housing;
    ctx.fill();
    ctx.strokeStyle = alpha(color, 0.6);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    for (let slot = -3; slot <= 3; slot++) {
      ctx.fillStyle = alpha(color, slot === 0 ? 0.9 : 0.35);
      ctx.fillRect(-radius * 0.42, slot * radius * 0.3 - 0.5, radius * 0.84, 1);
    }
    ctx.restore();
    if (options.annotations) {
      label(transmitter ? `${params.labels.tx} · ${format(params.freq, 1)} GHz` : `${params.labels.rx} · ${format(power * 100, 1)}%`, { x: centerPoint.x, y: centerPoint.y - radius * 1.5 - 18 }, color);
    }
  };
  instrument(source, palette.inc, true, 1);
  instrument(receiver, palette.tra, false, params.T);
  if (options.annotations) {
    const reflectedLabel = project(reflectionEnd);
    label(`${params.labels.refl} · ${format(params.R * 100, 1)}%`, { x: bound(reflectedLabel.x, 65, width - 65), y: reflectedLabel.y + 22 }, palette.ref);
    if (params.theta >= 8) {
      const arc: Vector[] = [];
      for (let step = 0; step <= 28; step++) {
        const arcAngle = angle * step / 28;
        arc.push({ x: entry.x - Math.cos(arcAngle) * 55, y: entry.y - Math.sin(arcAngle) * 55, z: 8 });
      }
      line(arc, alpha(palette.inc, 0.6), 0.9);
      const angleLabel = project({ x: entry.x - 72, y: entry.y - Math.sin(angle * 0.5) * 70, z: 8 });
      label(`${format(params.theta, 1)}°`, { x: angleLabel.x, y: angleLabel.y - 12 }, palette.inc, "center", false);
    }
    const rulerY = wallHalfDepth + 20;
    const rulerZ = wallBottom - 10;
    line([{ x: boundaries[0], y: rulerY, z: rulerZ }, { x: boundaries[boundaries.length - 1], y: rulerY, z: rulerZ }], alpha(palette.muted, 0.5));
    boundaries.forEach(boundary => {
      line([{ x: boundary, y: wallHalfDepth, z: wallBottom - 2 }, { x: boundary, y: rulerY + 7, z: rulerZ }], alpha(palette.muted, 0.24), 0.7);
      line([{ x: boundary, y: rulerY - 7, z: rulerZ }, { x: boundary, y: rulerY + 7, z: rulerZ }], alpha(palette.muted, 0.6));
    });
    line([{ x: boundaries[params.sel], y: rulerY, z: rulerZ }, { x: boundaries[params.sel + 1], y: rulerY, z: rulerZ }], palette.inc, 2.4);
    for (const boundary of [boundaries[params.sel], boundaries[params.sel + 1]]) {
      line([{ x: boundary, y: rulerY - 8, z: rulerZ }, { x: boundary, y: rulerY + 8, z: rulerZ }], palette.inc, 1.6);
    }
    const rulerCenter = project({ x: 0, y: rulerY, z: rulerZ });
    label(`${format(total, total < 10 ? 2 : 1)} cm`, { x: rulerCenter.x, y: rulerCenter.y + 18 }, palette.muted, "center", false);
    const selected = params.layers[params.sel];
    const selectedCenter = (boundaries[params.sel] + boundaries[params.sel + 1]) / 2;
    const anchor = project({ x: selectedCenter, y: -wallHalfDepth, z: wallTop });
    const labelX = bound(anchor.x + 30, 105, width - 105);
    const labelY = Math.max(83, anchor.y - 28);
    trace([anchor, { x: anchor.x, y: labelY }, { x: labelX, y: labelY }]);
    ctx.strokeStyle = alpha(palette.inc, 0.5);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    label(`${String(params.sel + 1).padStart(2, "0")} / ${selected.name.toUpperCase()} · ${format(selected.cm, selected.cm < 10 ? 2 : 1)} cm`, { x: labelX, y: labelY }, palette.inc);
  }

  const axisOrigin = { x: compact ? 20 : 32, y: height - (compact ? 132 : 75) };
  ctx.save();
  ctx.font = `9px ${MONO}`;
  [{ text: "x", dx: 22, dy: -3, color: palette.inc }, { text: "y", dx: 12, dy: 10, color: palette.muted }, { text: "z", dx: 0, dy: -23, color: palette.tra }].forEach(axis => {
    trace([axisOrigin, { x: axisOrigin.x + axis.dx, y: axisOrigin.y + axis.dy }]);
    ctx.strokeStyle = alpha(axis.color, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = axis.color;
    ctx.fillText(axis.text, axisOrigin.x + axis.dx + 3, axisOrigin.y + axis.dy + 3);
  });
  ctx.restore();
  ctx.font = `500 ${compact ? 8 : 9}px ${SANS}`;
  ctx.fillStyle = palette.faint;
  ctx.textAlign = compact ? "left" : "right";
  ctx.fillText(compact
    ? (options.lang === "fr" ? "SCHÉMA · HORS ÉCHELLE" : "SCHEMATIC · NOT TO SCALE")
    : (options.lang === "fr" ? "VUE SCHÉMATIQUE · ÉCHELLES ADAPTÉES" : "SCHEMATIC VIEW · ADAPTED SCALES"), compact ? 18 : width - 20, height - (compact ? 99 : 66));
  ctx.restore();
  return { rects, polygons };
}
