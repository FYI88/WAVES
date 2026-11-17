import { expect, it } from "vitest";
import { sectionGeometry } from "./sectionGeometry";
import { fitSpatialCamera } from "../spatialScene";
import { thicknessFromBoundaryDrag } from "./dragStack";

it.each([[320, 400], [360, 480], [390, 506], [430, 559], [640, 320], [844, 328]])("keeps 1–6 physical pieces positive, visible and draggable at %s×%s", (w, h) => {
  for (let count = 1; count <= 6; count++) {
    const cms = Array.from({ length: count }, (_, i) => i === 1 ? 0.01 : 10 + i);
    const g = sectionGeometry(w, h, cms);
    expect(g.bottom - g.top).toBeGreaterThan(150);
    expect(g.tileWidth).toBeGreaterThan(80);
    expect(g.tileStart).toBeGreaterThanOrEqual(0);
    expect(g.tileStart + g.columns * (g.tileWidth + g.gap) - g.gap).toBeLessThan(w);
    expect(g.bx[0]).toBeGreaterThan(35);
    expect(g.bx[count]).toBeLessThan(w - 35);
    for (let i = 0; i < count; i++) {
      expect(g.bx[i + 1] - g.bx[i]).toBeGreaterThanOrEqual(g.minWidth);
      // The 0.01cm insert is selectable, not resizable; ordinary layers keep
      // the existing thickness helper's 0.01cm snapping tolerance.
      if (cms[i] >= 0.1) expect(thicknessFromBoundaryDrag({ cms, index: i, boundaries: g.bx, minWidth: g.minWidth, dx: 0 })).toBeCloseTo(cms[i], 1);
    }
  }
});

it("preserves the wide section's existing geometry", () => {
  const g = sectionGeometry(1000, 600, [10, 0.01, 10]);
  expect(g).toMatchObject({ compact: false, columns: 3, rows: 1, top: 140, bottom: 514, minWidth: 20, stackWidth: 240 });
});

it("fits projected wall and beam endpoints inside the measured phone canvas at every allowed orbit extreme", () => {
  const points = [];
  for (const x of [-300, 300]) for (const y of [-220, 220]) for (const z of [-120, 115]) points.push({ x, y, z });
  for (const [w, h] of [[320, 400], [430, 559], [844, 328]]) for (const az of [-0.35, 0.45, 1.15]) for (const el of [0.15, 0.45, 0.85]) {
    const { scale, center } = fitSpatialCamera(w, h, points, az, el);
    expect(scale).toBeGreaterThan(0);
    for (const p of points) {
      const x = center.x + scale * (p.x * Math.cos(az) + p.y * Math.sin(az));
      const y = center.y + scale * ((-p.x * Math.sin(az) + p.y * Math.cos(az)) * Math.sin(el) - p.z * Math.cos(el));
      expect(x).toBeGreaterThanOrEqual(19.99); expect(x).toBeLessThanOrEqual(w - 19.99);
      expect(y).toBeGreaterThanOrEqual(57.99); expect(y).toBeLessThanOrEqual(h - 83.99);
    }
  }
});
