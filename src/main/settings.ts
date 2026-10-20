import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppSettings } from "../shared/types";
import { log } from "./logger";

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
  waveformColorStart: "#7dd3fc",
  waveformColorEnd: "#f0abfc",
  waveformFillOpacity: 0.28,
  waveformGlow: 18,
  spectrumBucketCount: 160,
  bassLevel: 0.62,
  autoScaleStrength: 0.58,
  autoScaleMaxGain: 1.55,
  sensitivity: 1.35,
  smoothing: 0.72,
  idleAmplitude: 0.01,
  textScale: 1
};

let current: AppSettings | null = null;

/** Keeps only known keys whose value type matches the default. */
export function sanitizeSettingsPatch(input: unknown): Partial<AppSettings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.prototype.hasOwnProperty.call(defaultSettings, key)) {
      continue;
    }
    const expected = typeof defaultSettings[key as keyof AppSettings];
    if (typeof value === expected && (expected !== "number" || Number.isFinite(value))) {
      patch[key] = value;
    }
  }
  return patch as Partial<AppSettings>;
}

export function parseSettingsJSON(raw: string): AppSettings {
  return {
    ...defaultSettings,
    ...sanitizeSettingsPatch(JSON.parse(raw))
  };
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function getSettings(): AppSettings {
  if (!current) {
    try {
      current = parseSettingsJSON(fs.readFileSync(settingsPath(), "utf8"));
    } catch {
      current = { ...defaultSettings };
    }
  }
  return current;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  current = { ...getSettings(), ...sanitizeSettingsPatch(patch) };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(current, null, 2));
  } catch (error) {
    log("warn", `Settings save failed: ${String(error)}`);
  }
  return current;
}
