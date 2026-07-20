import { app, BrowserWindow } from "electron";
import { getCurrentTrack } from "./mediaRemote";
import { AudioHelperManager } from "./audioHelper";
import { emitFullscreenChanged, emitHelperEvent, emitTrackChanged, setupIpc } from "./ipc";
import { getSettings } from "./settings";
import type { AppSettings, TrackInfo } from "./types";
import { createMainWindow } from "./window";
import { registerArtworkProtocolHandler, registerArtworkProtocolScheme } from "./artworkProtocol";
import { debugLog } from "./logger";

let mainWindow: BrowserWindow | null = null;
let helper: AudioHelperManager | null = null;
let trackPollTimer: NodeJS.Timeout | null = null;
let lastTrackSignature = "";
const trackPollDelayMs = 100;
const reliableSyncIntervalMs = 2000;

registerArtworkProtocolScheme();

function applySettings(window: BrowserWindow, settings: AppSettings): void {
  window.setAlwaysOnTop(settings.alwaysOnTop);
  window.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  if (settings.fullscreen !== window.isFullScreen()) {
    window.setFullScreen(settings.fullscreen);
  }
  if (settings.clickThrough) {
    app.dock?.hide();
  } else {
    app.dock?.show();
  }
}

async function pollTrack(window: BrowserWindow): Promise<void> {
  const startedAt = Date.now();
  let track: TrackInfo | null = null;
  try {
    track = await getCurrentTrack();
  } catch (error) {
    debugLog("poll", `error="${String(error)}"`);
    return;
  } finally {
    debugLog("poll", `duration=${Date.now() - startedAt}ms`);
  }
  const syncBucket = track?.positionReliable ? Math.floor(track.positionUpdatedAt / reliableSyncIntervalMs) : 0;
  const nextSignature = [
    track?.id ?? "",
    track?.playbackState ?? "",
    track?.lyricLine ?? "",
    track?.positionReliable ? "reliable" : "unreliable",
    syncBucket
  ].join("\u001f");
  if (nextSignature !== lastTrackSignature) {
    lastTrackSignature = nextSignature;
    debugLog(
      "poll",
      track
        ? `emit track="${track.artist} - ${track.title}" position=${track.position.toFixed(2)} lyric="${track.lyricLine}"`
        : "emit no-track"
    );
    emitTrackChanged(window, track);
  } else {
    debugLog("poll", "skip reason=same-signature");
  }
}

function startPolling(window: BrowserWindow): void {
  const run = (): void => {
    void pollTrack(window).finally(() => {
      trackPollTimer = setTimeout(run, trackPollDelayMs);
    });
  };
  run();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.whenReady().then(() => {
  registerArtworkProtocolHandler();

  const window = createMainWindow();
  mainWindow = window;

  applySettings(window, getSettings());

  setupIpc(window, {
    getCurrentTrack,
    applySettings: (settings) => applySettings(window, settings)
  });

  window.webContents.on("before-input-event", (_event, input) => {
    if (input.key.toLowerCase() === "f" && input.type === "keyDown") {
      window.setFullScreen(!window.isFullScreen());
    }
    if (input.key === "Escape" && input.type === "keyDown") {
      window.webContents.send("visualizer:escape");
    }
    if (input.meta && input.key === "," && input.type === "keyDown") {
      window.webContents.send("visualizer:openSettings");
    }
  });

  window.on("enter-full-screen", () => {
    emitFullscreenChanged(window, true);
  });

  window.on("leave-full-screen", () => {
    emitFullscreenChanged(window, false);
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  startPolling(window);

  helper = new AudioHelperManager((event) => {
    if (!mainWindow) {
      return;
    }
    emitHelperEvent(mainWindow, event);
  });
  helper.start();

  app.on("before-quit", () => {
    if (trackPollTimer) {
      clearTimeout(trackPollTimer);
      trackPollTimer = null;
    }
    helper?.stop();
    helper = null;
  });
});
