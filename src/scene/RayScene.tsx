import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { drawSpatialScene, type SceneOptions } from "../spatialScene";
import { drawWaveRays } from "../waveRays";
import { recordFrame } from "../perf";
import { downloadFile } from "../dom";
import { clamp } from "../render/util";
import type { Cx, PolMode } from "../physics";
import { DICTS, type Lang } from "../i18n";
import type { Palette } from "../theme";
import type { LayerMat } from "../state/layers";
import { cssZoom, prepCanvas, useAdaptiveDprCap, useCanvasSize } from "./canvas";
import { DRAG_THRESHOLD, EDGE_BAND, dropSlot, hitBoundary, isNoopDrop, nearestSlot, slotToIndex, thicknessFromBoundaryDrag, type Pt } from "./dragStack";
import { drawDragOverlay, type DragUi } from "./dragOverlay";
import { hitLayer, inWallBand, pointOf, type SceneLayout } from "./hitTest";

/* ════════════════════════════════════════════════════════════════════════
   Ray scene: animation loop + view switching (Section / Spatial)
   ════════════════════════════════════════════════════════════════════════ */

export interface SceneLayer {
  mat: LayerMat;
  cm: number;
  thetaT: number;
  nRe: number;
  absorbed: number;
  fluxIn: number;
  fluxOut: number;
  name: string;
  readOnlyThickness?: boolean;
}

export interface SceneParams {
  etas: Cx[];
  ds: number[];
  theta: number;
  R: number;
  T: number;
  layers: SceneLayer[];
  sel: number;
  hover: number;
  freq: number;
  pol: PolMode;
  labels: { normal: string; tx: string; rx: string; refl: string };
}

/** One pointer gesture on the canvas: click, orbit (Spatial), reorder or boundary resize. */
interface Gesture {
  id: number;
  /** client coordinates at the last orbit step / at the start */
  x: number;
  y: number;
  moved: boolean;
  mode: "click" | "orbit" | "reorder" | "resize";
  /** layer being moved, or layer on the left of the dragged boundary */
  index: number;
  start: Pt;
  startCm: number;
  cms: number[];
  boundaries: number[];
  minWidth: number;
  lastCm: number;
  /** reorder: insertion slot under the pointer (kept here, React state may lag behind pointerup) */
  slot: number;
}

