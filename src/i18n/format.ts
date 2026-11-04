import type { Lang } from "./index";

export const tpl = (s: string, vars: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

export function makeFmt(lang: Lang) {
  const loc = lang === "fr" ? "fr-FR" : "en-US";
  const num = (v: number, digits = 1) =>
    Number.isFinite(v)
      ? v.toLocaleString(loc, { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "∞";
  const sig = (v: number, digits = 3) => {
    if (!Number.isFinite(v)) return "∞";
    if (v === 0) return "0";
    const abs = Math.abs(v);
    if (abs >= 1e4 || abs < 1e-3) {
      const e = Math.floor(Math.log10(abs));
      const m = v / Math.pow(10, e);
      return `${m.toLocaleString(loc, { maximumFractionDigits: 2 })}×10${superscript(e)}`;
    }
    return v.toLocaleString(loc, { maximumSignificantDigits: digits });
  };
  const len = (m: number) => {
    if (!Number.isFinite(m)) return "∞";
    if (m < 0.01) return `${num(m * 1000, m < 0.001 ? 2 : 1)} mm`;
    if (m < 1) return `${num(m * 100, m < 0.1 ? 2 : 1)} cm`;
    if (m < 1000) return `${num(m, m < 10 ? 2 : 1)} m`;
    return `${num(m / 1000, 1)} km`;
  };
  const pct = (v: number) => {
    const p = v * 100;
    return num(p, p < 0.1 && p > 0 ? 3 : p < 10 ? 2 : 1);
  };
  return { num, sig, len, pct };
}

export type Fmt = ReturnType<typeof makeFmt>;

export function superscript(n: number): string {
  const map: Record<string, string> = {
    "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return String(n).split("").map((c) => map[c] ?? c).join("");
}

export function bandName(f: number): string {
  if (f < 1) return "UHF";
  if (f < 2) return "L";
  if (f < 4) return "S";
  if (f < 8) return "C";
  if (f < 12) return "X";
  if (f < 18) return "Ku";
  if (f < 27) return "K";
  return "Ka";
}
