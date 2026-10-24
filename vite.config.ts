import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Short commit stamp so a build can be identified on a phone without a
// debugger attached. Falls back to "dev" outside a git checkout.
function commitStamp() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}

// Relative base so the built app also loads from file:// and sub-path hosts.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(commitStamp()),
  },
});
