import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Web-only V2 build: same App + graphics, no Type/Convex gate.
// Served locally so you can iterate before pushing back to Type.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    rollupOptions: { input: "index-web.html" },
  },
});
