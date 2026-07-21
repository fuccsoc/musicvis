import type { AppSettings, HelperEvent, TrackInfo } from "./main/types";

declare global {
  interface Window {
    visualizerApi: {
      getCurrentTrack(): Promise<TrackInfo | null>;
      onTrackChanged(callback: (track: TrackInfo | null) => void): () => void;
      onAudioSamples(callback: (event: Extract<HelperEvent, { type: "audio" }>) => void): () => void;
      onAudioStatus(callback: (event: Exclude<HelperEvent, { type: "audio" }>) => void): () => void;
      onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void;
      getSettings(): Promise<AppSettings>;
      updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
      toggleFullscreen(): Promise<void>;
      toggleAlwaysOnTop(): Promise<void>;
      toggleClickThrough(): Promise<void>;
      restartAudioHelper(): Promise<void>;
      openSystemPreferences(): Promise<void>;
    };
  }
}

export {};
