import { BrowserWindow, ipcMain, shell } from "electron";
import type { AppSettings, HelperEvent, TrackInfo } from "../shared/types";
import { getSettings, sanitizeSettingsPatch } from "./settings";
import { debugLog } from "./logger";

// Keep in sync with preload.ts: sandboxed preloads cannot require local modules.
export const IPC_CHANNELS = {
  GET_CURRENT_TRACK: "visualizer:getCurrentTrack",
  TRACK_CHANGED: "visualizer:trackChanged",
  AUDIO_SAMPLES: "visualizer:audioSamples",
  AUDIO_STATUS: "visualizer:audioStatus",
  FULLSCREEN_CHANGED: "visualizer:fullscreenChanged",
  GET_SETTINGS: "visualizer:getSettings",
  UPDATE_SETTINGS: "visualizer:updateSettings",
  TOGGLE_FULLSCREEN: "visualizer:toggleFullscreen",
  TOGGLE_ALWAYS_ON_TOP: "visualizer:toggleAlwaysOnTop",
  TOGGLE_CLICK_THROUGH: "visualizer:toggleClickThrough",
  RESTART_AUDIO_HELPER: "visualizer:restartAudioHelper",
  OPEN_SYSTEM_PREFERENCES: "visualizer:openSystemPreferences"
} as const;

export interface IpcActions {
  getCurrentTrack: () => TrackInfo | null;
  patchSettings: (patch: Partial<AppSettings>) => AppSettings;
  restartAudioHelper: () => void;
}

export function setupIpc(mainWindow: BrowserWindow, actions: IpcActions): void {
  ipcMain.handle(IPC_CHANNELS.GET_CURRENT_TRACK, () => actions.getCurrentTrack());
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, () => getSettings());
  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, (_event, patch: unknown) => actions.patchSettings(sanitizeSettingsPatch(patch)));
  ipcMain.handle(IPC_CHANNELS.TOGGLE_FULLSCREEN, () => {
    actions.patchSettings({ fullscreen: !mainWindow.isFullScreen() });
  });
  ipcMain.handle(IPC_CHANNELS.TOGGLE_ALWAYS_ON_TOP, () => {
    actions.patchSettings({ alwaysOnTop: !mainWindow.isAlwaysOnTop() });
  });
  ipcMain.handle(IPC_CHANNELS.TOGGLE_CLICK_THROUGH, () => {
    actions.patchSettings({ clickThrough: !getSettings().clickThrough });
  });
  ipcMain.handle(IPC_CHANNELS.RESTART_AUDIO_HELPER, () => {
    actions.restartAudioHelper();
  });
  ipcMain.handle(IPC_CHANNELS.OPEN_SYSTEM_PREFERENCES, async () => {
    await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
  });
}

function send(mainWindow: BrowserWindow, channel: string, payload: unknown): void {
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

export function emitTrackChanged(mainWindow: BrowserWindow, track: TrackInfo | null): void {
  send(mainWindow, IPC_CHANNELS.TRACK_CHANGED, track);
}

let lastAudioIpcDebugAt = 0;

export function emitHelperEvent(mainWindow: BrowserWindow, event: HelperEvent): void {
  if (event.type === "audio") {
    const now = Date.now();
    if (now - lastAudioIpcDebugAt >= 2000) {
      lastAudioIpcDebugAt = now;
      debugLog(
        "audio-helper",
        `ipc send channel=${IPC_CHANNELS.AUDIO_SAMPLES} samples=${event.samples.length} loading=${mainWindow.webContents.isLoading()}`,
        "MUSICVIS_DEBUG_AUDIO"
      );
    }
    send(mainWindow, IPC_CHANNELS.AUDIO_SAMPLES, event);
  } else {
    debugLog(
      "audio-helper",
      `ipc send channel=${IPC_CHANNELS.AUDIO_STATUS} type=${event.type} loading=${mainWindow.webContents.isLoading()}`,
      "MUSICVIS_DEBUG_AUDIO"
    );
    send(mainWindow, IPC_CHANNELS.AUDIO_STATUS, event);
  }
}

export function emitFullscreenChanged(mainWindow: BrowserWindow, fullscreen: boolean): void {
  send(mainWindow, IPC_CHANNELS.FULLSCREEN_CHANGED, fullscreen);
}
