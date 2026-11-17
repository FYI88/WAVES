import { useEffect, useRef } from "react";
import { drawMaterialSurface } from "../materialSurfaces";
import { matSwatch, type LayerMat } from "../state/layers";

/** Offline material sample, using the same textures as the simulation. */
export function MaterialThumb({ material }: { material: LayerMat }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 128, 72);
    drawMaterialSurface(ctx, material, [{ x: 0, y: 0 }, { x: 128, y: 0 }, { x: 128, y: 72 }, { x: 0, y: 72 }], 128, 72, false, 1, material === "plywood");
  }, [material]);
  return <span className={`om-material-thumb is-${material}`} style={{ background: matSwatch(material) }} aria-hidden="true">
    <canvas ref={ref} width={128} height={72} />
    {material === "glass" && <svg viewBox="0 0 128 72"><path d="M15 60 40 12h66L81 60Z" fill="#bce9ef" fillOpacity=".65" stroke="#fff" strokeWidth="2" /><path d="m47 18-18 35m32-35-8 16" stroke="#fff" strokeWidth="4" /></svg>}
    {material === "custom" && <span className="om-thumb-symbol">ε · σ</span>}
    {material === "air" && <span className="om-thumb-symbol">≈</span>}
  </span>;
}
