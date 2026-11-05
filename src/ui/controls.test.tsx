import { expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Slider } from "./controls";

type Node = ReactElement<Record<string, any>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}

it("renders Brewster on its own tick row without moving numeric ticks or changing their callbacks", () => {
  const onChange = vi.fn();
  let tree: Node[] = [];
  function Capture() {
    const result = Slider({ label: "Incidence", value: 30, min: 0, max: 89, step: 0.5, fmtNum: String, onChange,
      ticks: [{ v: 60, label: "60" }, { v: 59.5, label: "θB", tone: "acc", row: 2 }] });
    tree = nodes(result);
    return result;
  }
  const html = renderToStaticMarkup(<Capture />);
  expect(html).toContain('class="om-ticks om-ticks-two-rows"');
  const ticks = tree.filter((node) => node.type === "button");
  expect(ticks[0].props.className).not.toContain("om-tick-row-2");
  expect(ticks[1].props.className).toContain("om-tick-row-2");
  expect(ticks[1].props.type).toBe("button"); // Native Enter/Space activation remains available.
  expect(ticks[1].props.tabIndex).toBeUndefined();
  ticks[1].props.onClick();
  expect(onChange).toHaveBeenLastCalledWith(59.5);
  ticks[0].props.onClick();
  expect(onChange).toHaveBeenLastCalledWith(60);
});

it("keeps ordinary accent ticks on the original row unless explicitly requested", () => {
  const html = renderToStaticMarkup(<Slider label="Other" value={1} min={0} max={2} fmtNum={String} onChange={() => {}}
    ticks={[{ v: 1, label: "Reference", tone: "acc" }]} />);
  expect(html).toContain('class="om-ticks"');
  expect(html).not.toContain("om-tick-row-2");
  expect(html).not.toContain("om-ticks-two-rows");
});
