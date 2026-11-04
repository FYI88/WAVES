import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile, downloadText } from "./dom";
import { shareDataUrl, shareText } from "./native";

vi.mock("./native", () => ({ shareDataUrl: vi.fn(), shareText: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("exports preserve native sharing after the UI port", () => {
  it("shares PNG directly without a browser download", async () => {
    vi.mocked(shareDataUrl).mockResolvedValue(true);
    await downloadFile("data:image/png;base64,abc", "scene.png");
    expect(shareDataUrl).toHaveBeenCalledWith("data:image/png;base64,abc", "scene.png");
  });

  it("shares chart CSV directly without a browser download", async () => {
    vi.mocked(shareText).mockResolvedValue(true);
    await downloadText("R,T\n0,1", "chart.csv");
    expect(shareText).toHaveBeenCalledWith("R,T\n0,1", "chart.csv");
  });

  it.each([false, "failure"])("falls back to web PNG download when native returns %s", async (result) => {
    if (result === false) vi.mocked(shareDataUrl).mockResolvedValue(false);
    else vi.mocked(shareDataUrl).mockRejectedValue(new Error("share unavailable"));
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
    await downloadFile("data:image/png;base64,abc", "scene.png");
    expect(anchor.download).toBe("scene.png");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
  });
});
