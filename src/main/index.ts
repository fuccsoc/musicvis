import { app, BrowserWindow } from "electron";
import { getCurrentTrack } from "./appleMusic";
import { AudioHelperManager } from "./audioHelper";
import { emitHelperEvent, emitTrackChanged, setupIpc } from "./ipc";
import { getSettings } from "./settings";
import type { AppSettings, TrackInfo } from "./types";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
let helper: AudioHelperManager | null = null;
let trackPollTimer: NodeJS.Timeout | null = null;
let requestInFlight = false;
let lastTrackId = "";

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
  if (requestInFlight) {
    return;
  }
  requestInFlight = true;
  let track: TrackInfo | null = null;
  try {
    track = await getCurrentTrack();
  } finally {
    requestInFlight = false;
  }
  const nextId = track?.id ?? "";
  if (nextId !== lastTrackId) {
    lastTrackId = nextId;
    emitTrackChanged(window, track);
  }
}

function startPolling(window: BrowserWindow): void {
  void pollTrack(window);
  trackPollTimer = setInterval(() => {
    void pollTrack(window);
  }, 800);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.whenReady().then(() => {
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
      clearInterval(trackPollTimer);
      trackPollTimer = null;
    }
    helper?.stop();
    helper = null;
  });
});
