import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPersisted } from "./persistence";

afterEach(() => vi.unstubAllGlobals());

describe("default theme", () => {
  it.each([true, false])("follows the device dark preference: %s", (dark) => {
    vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && dark }) });
    expect(defaultPersisted().theme).toBe(dark ? "dark" : "light");
  });

  it("falls back to light without preference support", () => {
    vi.stubGlobal("window", {});
    expect(defaultPersisted().theme).toBe("light");
  });
});
