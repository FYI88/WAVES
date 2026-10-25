import { clamp } from "../render/util";

/* ════════════════════════════════════════════════════════════════════════
   Direct manipulation of the wall stack: pure logic (no DOM, no canvas)

   - drop slot / target index when a layer is dragged to reorder,
   - thickness from a boundary drag (clamped and snapped like the panel),
   - reorder that keeps the selection on the right layer,
   - keyboard commands (Alt+←/→ move, Alt+↑/↓ thickness).

   Everything here only produces a new stack order / thickness; the app feeds
   it through the same state as the panel controls, so physics, charts, share
   links and localStorage need no special case.
   ════════════════════════════════════════════════════════════════════════ */

/** Same range as the "Thickness" control in the panel (App.tsx). */
export const THICKNESS = { min: 0.1, max: 100, step: 0.01 } as const;
export type ThicknessLimits = { min: number; max: number; step: number };

/** Pointer travel (layout px) below which a press is still a click. */
export const DRAG_THRESHOLD = 3;
/** Half-width of the boundary grab band (layout px): mouse / touch + pen. */
export const EDGE_BAND = { fine: 6, coarse: 12 } as const;

interface HasId { id: string }
interface StackState<L extends HasId> { layers: L[]; sel: number }

/* ── thickness ───────────────────────────────────────────────────────── */

/** Clamp to the limits and snap to the step, like the panel's slider/input. */
export function clampThickness(cm: number, limits: ThicknessLimits = THICKNESS): number {
  if (!Number.isFinite(cm)) return limits.min;
  const snapped = Number((Math.round(cm / limits.step) * limits.step).toFixed(6));
  return clamp(snapped, limits.min, limits.max);
}

/**
 * One keyboard step. The panel thickness slider is logarithmic and moves 1 %
 * of the log range per arrow press; do the same so a step is meaningful for
 * both a 0.4 cm pane and a 20 cm wall. `factor` scales the step (Shift).
 * Always moves by at least one `step` unless a limit is reached.
 */
export function nudgeThickness(cm: number, dir: 1 | -1, factor = 1, limits: ThicknessLimits = THICKNESS): number {
  const span = Math.log(limits.max / limits.min);
  const pos = clamp(Math.log(Math.max(cm, limits.min) / limits.min) / span, 0, 1);
  const next = clampThickness(limits.min * Math.exp(clamp(pos + dir * 0.01 * factor, 0, 1) * span), limits);
  if (next === cm || Math.sign(next - cm) !== dir) return clampThickness(cm + dir * limits.step, limits);
  return next;
}

/** Pixel travel that multiplies the back-face thickness by e (see below). */
const BACK_FACE_PX = 160;

/**
 * Thickness of layer `index` after dragging its right boundary by `dx` px.
 *
 * Geometry (waveRays.ts): the stack always spans the same pixels; layer i is
 * `minWidth + k·cm_i / Σcm` wide, k = span − minWidth·n. So the boundary on
 * the right of layer i sits at `x0 + (i+1)·minWidth + k·(P+c)/(P+c+R)`
 * (P / R = thickness left / right of the layer, c its own). Solving for c
 * makes the boundary follow the pointer exactly.
 *
 * The back face (last layer) cannot move on screen, so there it is relative:
 * every `BACK_FACE_PX` px to the right multiplies the thickness by e.
 *
 * `boundaries` / `cms` are the values at the start of the drag.
 */
export function thicknessFromBoundaryDrag(args: {
  cms: number[];
  index: number;
  boundaries: number[];
  minWidth: number;
  dx: number;
  limits?: ThicknessLimits;
}): number {
  const { cms, index, boundaries, minWidth, dx } = args;
  const limits = args.limits ?? THICKNESS;
  const n = cms.length;
  if (index < 0 || index >= n) return limits.min;
  const start = cms[index];
  if (boundaries.length !== n + 1) return start;
  if (index === n - 1) return clampThickness(start * Math.exp(dx / BACK_FACE_PX), limits);
  const k = boundaries[n] - boundaries[0] - minWidth * n;
  if (k <= 0) return start;
  let left = 0;
  for (let i = 0; i < index; i++) left += cms[i];
  let right = 0;
  for (let i = index + 1; i < n; i++) right += cms[i];
  const target = boundaries[index + 1] + dx;
  const fraction = clamp((target - boundaries[0] - (index + 1) * minWidth) / k, 0, 0.999);
  return clampThickness((fraction * right) / (1 - fraction) - left, limits);
}

/* ── hit testing (Section view) ──────────────────────────────────────── */

/**
 * Boundary under x: 1…n (boundary j is the right face of layer j−1, so a drag
 * resizes layer j−1; boundary 0, the front face, is not draggable). The band
 * is capped to a third of the narrower neighbour so thin layers keep a body.
 * Returns −1 when no boundary is close enough.
 */
