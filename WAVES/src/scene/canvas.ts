import { useEffect, useState, type RefObject } from "react";

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

export function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
  }, [ref]);
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
