import { cssZoom } from "./canvas";

/* ════════════════════════════════════════════════════════════════════════
   Frame height: the visible height of the scrolling app frame
   (`main.om-layout`), published as the CSS variable `--om-frame-h` in layout
   px. The sticky desktop sidebar caps its height with it, so it scrolls on
   its own and its last control (Reset) is always reachable, whatever the
   header height. getBoundingClientRect is shrunk by the desktop body zoom,
   so divide by cssZoom() like the canvases do.
   ════════════════════════════════════════════════════════════════════════ */

let observer: ResizeObserver | null = null;

/** Stable callback ref for the app frame: `<main ref={frameHeightRef}>`. */
export function frameHeightRef(node: HTMLElement | null): void {
  observer?.disconnect();
  observer = null;
  if (!node || typeof ResizeObserver === "undefined") return;
  const apply = () => {
    const h = node.getBoundingClientRect().height / cssZoom();
    if (h > 0) node.style.setProperty("--om-frame-h", `${Math.floor(h)}px`);
  };
  apply();
  observer = new ResizeObserver(apply);
  observer.observe(node);
}
