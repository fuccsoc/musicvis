import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true
  },
  test: {
    environment: "jsdom",
    include: [resolve(rootDir, "test/**/*.test.ts")],
    setupFiles: [resolve(rootDir, "test/setup.ts")]
  }
});
