import type { VisualizerApi } from "./main/preload";

declare global {
  interface Window {
    visualizerApi: VisualizerApi;
  }
}

export {};
