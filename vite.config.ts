import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/renderer"
  },
  test: {
    environment: "jsdom",
    setupFiles: ["/home/runner/work/musicvis/musicvis/test/setup.ts"]
  }
});
