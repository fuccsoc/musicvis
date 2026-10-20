import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, AudioEvent, AudioStatusEvent, TrackInfo } from "../shared/types";

type Unsubscribe = () => void;

// Duplicated from ipc.ts on purpose: sandboxed preloads cannot require local modules.
const IPC_CHANNELS = {
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

function onChannel<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

export const api = {
  getCurrentTrack: (): Promise<TrackInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.GET_CURRENT_TRACK),
  onTrackChanged: (callback: (track: TrackInfo | null) => void): Unsubscribe =>
    onChannel<TrackInfo | null>(IPC_CHANNELS.TRACK_CHANGED, callback),
  onAudioSamples: (callback: (event: AudioEvent) => void): Unsubscribe =>
    onChannel<AudioEvent>(IPC_CHANNELS.AUDIO_SAMPLES, callback),
  onAudioStatus: (callback: (event: AudioStatusEvent) => void): Unsubscribe =>
    onChannel<AudioStatusEvent>(IPC_CHANNELS.AUDIO_STATUS, callback),
  onFullscreenChanged: (callback: (fullscreen: boolean) => void): Unsubscribe =>
    onChannel<boolean>(IPC_CHANNELS.FULLSCREEN_CHANGED, callback),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  updateSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FULLSCREEN),
  toggleAlwaysOnTop: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_ALWAYS_ON_TOP),
  toggleClickThrough: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_CLICK_THROUGH),
  restartAudioHelper: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RESTART_AUDIO_HELPER),
  openSystemPreferences: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SYSTEM_PREFERENCES)
};

contextBridge.exposeInMainWorld("visualizerApi", api);

export type VisualizerApi = typeof api;