export function RayScene(props: {
  active?: boolean;
  /** Leading scene switch, always available even while the simulation is inactive. */
  viewTools?: ReactNode;
  params: SceneParams;
  pal: Palette;
  playing: boolean;
  lang: Lang;
  fmtNum: (v: number, d?: number) => string;
  onSelect: (i: number) => void;
  /** reorder: move layer `from` to position `to` (same state update as the panel) */
  onMove: (from: number, to: number) => void;
  /** set the thickness (cm) of layer `index` (same state update as the panel) */
  onResize: (index: number, cm: number) => void;
  /** Extra simulation controls (e.g. the Flat / Profiled R/T switch). */
  tools?: ReactNode;
}) {
  const active = props.active ?? true;
  const ref = useRef<HTMLCanvasElement>(null);
  const dprCap = useAdaptiveDprCap(active);
  const size = useCanvasSize(ref, dprCap);
  const [hover, setHover] = useState(-1);
  const [view, setView] = useState<"wave" | "spatial">("wave");
  const [display, setDisplay] = useState<SceneOptions["display"]>("both");
  const [reflections, setReflections] = useState(true);
  const [annotations, setAnnotations] = useState(true);
  const [orbit, setOrbit] = useState({ az: 0.45, el: 0.45 });
  const [speed, setSpeed] = useState(1);
  // drag affordances: `edge` = hovered boundary (Section), `dragUi` = active reorder / resize
  const [edge, setEdge] = useState(0);
  const [cursor, setCursor] = useState("");
  const [dragUi, setDragUi] = useState<DragUi | null>(null);
  const live = useRef({ ...props, view, display, annotations, orbit, speed, hover, reflections, edge, dragUi });
  live.current = { ...props, view, display, annotations, orbit, speed, hover, reflections, edge, dragUi };
  const clock = useRef(0);
  const introStart = useRef<number | null>(null);
  const drag = useRef<Gesture | null>(null);
  const layout = useRef<SceneLayout>({ rects: [] });
  const french = props.lang === "fr";

  // keyboard bridge: App owns the global shortcuts, RayScene owns view/display
  // state — "waves:set-view"/"waves:set-display" events connect the two
  useEffect(() => {
    const onView = (e: Event) => {
      if (!active) return;
      const v = (e as CustomEvent).detail;
      if (v === "wave" || v === "spatial") setView(v);
      else setView((cur) => (cur === "wave" ? "spatial" : "wave"));
    };
    const onDisplay = (e: Event) => {
      if (!active) return;
      const d = (e as CustomEvent).detail;
      if (d === "field" || d === "fronts" || d === "both") setDisplay(d);
    };
    window.addEventListener("waves:set-view", onView);
    window.addEventListener("waves:set-display", onDisplay);
    return () => {
      window.removeEventListener("waves:set-view", onView);
      window.removeEventListener("waves:set-display", onDisplay);
    };
  }, [active]);

  useEffect(() => {
    const canvas = ref.current;
    if (!active || !canvas || size.w === 0) return;
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();
    let previous: typeof live.current | null = null;
    if (introStart.current === null) introStart.current = last;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = now - last;
      const dt = Math.min(0.05, elapsed / 1000);
      last = now;
      if (document.hidden) return;
      const cur = live.current;
      const moving = cur.playing && !motionPreference.matches;
      const intro = motionPreference.matches ? 1 : Math.min(1, (now - (introStart.current ?? now)) / 1000);
      if (!moving && intro === 1 && previous === cur) return;
      previous = cur;
      if (moving) clock.current += dt * cur.speed;
      const ctx = prepCanvas(canvas, size);
      if (!ctx) return;
      const parameters = { ...cur.params, hover: cur.hover };
      layout.current = cur.view === "spatial"
        ? drawSpatialScene(ctx, size.w, size.h, clock.current, intro, parameters, cur.pal, cur.fmtNum, { display: cur.display, annotations: cur.annotations, az: cur.orbit.az, el: cur.orbit.el, lang: cur.lang })
        : drawWaveRays(ctx, size.w, size.h, clock.current, parameters, cur.pal, cur.fmtNum, { display: cur.display, reflections: cur.reflections, annotations: cur.annotations, lang: cur.lang });
      // drag affordances: only while a boundary is hovered or a drag is active
      if (cur.dragUi || cur.edge > 0) {
        ctx.save();
        drawDragOverlay(ctx, cur.view, layout.current, cur.dragUi, cur.edge, cur.params.layers, cur.pal, cur.fmtNum, size.w);
        ctx.restore();
      }
      recordFrame(elapsed, { dpr: size.dpr, width: canvas.width, height: canvas.height });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, active]);

  // wider grab band for touch / pen and on coarse-pointer devices
  const coarse = useRef<MediaQueryList | null>(null);
  const bandOf = (event: { pointerType: string }) => {
    coarse.current ??= window.matchMedia("(pointer: coarse)");
    return event.pointerType !== "mouse" || coarse.current.matches ? EDGE_BAND.coarse : EDGE_BAND.fine;
  };

  /** end the gesture; `revert` restores the thickness a resize started from */
  const cancelDrag = useCallback((revert: boolean) => {
    const g = drag.current;
    drag.current = null;
    if (g?.mode === "resize" && g.moved && revert && g.lastCm !== g.startCm) live.current.onResize(g.index, g.startCm);
    setDragUi(null);
    setCursor("");
  }, []);

  useEffect(() => {
    if (active) return;
    const pointerId = drag.current?.id;
    cancelDrag(true);
    if (pointerId !== undefined && ref.current?.hasPointerCapture(pointerId)) ref.current.releasePointerCapture(pointerId);
    setHover(-1);
    setEdge(0);
  }, [active, cancelDrag]);

  // Escape cancels an active drag (capture phase, so App's own Escape handling,
  // e.g. leaving present mode, does not also fire)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !drag.current?.moved || drag.current.mode === "orbit") return;
      e.stopPropagation();
      e.preventDefault();
      cancelDrag(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancelDrag]);

  /** hover feedback: boundary highlight and cursor (no gesture running) */
  const hoverAt = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointOf(event);
    const lay = layout.current;
    let nextEdge = 0;
    if (view === "wave" && lay.boundaries && inWallBand(lay, point)) nextEdge = Math.max(0, hitBoundary(point.x, lay.boundaries, bandOf(event)));
    if (live.current.params.layers[nextEdge - 1]?.readOnlyThickness) nextEdge = 0;
    const h = hitLayer(lay, point);
    setHover(h.index);
    setEdge(nextEdge);
    setCursor(nextEdge > 0 ? "is-resize" : h.index < 0 ? "" : h.tile ? "is-pointer" : "is-grab");
  };

  return <>
    <canvas
      ref={ref}
      className={`om-canvas ${cursor}`}
      style={{ display: active ? "block" : "none" }}
      aria-label={DICTS[props.lang].canvasAria}
      role="img"
      onPointerMove={event => {
        const g = drag.current;
        if (!g) { hoverAt(event); return; }
        if (g.id !== event.pointerId) return;
        const z = cssZoom();
        const dx = (event.clientX - g.x) / z;
        const dy = (event.clientY - g.y) / z;
        if (g.mode === "orbit") {
          if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) g.moved = true;
          if (g.moved) {
            setOrbit(o => ({
              // bounded orbit range kept as before (no behaviour change)
              az: clamp(o.az + dx * 0.005, -0.35, 1.15),
              el: clamp(o.el + dy * 0.004, 0.15, 0.85),
            }));
            g.x = event.clientX;
            g.y = event.clientY;
          }
          return;
        }
        if (g.mode === "click") return;
        // reorder / resize: totals since the press, in layout px
        const tx = pointOf(event).x - g.start.x;
        const ty = pointOf(event).y - g.start.y;
        if (!g.moved) {
          if (Math.hypot(tx, ty) <= DRAG_THRESHOLD) return;
          g.moved = true;
          setCursor(g.mode === "resize" ? "is-resize" : "is-grabbing");
          // the panel edits the selected layer: grabbing a layer selects it
          props.onSelect(g.index);
        }
        const lay = layout.current;
        if (g.mode === "resize") {
          const cm = thicknessFromBoundaryDrag({ cms: g.cms, index: g.index, boundaries: g.boundaries, minWidth: g.minWidth, dx: tx });
          if (cm !== g.lastCm) {
            g.lastCm = cm;
            live.current.onResize(g.index, cm);
          }
          setDragUi({ kind: "resize", index: g.index, slot: 0, dx: tx, dy: ty });
          return;
        }
        const point = pointOf(event);
        const slot = view === "spatial" && lay.slots ? nearestSlot(point, lay.slots) : dropSlot(point.x, lay.boundaries ?? []);
        g.slot = slot;
        setDragUi({ kind: "reorder", index: g.index, slot, dx: tx, dy: ty });
      }}
      onPointerLeave={() => {
        if (drag.current?.moved) return; // captured: the gesture keeps going outside the canvas
        setHover(-1);
        setEdge(0);
        setCursor("");
        drag.current = null;
      }}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = pointOf(event);
        const lay = layout.current;
        const g: Gesture = {
          id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, mode: view === "spatial" ? "orbit" : "click",
          index: -1, start: point, startCm: 0, cms: [], boundaries: [], minWidth: 0, lastCm: 0, slot: -1,
        };
        if (event.button === 0 || event.pointerType !== "mouse") {
          if (view === "wave" && lay.boundaries && inWallBand(lay, point)) {
            const j = hitBoundary(point.x, lay.boundaries, bandOf(event));
            if (j > 0 && !live.current.params.layers[j - 1]?.readOnlyThickness) {
              const cms = live.current.params.layers.map(l => l.cm);
              Object.assign(g, { mode: "resize", index: j - 1, cms, boundaries: lay.boundaries.slice(), minWidth: lay.minWidth ?? 0, startCm: cms[j - 1], lastCm: cms[j - 1] });
            }
          }
          if (g.mode !== "resize") {
            const h = hitLayer(lay, point);
            if (h.index >= 0 && !h.tile) Object.assign(g, { mode: "reorder", index: h.index });
          }
        }
        drag.current = g;
      }}
      onPointerUp={event => {
        const g = drag.current;
        if (!g || g.id !== event.pointerId) return;
        drag.current = null;
        setDragUi(null);
        setCursor("");
        if (g.mode === "reorder" && g.moved) {
          if (g.slot >= 0 && !isNoopDrop(g.index, g.slot)) props.onMove(g.index, slotToIndex(g.index, g.slot));
          return;
        }
        if (g.mode === "resize" && g.moved) return;
        if (!g.moved) {
          const h = hitLayer(layout.current, pointOf(event));
          if (h.index >= 0) props.onSelect(h.index);
        }
      }}
      onPointerCancel={() => cancelDrag(true)}
    />
    <div className="om-scene-toolbar" data-view={active ? view : "lab"} aria-label={french ? "Affichage de la simulation" : "Simulation display"}>
      <div className="om-scene-tool-group om-scene-view-tools" role="group" aria-label={french ? "Scène et vue" : "Scene and view"}>
      <span className="om-scene-tool-label">{french ? "Scène / vue" : "Scene / view"}</span>
      {props.viewTools}
      {active && <>
      <div className="om-view-modes" role="group" aria-label={french ? "Vue" : "View"}>
        <button type="button" aria-pressed={view === "wave"} className={view === "wave" ? "is-on" : ""} onClick={() => setView("wave")}>{french ? "Coupe" : "Section"}</button>
        <button type="button" aria-pressed={view === "spatial"} className={view === "spatial" ? "is-on" : ""} onClick={() => setView("spatial")}>Spatial</button>
      </div>
      {props.tools}
      </>}
      </div>
      {active && <div className="om-scene-tool-group om-scene-display-tools" role="group" aria-label={french ? "Options d’affichage" : "Display utilities"}>
      <span className="om-scene-tool-label">{french ? "Affichage" : "Display"}</span>
      {view === "wave" && <>
        <div className="om-view-modes" role="group" aria-label={french ? "Dessin des ondes" : "Wave drawing"}>
          {(["field", "fronts", "both"] as const).map(mode => <button key={mode} type="button" aria-pressed={display === mode} className={display === mode ? "is-on" : ""} onClick={() => setDisplay(mode)}>{mode === "field" ? (french ? "Courbes" : "Curves") : mode === "fronts" ? (french ? "Crêtes" : "Crests") : (french ? "Les deux" : "Both")}</button>)}
        </div>
        <label className="om-scene-camera om-field-envelope"><input type="checkbox" checked={reflections} onChange={event => setReflections(event.target.checked)} /><span>{french ? "Reflets internes" : "Internal reflections"}</span></label>
      </>}
      {view === "spatial" && <>
        <div className="om-view-modes" role="group" aria-label={french ? "Visualisation des ondes" : "Wave visualization"}>
          {(["field", "fronts", "both"] as const).map(mode => <button key={mode} type="button" aria-pressed={display === mode} className={display === mode ? "is-on" : ""} onClick={() => setDisplay(mode)}>{mode === "field" ? (french ? "Champ" : "Field") : mode === "fronts" ? (french ? "Fronts" : "Fronts") : (french ? "Les deux" : "Both")}</button>)}
        </div>
        <button type="button" className="om-scene-toggle" onClick={() => setOrbit({ az: 0.45, el: 0.45 })}>{french ? "Recentrer" : "Reset view"}</button>
      </>}
      <button type="button" className="om-scene-toggle" aria-pressed={annotations} onClick={() => setAnnotations(value => !value)}>{french ? "Repères" : "Labels"}</button>
      <button type="button" className="om-scene-toggle om-scene-speed" aria-label={french ? `Vitesse visuelle : ${speed} fois. Changer la vitesse.` : `Visual speed: ${speed} times. Change speed.`} onClick={() => setSpeed(value => value === 0.5 ? 1 : value === 1 ? 2 : 0.5)}>{props.fmtNum(speed, speed === 0.5 ? 1 : 0)}×</button>
      <button
        type="button"
        className="om-scene-toggle"
        title={french ? "Télécharger la scène en image PNG" : "Download the scene as a PNG image"}
        aria-label={french ? "Télécharger la scène en image PNG" : "Download the scene as a PNG image"}
        onClick={() => {
          const canvas = ref.current;
          if (!canvas || canvas.width < 2) return;
          // the live canvas is transparent (stage colour comes from CSS):
          // composite over the palette stage colour so the file looks like the app
          const out = document.createElement("canvas");
          out.width = canvas.width;
          out.height = canvas.height;
          const octx = out.getContext("2d");
          if (!octx) return;
          octx.fillStyle = props.pal.bg0;
          octx.fillRect(0, 0, out.width, out.height);
          octx.drawImage(canvas, 0, 0);
          void downloadFile(out.toDataURL("image/png"), `waves-${props.params.freq}GHz-${props.params.theta}deg-${props.params.pol}-${view}.png`);
        }}
      >
        PNG
      </button>
      </div>}
    </div>
  </>;
}
