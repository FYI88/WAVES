import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built app loads from Type's artifact preview URLs.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
