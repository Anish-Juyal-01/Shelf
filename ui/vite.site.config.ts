import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The marketing site: a separate entry (site/index.html) that reuses the app's components and palettes.
// Static output in dist-site/, ready for any host. Nothing here is embedded in Shelf.exe.
export default defineConfig({
  root: "site",
  base: "./",
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  server: { port: 5175, strictPort: true, fs: { allow: [".."] } },
  build: {
    target: "es2022",
    outDir: "../dist-site",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
