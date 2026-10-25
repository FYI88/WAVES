import { useState } from "react";

/* Inline SVG glyphs and the brand mark, shared by the whole UI. */

export function Logo() {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <span className="om-logo om-logo-fallback" aria-hidden>
        OM
      </span>
    );
  }
  return <img className="om-logo" src="logo.png" alt="" aria-hidden onError={() => setOk(false)} />;
}

export const Icon = {
  play: (
    <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" /></svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden><rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" /><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" /></svg>
  ),
  sun: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></svg>
  ),
  thick: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="18" rx="1.5" /><path d="M3 12h4M17 12h4M5 10l-2 2 2 2M19 10l2 2-2 2" /></svg>
  ),
  freq: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 12c1.5-5 3-5 4.5 0s3 5 4.5 0 2-6 3.5 0 2 6 3.5 0 2-4 4-0" /></svg>
  ),
  angle: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20h16M4 20 16 6" /><path d="M10 20a6 6 0 0 0-1.6-4.2" /></svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" /></svg>
  ),
  pol: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="3" /></svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  up: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
  ),
  down: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12 .5C5.73.5.5 5.74.5 12.02c0 5.1 3.29 9.42 7.86 10.95.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.35.95.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 2.87-.39c.97 0 1.95.13 2.87.39 2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.67.8.56A11.53 11.53 0 0 0 23.5 12C23.5 5.74 18.27.5 12 .5Z" /></svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4.5 7.5 7.5 5.5 7.5-5.5" /></svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17h.01" strokeLinecap="round" /></svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
  ),
  surface: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18h4v-6h4v6h4v-6h4v6h2" /></svg>
  ),
  medium: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3c3.5 4.2 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-5.8 6-10Z" /></svg>
  ),
  calc: (
    <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 5H7l6 7-6 7h11" /></svg>
  ),
};

