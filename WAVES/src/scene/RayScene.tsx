import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { drawSpatialScene, type SceneOptions } from "../spatialScene";
import { drawWaveRays } from "../waveRays";
import { recordFrame } from "../perf";
import { clamp } from "../render/util";
import type { Cx, PolMode } from "../physics";
import type { Lang } from "../i18n";
import type { Palette } from "../theme";
import type { LayerMat } from "../state/layers";
import { cssZoom, prepCanvas, useCanvasSize } from "./canvas";

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

interface SceneLayout {
  rects: { x0: number; x1: number; y0: number; y1: number }[];
  polygons?: { x: number; y: number }[][];
  /** back-to-front draw order of `polygons` (spatial view) */
  order?: number[];
  tiles?: { x0: number; x1: number; y0: number; y1: number; index: number }[];
}

export function RayScene(props: {
  params: SceneParams;
  pal: Palette;
  playing: boolean;
  lang: Lang;
  fmtNum: (v: number, d?: number) => string;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const [hover, setHover] = useState(-1);
  const [view, setView] = useState<"wave" | "spatial">("wave");
  const [display, setDisplay] = useState<SceneOptions["display"]>("both");
  const [reflections, setReflections] = useState(true);
  const [annotations, setAnnotations] = useState(true);
  const [orbit, setOrbit] = useState({ az: 0.45, el: 0.45 });
  const [speed, setSpeed] = useState(1);
  const live = useRef({ ...props, view, display, annotations, orbit, speed, hover, reflections });
  live.current = { ...props, view, display, annotations, orbit, speed, hover, reflections };
  const clock = useRef(0);
  const introStart = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const layout = useRef<SceneLayout>({ rects: [] });
  const french = props.lang === "fr";

  // keyboard bridge: App owns the global shortcuts, RayScene owns view/display
  // state — "waves:set-view"/"waves:set-display" events connect the two
  useEffect(() => {
    const onView = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "wave" || v === "spatial") setView(v);
      else setView((cur) => (cur === "wave" ? "spatial" : "wave"));
    };
    const onDisplay = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d === "field" || d === "fronts" || d === "both") setDisplay(d);
    };
    window.addEventListener("waves:set-view", onView);
    window.addEventListener("waves:set-display", onDisplay);
    return () => {
      window.removeEventListener("waves:set-view", onView);
      window.removeEventListener("waves:set-display", onDisplay);
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
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
      recordFrame(elapsed, { dpr: size.dpr, width: canvas.width, height: canvas.height });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const hit = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const z = cssZoom();
    const point = { x: (event.clientX - bounds.left) / z, y: (event.clientY - bounds.top) / z };
    const tile = layout.current.tiles?.find(item => point.x >= item.x0 && point.x <= item.x1 && point.y >= item.y0 && point.y <= item.y1);
    if (tile) return tile.index;
    const polygons = layout.current.polygons;
    if (polygons) {
      // topmost first: walk the draw order backwards
      const order = layout.current.order ?? polygons.map((_, index) => index);
      for (let rank = order.length - 1; rank >= 0; rank--) {
        const index = order[rank];
        const polygon = polygons[index];
        let inside = false;
        for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
          const left = polygon[current];
          const right = polygon[previous];
          if ((left.y > point.y) !== (right.y > point.y) && point.x < (right.x - left.x) * (point.y - left.y) / (right.y - left.y) + left.x) inside = !inside;
        }
        if (inside) return index;
      }
      return -1;
    }
    return layout.current.rects.findIndex(rect => point.x >= rect.x0 - 3 && point.x <= rect.x1 + 3 && point.y >= rect.y0 - 6 && point.y <= rect.y1 + 4);
  };

  return <>
    <canvas
      ref={ref}
      className={`om-canvas ${hover >= 0 ? "is-pointer" : ""}`}
      aria-label={french ? "Simulation : onde incidente, milieux, réflexion et transmission. Sélectionnez un milieu dans la liste pour le modifier." : "Simulation: incident wave, media, reflection and transmission. Select a medium in the layer list to edit it."}
      role="img"
      onPointerMove={event => {
        setHover(hit(event));
        const d = drag.current;
        if (d && view === "spatial") {
          const dx = (event.clientX - d.x) / cssZoom();
          const dy = (event.clientY - d.y) / cssZoom();
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) {
            setOrbit(o => ({
              // bounded orbit range kept as before (no behaviour change)
              az: clamp(o.az + dx * 0.005, -0.35, 1.15),
              el: clamp(o.el + dy * 0.004, 0.15, 0.85),
            }));
            d.x = event.clientX;
            d.y = event.clientY;
          }
        }
      }}
      onPointerLeave={() => { setHover(-1); drag.current = null; }}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerUp={event => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          const index = hit(event);
          if (index >= 0) props.onSelect(index);
        }
      }}
    />
    <div className="om-scene-toolbar" data-view={view} aria-label={french ? "Affichage de la simulation" : "Simulation display"}>
      <div className="om-view-modes" role="group" aria-label={french ? "Vue" : "View"}>
        <button type="button" aria-pressed={view === "wave"} className={view === "wave" ? "is-on" : ""} onClick={() => setView("wave")}>{french ? "Coupe" : "Section"}</button>
        <button type="button" aria-pressed={view === "spatial"} className={view === "spatial" ? "is-on" : ""} onClick={() => setView("spatial")}>Spatial</button>
      </div>
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
          const a = document.createElement("a");
          a.download = `waves-${props.params.freq}GHz-${props.params.theta}deg-${props.params.pol}-${view}.png`;
          a.href = out.toDataURL("image/png");
          a.click();
        }}
      >
        PNG
      </button>
    </div>
  </>;
}
