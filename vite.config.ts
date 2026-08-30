import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // The optional Three.js scene is isolated behind a dynamic import. Its
    // compressed size is enforced by scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 550,
  },
  worker: {
    format: "es",
  },
});
