import type { MaterialId } from "./physics";

type SurfaceMaterial = MaterialId | "air";
interface Point { x: number; y: number }
const TILE = 128;
const tiles = new Map<string, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
const sample = (seed: number) => {
  let value = Math.imul(seed + 1, 374761393);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

function surfaceTile(material: SurfaceMaterial, dark: boolean, cut: boolean) {
  const key = `${material}:${dark}:${cut}`;
  const cached = tiles.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const ink = dark ? "rgba(13,23,27,.45)" : "rgba(57,52,45,.32)";
  const chalk = dark ? "rgba(236,239,230,.24)" : "rgba(255,254,245,.65)";
  const stroke = (color: string, thickness: number) => {
    context.strokeStyle = color;
    context.lineWidth = thickness;
    context.stroke();
  };
  if (material === "brick") {
    context.fillStyle = dark ? "#ada697" : "#e6d9c5";
    context.fillRect(0, 0, TILE, TILE);
    for (let row = 0; row < 8; row++) {
      for (let column = -1; column < 4; column++) {
        const left = column * 32 + (row % 2) * 16;
        context.fillStyle = `hsl(15 40% ${45 + sample(row * 9 + column + 1) * 13}%)`;
        context.fillRect(left + 1, row * 16 + 1, 30, 14);
        context.fillStyle = "rgba(255,225,193,.24)";
        context.fillRect(left + 2, row * 16 + 2, 28, 1);
        context.fillStyle = "rgba(78,33,22,.2)";
        context.fillRect(left + 2, row * 16 + 13, 28, 2);
      }
    }
  }
  if (["concrete", "chipboard", "plasterboard", "brick", "custom"].includes(material)) {
    const count = material === "plasterboard" ? 105 : 230;
    for (let grain = 0; grain < count; grain++) {
      const left = 3 + sample(grain * 7 + 2) * 122;
      const top = 3 + sample(grain * 7 + 3) * 122;
      const radius = material === "plasterboard" || material === "brick" ? 0.35 + sample(grain * 7 + 4) * 0.6 : 0.6 + sample(grain * 7 + 4) * 2.1;
      const stretch = material === "chipboard" ? 2.2 : 1;
      context.beginPath();
      context.moveTo(left - radius * stretch, top);
      context.lineTo(left, top - radius * 0.7);
      context.lineTo(left + radius * stretch, top - radius * 0.2);
      context.lineTo(left + radius * 0.6, top + radius);
      context.closePath();
      context.fillStyle = grain % 3 === 0 ? chalk : ink;
      context.fill();
    }
  }
  if (material === "wood" || material === "plywood") {
    if (material === "plywood" && cut) {
      for (let ply = 0; ply < 26; ply++) {
        context.fillStyle = ply % 2 ? "rgba(91,53,23,.38)" : "rgba(255,232,187,.6)";
        context.fillRect(ply * 5, 0, 2, TILE);
      }
    } else {
      for (let grain = -1; grain < 24; grain++) {
        context.beginPath();
        for (let height = 0; height <= TILE; height += 4) {
          const bend = Math.sin(height / TILE * Math.PI * 2 + grain * 0.61) * 1.8 + Math.sin(height / TILE * Math.PI * 4 + grain * 0.35) * 0.7;
          const left = grain * 6 + bend;
          if (height === 0) context.moveTo(left, height);
          else context.lineTo(left, height);
        }
        stroke(grain % 3 === 0 ? chalk : ink, grain % 4 === 0 ? 1.4 : 0.6);
      }
      for (let ring = 0; ring < 4; ring++) {
        context.beginPath();
        context.ellipse(44, 69, 1.5 + ring * 1.7, 4 + ring * 4, -0.09, 0, Math.PI * 2);
        stroke(ink, 0.65);
      }
    }
  }
  if (material === "marble") {
    for (let vein = -1; vein < 4; vein++) {
      const drawVein = (offset: number) => {
        context.beginPath();
        for (let left = 0; left <= TILE; left += 2) {
          const top = vein * 44 + 18 + offset + Math.sin(left / TILE * Math.PI * 2 + vein * 0.6) * 13 + Math.sin(left / TILE * Math.PI * 6) * 3;
          if (left === 0) context.moveTo(left, top);
          else context.lineTo(left, top);
        }
      };
      drawVein(0);
      stroke("rgba(114,132,137,.13)", 5);
      stroke("rgba(93,113,120,.38)", 0.9);
      drawVein(3);
      stroke("rgba(174,146,103,.28)", 0.6);
      context.beginPath();
      context.moveTo(48, vein * 44 + 32);
      context.bezierCurveTo(67, vein * 44 + 38, 70, vein * 44 + 7, 106, vein * 44 - 2);
      stroke("rgba(105,122,130,.24)", 0.65);
    }
  }
  if (material === "air") {
    context.fillStyle = dark ? "rgba(160,214,229,.48)" : "rgba(60,130,151,.46)";
    for (let left = 8; left < TILE; left += 16) {
      for (let top = 8; top < TILE; top += 16) {
        context.beginPath();
        context.arc(left, top, 0.9, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  tiles.set(key, canvas);
  return canvas;
}

export function drawMaterialSurface(
  context: CanvasRenderingContext2D,
  material: SurfaceMaterial,
  corners: Point[],
  surfaceWidth: number,
  surfaceHeight: number,
  dark: boolean,
  opacity: number,
  cut = false,
) {
  if (material === "glass" || surfaceWidth <= 0 || surfaceHeight <= 0) return;
  const crosscut = material === "plywood" && cut;
  const key = `${material}:${dark}:${crosscut}`;
  let cache = patterns.get(context);
  if (!cache) { cache = new Map(); patterns.set(context, cache); }
  let pattern = cache.get(key);
  if (!pattern) {
    const tile = surfaceTile(material, dark, crosscut);
    if (!tile) return;
    pattern = context.createPattern(tile, "repeat") ?? undefined;
    if (!pattern) return;
    cache.set(key, pattern);
  }
  const origin = corners[0];
  context.save();
  context.beginPath();
  corners.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
  context.clip();
  context.transform(
    (corners[1].x - origin.x) / surfaceWidth, (corners[1].y - origin.y) / surfaceWidth,
    (corners[3].x - origin.x) / surfaceHeight, (corners[3].y - origin.y) / surfaceHeight,
    origin.x, origin.y,
  );
  context.globalAlpha *= opacity;
  context.fillStyle = pattern;
  context.fillRect(0, 0, surfaceWidth, surfaceHeight);
  context.restore();
}
