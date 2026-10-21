import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The production bundle is embedded into Shelf.exe and served by Tauri,
// so asset URLs are relative and everything (fonts included) is bundled locally — no network access.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "node",
  },
});
