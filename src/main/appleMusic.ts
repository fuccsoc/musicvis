import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { PlaybackState, TrackInfo } from "./types";
import { resolveArtworkFromAppleMusicApi } from "./appleMusicApi";
import { log } from "./logger";

const execFileAsync = promisify(execFile);
const SEP = "\u001f";
const artworkCache = new Map<string, string>();

function artworkCacheDir(): string {
  return path.join(app.getPath("userData"), "cache", "artwork");
}

interface ParsedAppleScript {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  playbackState: PlaybackState;
}

export function parseAppleScriptResponse(raw: string): ParsedAppleScript | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "NOT_RUNNING" || trimmed === "NO_TRACK") {
    return null;
  }
  const parts = trimmed.split(SEP);
  if (parts.length < 7) {
    return null;
  }

  const [id, title, artist, album, durationRaw, positionRaw, playbackStateRaw] = parts;
  const playbackState = ["playing", "paused", "stopped"].includes(playbackStateRaw)
    ? (playbackStateRaw as PlaybackState)
    : "stopped";

  return {
    id: id || "unknown",
    title,
    artist,
    album,
    duration: Number(durationRaw) || 0,
    position: Number(positionRaw) || 0,
    playbackState
  };
}

function trackMetadataScript(): string {
  return `
if application "Music" is not running then
  return "NOT_RUNNING"
end if

tell application "Music"
  try
    set pState to (player state as text)
    if pState is "stopped" then
      return "NO_TRACK"
    end if
    set t to current track
    set trackId to (persistent ID of t) as text
    set output to trackId & "${SEP}" & (name of t) & "${SEP}" & (artist of t) & "${SEP}" & (album of t) & "${SEP}" & (duration of t as text) & "${SEP}" & (player position as text) & "${SEP}" & pState
    return output
  on error
    return "NO_TRACK"
  end try
end tell
`;
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 5000,
    windowsHide: true
  });
  return stdout;
}

async function saveArtworkByAppleScript(trackId: string): Promise<string | null> {
  const folder = artworkCacheDir();
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${trackId}.jpg`);
  if (fs.existsSync(target)) {
    artworkCache.set(trackId, target);
    return target;
  }

  const script = `
if application "Music" is not running then
  return "NO_ART"
end if

tell application "Music"
  try
    set t to current track
    if (count of artworks of t) is 0 then
      return "NO_ART"
    end if
    save artwork 1 of t in POSIX file "${target}" as JPEG picture
    return "OK"
  on error
    return "NO_ART"
  end try
end tell
`;

  try {
    const result = (await runAppleScript(script)).trim();
    if (result === "OK" && fs.existsSync(target)) {
      artworkCache.set(trackId, target);
      return target;
    }
  } catch (error) {
    log("warn", `Artwork extraction via AppleScript failed: ${String(error)}`);
  }
  return null;
}

export async function getCurrentTrack(): Promise<TrackInfo | null> {
  try {
    const parsed = parseAppleScriptResponse(await runAppleScript(trackMetadataScript()));
    if (!parsed) {
      return null;
    }

    let artworkPath = artworkCache.get(parsed.id) ?? null;
    if (!artworkPath || !fs.existsSync(artworkPath)) {
      artworkPath = await saveArtworkByAppleScript(parsed.id);
    }

    if (!artworkPath) {
      artworkPath = await resolveArtworkFromAppleMusicApi({
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album
      }).catch(() => null);
    }

    return {
      ...parsed,
      artworkPath: artworkPath ?? null
    };
  } catch (error) {
    log("warn", `AppleScript request failed: ${String(error)}`);
    return null;
  }
}
