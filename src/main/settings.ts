import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppSettings } from "./types";

export const defaultSettings: AppSettings = {
  fullscreen: false,
  alwaysOnTop: false,
  clickThrough: false,
  showAlbum: false,
  showNothingPlaying: true,
  artworkBlur: 56,
  artworkBrightness: 0.45,
  overlayOpacity: 0.35,
  waveformWidthPercent: 84,
  waveformHeight: 150,
  lineWidth: 3,
  waveformStyle: "wave",
  waveformColorStart: "#7dd3fc",
  waveformColorEnd: "#f0abfc",
  waveformFillOpacity: 0.28,
  waveformGlow: 18,
  barGap: 3,
  sensitivity: 1.35,
  smoothing: 0.72,
  idleAmplitude: 0.01,
  textScale: 1
};

export function parseSettingsJSON(raw: string): AppSettings {
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  return {
    ...defaultSettings,
    ...parsed
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function getSettings(): AppSettings {
  try {
    const content = fs.readFileSync(settingsPath(), "utf8");
    return parseSettingsJSON(content);
  } catch {
    return defaultSettings;
  }
}

export function updateSettings(next: Partial<AppSettings>): AppSettings {
  const merged = { ...getSettings(), ...next };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2));
  return merged;
}
