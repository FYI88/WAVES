import { useEffect, useMemo, useRef, useState } from "react";
import { C0, DEG, stackFieldAbs, type Cx, type PolMode } from "../physics";
import { MONO, withAlpha, type Palette } from "../theme";
import { cssZoom, prepCanvas, useCanvasSize } from "../scene/canvas";
import { PAD, dot, drawAxes, mixHex, strokeCurve, tooltip } from "./draw";

/** Tangential field magnitude |E(z)| through the stack (air | layers | air). */
export function FieldChart(props: {
  etas: Cx[];
  ds: number[];
  freq: number;
  angle: number;
  pol: PolMode;
  scaleMode: "lin" | "db";
  pal: Palette;
  bands: { tint: string; label: string; air: boolean }[];
  labels: { air: string };
  fmtNum: (v: number, d?: number) => string;
}) {
  const { etas, ds, freq, angle, pol, scaleMode, pal, bands, labels, fmtNum } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const [hover, setHover] = useState<number | null>(null);

  const domain = useMemo(() => {
    const d = ds.reduce((a, b) => a + b, 0);
    const lam = C0 / (freq * 1e9);
    const air = Math.max(0.5 * d, Math.min(1.5 * lam, 3 * d + 0.02));
    return { d, zMin: -air, zMax: d + air };
  }, [ds, freq]);

  const samples = useMemo(() => {
    const n = Math.max(600, Math.round((size.w || 600) * 5));
    const f = stackFieldAbs(etas, ds, freq, angle * DEG, pol);
    const z: number[] = [];
    const e: number[] = [];
    for (let i = 0; i <= n; i++) {
      const zz = domain.zMin + ((domain.zMax - domain.zMin) * i) / n;
      z.push(zz);
      e.push(f(zz));
    }
    return { z, e, f };
  }, [etas, ds, freq, domain, angle, pol, size.w]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w === 0) return;
    const ctx = prepCanvas(canvas, size);
    if (!ctx) return;
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);
    const { zMin, zMax, d } = domain;
    const xMap = (z: number) => PAD.l + ((z - zMin) / (zMax - zMin)) * (w - PAD.l - PAD.r);

    const vals = scaleMode === "db"
      ? samples.e.map((v) => Math.max(-80, 20 * Math.log10(Math.max(v, 1e-6))))
      : samples.e;
    const vMax = Math.max(...vals);
    const vMin = Math.min(...vals);
    let yLo: number;
    let yHi: number;
    let yTicks: number[];
    if (scaleMode === "db") {
      yHi = Math.max(10, Math.ceil((vMax + 3) / 10) * 10);
      yLo = Math.min(-20, Math.floor((vMin - 3) / 10) * 10);
      const span = yHi - yLo;
      const st = span > 60 ? 20 : 10;
      yTicks = [];
      for (let v = yLo; v <= yHi + 0.01; v += st) yTicks.push(v);
    } else {
      yLo = 0;
      yHi = Math.max(1.25, Math.ceil(vMax * 1.12 * 4) / 4);
      const st = yHi > 1.6 ? 0.5 : 0.25;
      yTicks = [];
      for (let v = 0; v <= yHi + 1e-9; v += st) yTicks.push(v);
    }
    const yMap = (v: number) => PAD.t + (1 - (v - yLo) / (yHi - yLo)) * (h - PAD.t - PAD.b);

    const N = bands.length;
    const zs = [0];
    ds.forEach((v, k) => zs.push(zs[k] + v));
    const wx0 = xMap(0);
    const wx1 = xMap(d);
    const colorOf = (r: number) =>
      r < 0 ? pal.inc : r >= N ? pal.tra : bands[r].air ? mixHex(pal.inc, pal.tra, 0.5) : pal.abs;
    const regionOf = (z: number) => {
      if (z < 0) return -1;
      if (z >= d) return N;
      let r = 0;
      while (r < N - 1 && z >= zs[r + 1]) r++;
      return r;
    };
    ctx.save();
    bands.forEach((b, k) => {
      const a = xMap(zs[k]);
      const c = xMap(zs[k + 1]);
      const al = b.air ? 0.45 : 1;
      const wg = ctx.createLinearGradient(a, 0, c, 0);
      wg.addColorStop(0, withAlpha(b.tint, (pal.dark ? 0.24 : 0.3) * al));
      wg.addColorStop(1, withAlpha(b.tint, (pal.dark ? 0.1 : 0.16) * al));
      ctx.fillStyle = wg;
      ctx.fillRect(a, PAD.t, Math.max(1, c - a), h - PAD.t - PAD.b);
      ctx.strokeStyle = withAlpha(b.tint, 0.75);
      ctx.lineWidth = 1;
      ctx.setLineDash(b.air ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(Math.round(a) + 0.5, PAD.t);
      ctx.lineTo(Math.round(a) + 0.5, h - PAD.b);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = withAlpha(bands[N - 1]?.tint ?? pal.abs, 0.75);
    ctx.beginPath();
    ctx.moveTo(Math.round(wx1) - 0.5, PAD.t);
    ctx.lineTo(Math.round(wx1) - 0.5, h - PAD.b);
    ctx.stroke();
    ctx.restore();

    // x ticks in cm
    const spanCm = (zMax - zMin) * 100;
    const raw = spanCm / 6;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepCm = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
    const xTicks: { v: number; label: string }[] = [];
    for (let c = Math.ceil((zMin * 100) / stepCm) * stepCm; c <= zMax * 100 + 1e-9; c += stepCm) {
      xTicks.push({ v: c / 100, label: `${fmtNum(c, stepCm < 1 ? 1 : 0)}` });
    }
    drawAxes(
      ctx, w, h, pal, xTicks,
      yTicks.map((v) => ({ v, label: scaleMode === "db" ? `${v}` : fmtNum(v, v % 1 === 0 ? 0 : 2) })),
      xMap, yMap,
    );
    ctx.save();
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = pal.faint;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("z (cm)", w - PAD.r, h - 2);
    ctx.restore();

    // reference |E| = 1
    const yRef = yMap(scaleMode === "db" ? 0 : 1);
    ctx.save();
    ctx.strokeStyle = withAlpha(pal.inc, 0.45);
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(PAD.l, yRef);
    ctx.lineTo(w - PAD.r, yRef);
    ctx.stroke();
    ctx.restore();

    const xs = samples.z.map(xMap);
    const ys = vals.map(yMap);
    // one coloured segment per region (air | layers | air)
    let start = 0;
    let cur = regionOf(samples.z[0]);
    for (let k = 1; k <= xs.length; k++) {
      const r = k < xs.length ? regionOf(samples.z[k]) : Infinity;
      if (r !== cur) {
        const b = Math.min(k, xs.length - 1);
        if (b > start) {
          strokeCurve(ctx, xs.slice(start, b + 1), ys.slice(start, b + 1), colorOf(cur), 1.8, pal, {
            fillTo: yMap(yLo),
            glow: true,
          });
        }
        start = Math.max(0, k - 1);
        cur = r;
      }
    }

    // region labels
    ctx.save();
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = pal.muted;
    ctx.fillText(labels.air, (PAD.l + wx0) / 2, PAD.t + 6);
    ctx.fillText(labels.air, (wx1 + w - PAD.r) / 2, PAD.t + 6);
    bands.forEach((b, k) => {
      const a = xMap(zs[k]);
      const c = xMap(zs[k + 1]);
      if (c - a < 22) return;
      ctx.fillStyle = b.air ? pal.muted : pal.ink;
      ctx.fillText(c - a > 70 ? b.label : `L${k + 1}`, (a + c) / 2, PAD.t + 6);
    });
    ctx.restore();

    if (hover !== null) {
      const z = zMin + ((hover - PAD.l) / (w - PAD.l - PAD.r)) * (zMax - zMin);
      if (z >= zMin && z <= zMax) {
        const v = samples.f(z);
        const yy = scaleMode === "db" ? yMap(Math.max(-80, 20 * Math.log10(Math.max(v, 1e-6)))) : yMap(v);
        ctx.save();
        ctx.strokeStyle = pal.gridStrong;
        ctx.beginPath();
        ctx.moveTo(hover, PAD.t);
        ctx.lineTo(hover, h - PAD.b);
        ctx.stroke();
        ctx.restore();
        const col = colorOf(regionOf(z));
        dot(ctx, hover, yy, col, pal);
        tooltip(ctx, hover, yy, w, [
          { text: `z  ${fmtNum(z * 100, 2)} cm`, color: col },
          { text: `|E|  ${fmtNum(v, 3)}  (${fmtNum(20 * Math.log10(Math.max(v, 1e-9)), 1)} dB)`, color: col },
        ], pal);
      }
    }
  }, [samples, domain, scaleMode, pal, bands, ds, size, hover, labels, fmtNum]);

  return (
    <canvas
      ref={ref}
      className="om-canvas om-canvas-interactive"
      role="img"
      aria-label="Field magnitude profile through the wall"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHover((e.clientX - r.left) / cssZoom());
      }}
      onPointerLeave={() => setHover(null)}
    />
  );
}
