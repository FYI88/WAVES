import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { PolMode, Sweep } from "../physics";
import { clamp } from "../render/util";
import { withAlpha, type Palette } from "../theme";
import { cssZoom, prepCanvas, useCanvasSize } from "../scene/canvas";
import { PAD, dot, drawAxes, pill, strokeCurve, tooltip } from "./draw";

/** R / T versus incidence angle; click or drag to set the angle. */
export function AngleChart(props: {
  sweep: Sweep;
  pol: PolMode;
  angle: number;
  brewster: number;
  pal: Palette;
  labels: { R: string; T: string };
  onAngle: (a: number) => void;
  fmtNum: (v: number, d?: number) => string;
}) {
  const { sweep, pol, angle, brewster, pal, labels, onAngle, fmtNum } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const xMap = useCallback((a: number) => PAD.l + (a / 90) * (size.w - PAD.l - PAD.r), [size.w]);
  const yMap = useCallback((v: number) => PAD.t + (1 - v) * (size.h - PAD.t - PAD.b), [size.h]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const ctx = prepCanvas(canvas, size);
    if (!ctx) return;
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    drawAxes(
      ctx, w, h, pal,
      [0, 15, 30, 45, 60, 75, 90].map((v) => ({ v, label: `${v}°` })),
      [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, label: `${v * 100}%` })),
      xMap, yMap,
    );
    const xs = sweep.ang.map(xMap);
    const pick = (mode: PolMode) => {
      if (mode === "TE") return { R: sweep.Rte, T: sweep.Tte };
      if (mode === "TM") return { R: sweep.Rtm, T: sweep.Ttm };
      return {
        R: sweep.Rte.map((v, i) => (v + sweep.Rtm[i]) / 2),
        T: sweep.Tte.map((v, i) => (v + sweep.Ttm[i]) / 2),
      };
    };
    const ghosts: PolMode[] = pol === "AVG" ? ["TE", "TM"] : [pol === "TE" ? "TM" : "TE"];
    for (const gm of ghosts) {
      const gd = pick(gm);
      strokeCurve(ctx, xs, gd.R.map(yMap), pal.ref, 1.2, pal, { dash: [3, 4], alpha: 0.4 });
      strokeCurve(ctx, xs, gd.T.map(yMap), pal.tra, 1.2, pal, { dash: [3, 4], alpha: 0.4 });
    }
    const main = pick(pol);
    const base = yMap(0);
    strokeCurve(ctx, xs, main.T.map(yMap), pal.tra, 2.4, pal, { fillTo: base, glow: true });
    strokeCurve(ctx, xs, main.R.map(yMap), pal.ref, 2.4, pal, { fillTo: base, glow: true });

    // Brewster marker (selected layer)
    const bx = xMap(brewster);
    if (brewster >= 0) {
    ctx.save();
    ctx.strokeStyle = withAlpha(pal.acc, 0.8);
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(bx, PAD.t);
    ctx.lineTo(bx, h - PAD.b);
    ctx.stroke();
    ctx.restore();
    pill(ctx, `θB ${fmtNum(brewster, 1)}°`, bx, PAD.t + 12, pal, pal.acc);
    }

    const interp = (arr: number[], a: number) => {
      const i = clamp(a / 0.5, 0, arr.length - 1);
      const i0 = Math.floor(i);
      const i1 = Math.min(arr.length - 1, i0 + 1);
      return arr[i0] + (arr[i1] - arr[i0]) * (i - i0);
    };

    // current angle
    const cxp = xMap(angle);
    ctx.save();
    const lg = ctx.createLinearGradient(0, PAD.t, 0, h - PAD.b);
    lg.addColorStop(0, withAlpha(pal.inc, 0));
    lg.addColorStop(0.5, withAlpha(pal.inc, 0.8));
    lg.addColorStop(1, withAlpha(pal.inc, 0.2));
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cxp, PAD.t);
    ctx.lineTo(cxp, h - PAD.b);
    ctx.stroke();
    ctx.restore();
    dot(ctx, cxp, yMap(interp(main.R, angle)), pal.ref, pal);
    dot(ctx, cxp, yMap(interp(main.T, angle)), pal.tra, pal);

    if (hover !== null) {
      const hx = xMap(hover);
      ctx.save();
      ctx.strokeStyle = pal.gridStrong;
      ctx.beginPath();
      ctx.moveTo(hx, PAD.t);
      ctx.lineTo(hx, h - PAD.b);
      ctx.stroke();
      ctx.restore();
      const rv = interp(main.R, hover);
      const tv = interp(main.T, hover);
      tooltip(ctx, hx, yMap((rv + tv) / 2), w, [
        { text: `θ  ${fmtNum(hover, 1)}°`, color: pal.inc },
        { text: `${labels.R}  ${fmtNum(rv * 100, 1)} %`, color: pal.ref },
        { text: `${labels.T}  ${fmtNum(tv * 100, 1)} %`, color: pal.tra },
      ], pal);
    }
  }, [sweep, pol, angle, brewster, pal, size, hover, xMap, yMap, labels, fmtNum]);

  const angleFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / cssZoom();
    const a = ((x - PAD.l) / Math.max(1, size.w - PAD.l - PAD.r)) * 90;
    return Math.round(clamp(a, 0, 89) * 2) / 2;
  };

  return (
    <canvas
      ref={ref}
      className="om-canvas om-canvas-interactive"
      role="img"
      aria-label="Reflection and transmission versus incidence angle"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onAngle(angleFromEvent(e));
      }}
      onPointerMove={(e) => {
        const a = angleFromEvent(e);
        setHover(a);
        if (dragging.current) onAngle(a);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerLeave={() => {
        if (!dragging.current) setHover(null);
      }}
    />
  );
}
