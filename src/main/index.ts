import { app, BrowserWindow } from "electron";
import { pruneArtworkCache } from "./artwork";
import { registerArtworkProtocolHandler, registerArtworkProtocolScheme } from "./artworkProtocol";
import { AudioHelperManager } from "./audioHelper";
import { emitFullscreenChanged, emitHelperEvent, emitTrackChanged, setupIpc } from "./ipc";
import { debugLog } from "./logger";
import { applySourceEvent, getCurrentTrack } from "./nowPlaying";
import { createNowPlayingSource } from "./nowPlayingSource";
import { getSettings, updateSettings } from "./settings";
import type { AppSettings, TrackInfo } from "../shared/types";
import { createMainWindow } from "./window";

// Source events drive updates; this cheap in-process tick only picks up
// background results such as downloaded artwork and fetched lyrics.
const trackRefreshIntervalMs = 1000;

let helper: AudioHelperManager | null = null;
let nowPlayingSource: ReturnType<typeof createNowPlayingSource> | null = null;
let trackRefreshTimer: NodeJS.Timeout | null = null;
let lastTrackSignature = "";

registerArtworkProtocolScheme();

function applySettings(window: BrowserWindow, settings: AppSettings, patch?: Partial<AppSettings>): void {
  const changed = (key: keyof AppSettings): boolean => !patch || Object.prototype.hasOwnProperty.call(patch, key);
  if (changed("alwaysOnTop")) {
    window.setAlwaysOnTop(settings.alwaysOnTop);
  }
  if (changed("clickThrough")) {
    window.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
    if (settings.clickThrough) {
      app.dock?.hide();
    } else {
      void app.dock?.show();
    }
  }
  if (changed("fullscreen") && settings.fullscreen !== window.isFullScreen()) {
    window.setFullScreen(settings.fullscreen);
  }
}

function trackSignature(track: TrackInfo | null): string {
  if (!track) {
    return "";
  }
  return [
    track.id,
    track.playbackState,
    track.artworkPath ?? "",
    track.lyricLines.length,
    track.positionUpdatedAt
  ].join("\u001f");
}

function publishTrack(window: BrowserWindow): void {
  const track = getCurrentTrack();
  const signature = trackSignature(track);
  if (signature === lastTrackSignature) {
    return;
  }
  lastTrackSignature = signature;
  debugLog("track", track ? `emit track="${track.artist} - ${track.title}" position=${track.position.toFixed(2)}` : "emit no-track");
  emitTrackChanged(window, track);
}

function startNowPlaying(window: BrowserWindow): void {
  nowPlayingSource = createNowPlayingSource((event) => {
    applySourceEvent(event);
    publishTrack(window);
  });
  nowPlayingSource.start();
  trackRefreshTimer = setInterval(() => publishTrack(window), trackRefreshIntervalMs);
}

function stopBackgroundWork(): void {
  if (trackRefreshTimer) {
    clearInterval(trackRefreshTimer);
    trackRefreshTimer = null;
  }
  nowPlayingSource?.stop();
  nowPlayingSource = null;
  helper?.stop();
  helper = null;
}

// Single-window app: there is nothing to keep running once the window is gone.
app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", stopBackgroundWork);

void app.whenReady().then(() => {
  registerArtworkProtocolHandler();
  pruneArtworkCache();

  const window = createMainWindow();
  const patchSettings = (patch: Partial<AppSettings>): AppSettings => {
    const settings = updateSettings(patch);
    applySettings(window, settings, patch);
    return settings;
  };

  applySettings(window, getSettings());

  setupIpc(window, {
    getCurrentTrack,
    patchSettings,
    restartAudioHelper: () => helper?.restart()
  });

  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    if (input.key.toLowerCase() === "f" && !input.isAutoRepeat && !input.meta && !input.control && !input.alt) {
      patchSettings({ fullscreen: !window.isFullScreen() });
    }
  });

  window.on("enter-full-screen", () => {
    updateSettings({ fullscreen: true });
    emitFullscreenChanged(window, true);
  });

  window.on("leave-full-screen", () => {
    updateSettings({ fullscreen: false });
    emitFullscreenChanged(window, false);
  });

  window.on("closed", stopBackgroundWork);

  startNowPlaying(window);

  helper = new AudioHelperManager((event) => emitHelperEvent(window, event));
  helper.start();
});
