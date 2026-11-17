import katex from "katex";
import "katex/dist/katex.min.css";

/** Render a mathematical expression as real TeX instead of proportional text. */
export function MathText({ formula, tex, display = false, className = "", label }: { formula?: string; tex?: string; display?: boolean; className?: string; label?: string }) {
  const source = formula ?? tex ?? "";
  const html = katex.renderToString(source, { throwOnError: false, displayMode: display, output: "html" });
  return <span className={`om-math ${className}`.trim()} role="img" aria-label={label ?? source} dangerouslySetInnerHTML={{ __html: html }} />;
}
