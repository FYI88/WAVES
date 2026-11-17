import { describe, expect, it } from "vitest";
import { hitIncident, incidentAngle, type SceneLayout } from "./hitTest";

describe("direct incidence drag", () => {
  const layout: SceneLayout = { rects: [], incident: { source: { x: 20, y: 50 }, entry: { x: 100, y: 100 } } };
  it("grabs the incoming ray with a touch band, not the wall or distant background", () => {
    expect(hitIncident(layout, { x: 20, y: 50 }, 22)).toBe(true);
    expect(hitIncident(layout, { x: 60, y: 85 }, 22)).toBe(true);
    expect(hitIncident(layout, { x: 99, y: 100 }, 22)).toBe(false);
    expect(hitIncident(layout, { x: 10, y: 150 }, 22)).toBe(false);
    expect(hitIncident({ rects: [] }, { x: 20, y: 50 }, 22)).toBe(false);
  });
  it("rotates around the fixed entry point, snaps half degrees and clamps to the solver range", () => {
    const entry = { x: 100, y: 100 };
    expect(incidentAngle(entry, { x: 20, y: 100 })).toBe(0);
    expect(incidentAngle(entry, { x: 20, y: 20 })).toBe(45);
    expect(incidentAngle(entry, { x: 100, y: 20 })).toBe(89);
    expect(incidentAngle(entry, { x: 20, y: 150 })).toBe(0);
    expect(incidentAngle(entry, { x: 0, y: 50 })).toBe(26.5);
  });
});
