import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built app also loads from file:// and sub-path hosts.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
