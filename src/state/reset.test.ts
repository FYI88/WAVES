import source from "../App.tsx?raw";
import { expect, it, vi } from "vitest";

it("Reset clears the share hash as well as saved storage before reloading", () => {
  const handler = source.match(/className="om-reset"\s+onClick=\{\(\) => \{([\s\S]*?)\}\}/)![1];
  const location = { hash: "#s=current-settings", pathname: "/waves/", search: "", reload: vi.fn() };
  const window = {
    location,
    localStorage: { removeItem: vi.fn() },
    history: { replaceState: vi.fn(() => { location.hash = ""; }) },
  };
  new Function("window", "STORAGE_KEY", handler)(window, "onde-mur:v2");
  expect(location.hash).toBe("");
  expect(window.localStorage.removeItem).toHaveBeenCalledWith("onde-mur:v2");
  expect(location.reload).toHaveBeenCalledOnce();
});
