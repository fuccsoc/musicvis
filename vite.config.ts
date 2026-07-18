import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/renderer"
  },
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "test/setup.ts")]
  }
});
