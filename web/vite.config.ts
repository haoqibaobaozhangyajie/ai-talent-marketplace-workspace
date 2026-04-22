import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: "/preview/",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    manifest: true
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared")
    }
  },
  server: {
    port: 5173
  }
});
