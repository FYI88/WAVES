import { clamp } from "../render/util";

/** All dimensions are measured canvas CSS pixels, not viewport/APK pixels. */
export function sectionGeometry(width: number, height: number, cms: number[]) {
  const compact = width < 640 || height < 400;
  const count = cms.length;
  const gap = 6;
  const columns = compact ? Math.max(1, Math.min(count, Math.floor((width - 18) / 94))) : count;
  const rows = Math.ceil(count / columns);
  const tileY = compact ? 12 : 54;
  const tileH = compact ? 28 : 24;
  const tileWidth = Math.min(150, (width - (compact ? 24 : 36) - gap * (columns - 1)) / columns);
  const tileStart = (width - (tileWidth + gap) * columns + gap) / 2;
  const top = compact ? tileY + rows * (tileH + gap) + 34 : 140;
  const bottom = height - (compact ? 84 : 86);
  const total = cms.reduce((sum, cm) => sum + cm, 0) || 1;
  const minWidth = compact ? 12 : 20;
  const stackWidth = Math.max(minWidth * count + 12, clamp(width * (compact ? 0.4 : 0.24), compact ? 124 : 150, compact ? 216 : 300));
  const bx = [width / 2 - stackWidth / 2];
  cms.forEach(cm => bx.push(bx[bx.length - 1] + minWidth + (stackWidth - minWidth * count) * cm / total));
  return { compact, gap, columns, rows, tileY, tileH, tileWidth, tileStart, top, bottom, total, minWidth, stackWidth, bx };
}
