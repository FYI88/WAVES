import { clamp } from "../render/util";

export function Ring({ value, color }: { value: number; color: string }) {
  const c = 2 * Math.PI * 30;
  return <svg className="om-ring" viewBox="0 0 76 76" aria-hidden>
    <circle cx="38" cy="38" r={30} className="om-ring-track" />
    <circle cx="38" cy="38" r={30} className="om-ring-val" style={{ stroke: color, strokeDasharray: `${clamp(value, 0, 1) * c} ${c}` }} />
  </svg>;
}
