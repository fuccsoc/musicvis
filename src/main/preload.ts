import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, HelperEvent, TrackInfo } from "./types";

type Unsubscribe = () => void;

const IPC_CHANNELS = {
  GET_CURRENT_TRACK: "visualizer:getCurrentTrack",
  TRACK_CHANGED: "visualizer:trackChanged",
  AUDIO_SAMPLES: "visualizer:audioSamples",
  AUDIO_STATUS: "visualizer:audioStatus",
  GET_SETTINGS: "visualizer:getSettings",
  UPDATE_SETTINGS: "visualizer:updateSettings",
  TOGGLE_FULLSCREEN: "visualizer:toggleFullscreen",
  TOGGLE_ALWAYS_ON_TOP: "visualizer:toggleAlwaysOnTop",
  TOGGLE_CLICK_THROUGH: "visualizer:toggleClickThrough",
  OPEN_SYSTEM_PREFERENCES: "visualizer:openSystemPreferences"
} as const;

function onChannel<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api = {
  getCurrentTrack: (): Promise<TrackInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.GET_CURRENT_TRACK),
  onTrackChanged: (callback: (track: TrackInfo | null) => void): Unsubscribe =>
    onChannel<TrackInfo | null>(IPC_CHANNELS.TRACK_CHANGED, callback),
  onAudioSamples: (callback: (event: Extract<HelperEvent, { type: "audio" }>) => void): Unsubscribe =>
    onChannel<Extract<HelperEvent, { type: "audio" }>>(IPC_CHANNELS.AUDIO_SAMPLES, callback),
  onAudioStatus: (callback: (event: Exclude<HelperEvent, { type: "audio" }>) => void): Unsubscribe =>
    onChannel<Exclude<HelperEvent, { type: "audio" }>>(IPC_CHANNELS.AUDIO_STATUS, callback),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  updateSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FULLSCREEN),
  toggleAlwaysOnTop: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_ALWAYS_ON_TOP),
  toggleClickThrough: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_CLICK_THROUGH),
  openSystemPreferences: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SYSTEM_PREFERENCES)
};

contextBridge.exposeInMainWorld("visualizerApi", api);
