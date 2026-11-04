/* ════════════════════════════════════════════════════════════════════════
   Theme palette (canvas)
   ════════════════════════════════════════════════════════════════════════ */

export type Theme = "dark" | "light";

export interface Palette {
  dark: boolean;
  bg0: string;
  bg1: string;
  dot: string;
  grid: string;
  gridStrong: string;
  ink: string;
  muted: string;
  faint: string;
  inc: string;
  ref: string;
  tra: string;
  abs: string;
  acc: string;
  label: string;
  labelBorder: string;
}

export const PALETTES: Record<Theme, Palette> = {
  dark: {
    dark: true,
    bg0: "#0b0d12",
    bg1: "#080e17",
    dot: "rgba(180,205,225,0.06)",
    grid: "rgba(180,205,225,0.07)",
    gridStrong: "rgba(180,205,225,0.16)",
    ink: "#edf4fc",
    muted: "#b4c3d5",
    faint: "#94a6bc",
    inc: "#55dbf5",
    ref: "#ff9586",
    tra: "#79e2bc",
    abs: "#edc17f",
    acc: "#55dbf5",
    label: "rgba(12,21,33,0.94)",
    labelBorder: "rgba(180,205,225,0.16)",
  },
  light: {
    dark: false,
    bg0: "#f4f5f7",
    bg1: "#edf2f6",
    dot: "rgba(22,41,57,0.08)",
    grid: "rgba(22,41,57,0.07)",
    gridStrong: "rgba(22,41,57,0.16)",
    ink: "#162939",
    muted: "#40596e",
    faint: "#50687c",
    // the original soft wave tones, same hues as dark; canvas text darkens them itself
    inc: "#55dbf5",
    ref: "#ff9586",
    tra: "#79e2bc",
    abs: "#8d5b13",
    acc: "#006b86",
    label: "rgba(255,255,255,0.94)",
    labelBorder: "rgba(22,41,57,0.12)",
  },
};

export const withAlpha = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/* Canvas palette: the scene draws from these per-theme constants only.
   DOM accents live in the CSS --om-* tokens; the two are kept in sync by
   hand, but the canvas must never depend on a stale DOM read. */
export const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const SANS = '"Inter Tight", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
