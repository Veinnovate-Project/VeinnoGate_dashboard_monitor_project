import { defineConfig } from "vite";
import { resolve } from "node:path";

// BUNDLE_TARGET selects the entry HTML at *build/dev tool* time only (Node context).
// It never ships to the browser and never lets a running app switch itself between
// production and demo — see src/main.ts vs src/main.demo.ts.
const target = process.env.BUNDLE_TARGET === "demo" ? "demo" : "production";

export default defineConfig({
  root: __dirname,
  build: {
    outDir: target === "demo" ? "dist-demo" : "dist",
    rollupOptions: {
      input: resolve(__dirname, target === "demo" ? "demo.html" : "index.html")
    }
  },
  server: {
    open: target === "demo" ? "/demo.html" : "/index.html"
  }
});