export function hitBoundary(x: number, boundaries: number[], band: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let j = 1; j < boundaries.length; j++) {
    const leftWidth = boundaries[j] - boundaries[j - 1];
    const rightWidth = j + 1 < boundaries.length ? boundaries[j + 1] - boundaries[j] : Infinity;
    const reach = Math.min(band, Math.min(leftWidth, rightWidth) / 3);
    const distance = Math.abs(x - boundaries[j]);
    if (distance <= reach && distance < bestDistance) {
      best = j;
      bestDistance = distance;
    }
  }
  return best;
}

/* ── reorder ─────────────────────────────────────────────────────────── */

/** Insertion slot 0…n (before layer `slot`) whose boundary is nearest to x. */
export function dropSlot(x: number, boundaries: number[]): number {
  let best = 0;
  for (let j = 1; j < boundaries.length; j++) {
    if (Math.abs(x - boundaries[j]) < Math.abs(x - boundaries[best])) best = j;
  }
  return best;
}

/** Index the dragged layer ends up at when dropped in `slot`. */
export const slotToIndex = (from: number, slot: number) => (slot > from ? slot - 1 : slot);

/** Dropping in the slot right before or after the layer changes nothing. */
export const isNoopDrop = (from: number, slot: number) => slotToIndex(from, slot) === from;

/**
 * Move layer `from` to position `to`. The selection stays on the layer it was
 * on (it follows the layer when that one is moved). Returns the same arrays
 * when nothing changes.
 */
export function moveInStack<L extends HasId>(layers: L[], sel: number, from: number, to: number): { layers: L[]; sel: number } {
  const n = layers.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return { layers, sel };
  const next = layers.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const selected = layers[sel];
  const nextSel = selected ? next.indexOf(selected) : sel;
  return { layers: next, sel: nextSel };
}

/* ── Spatial view ────────────────────────────────────────────────────── */

export interface Pt { x: number; y: number }

/**
 * Slot 0…n nearest to the pointer along the stack axis. `slotPoints[j]` is the
 * screen position of boundary j (the renderer projects them, so the axis
 * follows the orbit camera, including when it looks at the stack from behind).
 */
export function nearestSlot(p: Pt, slotPoints: Pt[]): number {
  const n = slotPoints.length;
  if (n === 0) return 0;
  const origin = slotPoints[0];
  let dx = slotPoints[n - 1].x - origin.x;
  let dy = slotPoints[n - 1].y - origin.y;
  if (dx * dx + dy * dy < 1) {
    // stack seen end-on (or a single layer): fall back to the screen x axis
    dx = 1;
    dy = 0;
  }
  const along = (q: Pt) => (q.x - origin.x) * dx + (q.y - origin.y) * dy;
  const at = along(p);
  let best = 0;
  for (let j = 1; j < n; j++) if (Math.abs(along(slotPoints[j]) - at) < Math.abs(along(slotPoints[best]) - at)) best = j;
  return best;
}

/* ── keyboard ────────────────────────────────────────────────────────── */

export type StackCommand = { kind: "move" | "thickness"; dir: 1 | -1; factor: number };

/**
 * Alt+←/→ move the selected layer in the stack, Alt+↑/↓ change its thickness
 * by one step (Shift: five steps). Not active in text fields (Alt+arrows are
 * word-navigation there).
 */
export function stackKeyCommand(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  targetTag: string,
): StackCommand | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(targetTag.toUpperCase())) return null;
  const factor = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case "ArrowLeft": return { kind: "move", dir: -1, factor };
    case "ArrowRight": return { kind: "move", dir: 1, factor };
    case "ArrowUp": return { kind: "thickness", dir: 1, factor };
    case "ArrowDown": return { kind: "thickness", dir: -1, factor };
    default: return null;
  }
}

export function applyStackCommand<L extends HasId & { thickness: number }, S extends StackState<L>>(s: S, cmd: StackCommand): S {
  if (cmd.kind === "move") {
    const to = s.sel + cmd.dir;
    if (to < 0 || to >= s.layers.length) return s;
    return { ...s, ...moveInStack(s.layers, s.sel, s.sel, to) };
  }
  return applyResize(s, s.sel, nudgeThickness(s.layers[s.sel].thickness, cmd.dir, cmd.factor));
}

/** Drag-and-drop reorder: the selection stays on the layer it was on (see `moveInStack`). */
export function applyMove<L extends HasId, S extends StackState<L>>(s: S, from: number, to: number): S {
  const moved = moveInStack(s.layers, s.sel, from, to);
  return moved.layers === s.layers ? s : { ...s, ...moved };
}

/** Set the thickness of layer `index` (clamped/snapped); same object when unchanged. */
export function applyResize<L extends HasId & { thickness: number }, S extends StackState<L>>(s: S, index: number, cm: number): S {
  const layer = s.layers[index];
  if (!layer) return s;
  const thickness = clampThickness(cm);
  if (thickness === layer.thickness) return s;
  return { ...s, layers: s.layers.map((l, i) => (i === index ? { ...l, thickness } : l)) };
}
