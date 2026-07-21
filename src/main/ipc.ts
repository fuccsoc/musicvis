import { BrowserWindow, ipcMain, shell } from "electron";
import type { AppSettings, HelperEvent, TrackInfo } from "./types";
import { getSettings, updateSettings } from "./settings";

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

export function setupIpc(mainWindow: BrowserWindow, actions: {
  getCurrentTrack: () => Promise<TrackInfo | null>;
  applySettings: (settings: AppSettings, patch?: Partial<AppSettings>) => void;
  restartAudioHelper: () => void;
}): void {
  ipcMain.handle(IPC_CHANNELS.GET_CURRENT_TRACK, async () => actions.getCurrentTrack());
  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => getSettings());
  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (_event, patch: Partial<AppSettings>) => {
    const settings = updateSettings(patch);
    actions.applySettings(settings, patch);
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_FULLSCREEN, () => {
    const fullscreen = !mainWindow.isFullScreen();
    const settings = updateSettings({ fullscreen });
    actions.applySettings(settings, { fullscreen });
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_ALWAYS_ON_TOP, () => {
    const alwaysOnTop = !mainWindow.isAlwaysOnTop();
    const settings = updateSettings({ alwaysOnTop });
    actions.applySettings(settings, { alwaysOnTop });
  });

  ipcMain.handle(IPC_CHANNELS.TOGGLE_CLICK_THROUGH, () => {
    const meta = mainWindow as BrowserWindow & { __clickThrough?: boolean };
    const next = !meta.__clickThrough;
    const settings = updateSettings({ clickThrough: next });
    actions.applySettings(settings, { clickThrough: next });
  });

  ipcMain.handle(IPC_CHANNELS.RESTART_AUDIO_HELPER, () => {
    actions.restartAudioHelper();
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_SYSTEM_PREFERENCES, async () => {
    await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
  });
}

export function emitTrackChanged(mainWindow: BrowserWindow, track: TrackInfo | null): void {
  mainWindow.webContents.send(IPC_CHANNELS.TRACK_CHANGED, track);
}

export function emitHelperEvent(mainWindow: BrowserWindow, event: HelperEvent): void {
  if (event.type === "audio") {
    mainWindow.webContents.send(IPC_CHANNELS.AUDIO_SAMPLES, event);
  } else {
    mainWindow.webContents.send(IPC_CHANNELS.AUDIO_STATUS, event);
  }
}

export function emitFullscreenChanged(mainWindow: BrowserWindow, fullscreen: boolean): void {
  mainWindow.webContents.send(IPC_CHANNELS.FULLSCREEN_CHANGED, fullscreen);
}
