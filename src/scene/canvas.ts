import { useEffect, useState, type RefObject } from "react";
import { readPerf, resetPerf } from "../perf";

/* ════════════════════════════════════════════════════════════════════════
   Canvas helpers (sizing / DPR)
   ════════════════════════════════════════════════════════════════════════ */

export interface CanvasSize {
  w: number;
  h: number;
  dpr: number;
}

export function cssZoom(): number {
  if (typeof document === "undefined") return 1;
  const z = parseFloat(getComputedStyle(document.body).zoom || "1");
  return z > 0 && Number.isFinite(z) ? z : 1;
}

const DPR_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;
const DPR_STORAGE_KEY = "waves:dprCap";

/** Keep the Android build's remembered, performance-adaptive resolution. */
export function useAdaptiveDprCap(active = true): number {
  const [cap, setCap] = useState(() => {
    try {
      const value = Number(window.localStorage.getItem(DPR_STORAGE_KEY));
      if ((DPR_STEPS as readonly number[]).includes(value)) return value;
    } catch { /* storage unavailable */ }
    return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2;
  });
  useEffect(() => {
    if (!active) return;
    let goodWindows = 0;
    const settledAt = performance.now();
    const timer = window.setInterval(() => {
      if (performance.now() - settledAt < 3000) return;
      const { p95, idle } = readPerf();
      if (idle || p95 <= 0) { goodWindows = 0; return; }
      const index = (DPR_STEPS as readonly number[]).indexOf(cap);
      let next = cap;
      if (p95 > 22 && index > 0) next = DPR_STEPS[index - 1];
      else if (p95 < 14) {
        if (++goodWindows >= 3 && index < DPR_STEPS.length - 1) next = DPR_STEPS[index + 1];
      } else goodWindows = 0;
      if (next === cap) return;
      setCap(next);
      try { window.localStorage.setItem(DPR_STORAGE_KEY, String(next)); } catch { /* storage unavailable */ }
      resetPerf();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, cap]);
  return cap;
}

export function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>, dprCap = 2): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      // getBoundingClientRect is already shrunk by page zoom: size the drawing
      // in layout px so zoom is a uniform optical shrink. The renderers (their
      // `compact` branches and absolute-px constants like lambdaPx) then behave
      // exactly as at zoom 1.
      const z = cssZoom();
      const w = r.width / z;
      const h = r.height / z;
      setSize((prev) =>
        prev.w === w && prev.h === h && prev.dpr === dpr
          ? prev
          : { w, h, dpr },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, dprCap]);
  return size;
}

export function prepCanvas(canvas: HTMLCanvasElement, size: CanvasSize) {
  const W = Math.max(1, Math.round(size.w * size.dpr));
  const H = Math.max(1, Math.round(size.h * size.dpr));
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  return ctx;
}
