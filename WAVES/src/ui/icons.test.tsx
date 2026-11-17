import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "./icons";

it.each(["check", "warn"] as const)("renders the decorative %s as SVG without replacing its textual meaning", (icon) => {
  const html = renderToStaticMarkup(<span>{Icon[icon]}{icon === "check" ? "Copied" : "EMT outside validity"}</span>);
  expect(html).toContain('<svg viewBox="0 0 24 24" aria-hidden="true"');
  expect(html).toContain("<path");
  expect(html).toContain(icon === "check" ? "Copied" : "EMT outside validity");
  expect(html).not.toMatch(/[\u2705\u2713\u26a0\ufe0f]/u);
});
