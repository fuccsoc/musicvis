import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { PlaybackState, TrackInfo } from "./types";
import { resolveArtworkFromAppleMusicApi } from "./appleMusicApi";
import { resolveCurrentLyricLine } from "./lyrics";
import { log } from "./logger";

const execFileAsync = promisify(execFile);
const SEP = "\u001f";
const artworkCache = new Map<string, string>();
let playbackClock: {
  id: string;
  position: number;
  updatedAt: number;
  pendingSeek?: {
    position: number;
    updatedAt: number;
  };
} | null = null;

function artworkCacheDir(): string {
  return path.join(app.getPath("userData"), "cache", "artwork");
}

interface ParsedAppleScript {
  id: string;
  title: string;
  artist: string;
  album: string;
  sourceName: string;
  duration: number;
  position: number;
  playbackState: PlaybackState;
}

interface MediaRemotePayload {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  sourceName?: string;
  duration?: number;
  position?: number;
  playbackRate?: number;
  hasPlaybackRate?: boolean;
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
    sourceName: "Music",
    duration: Number(durationRaw) || 0,
    position: Number(positionRaw) || 0,
    playbackState
  };
}

function mediaRemoteMetadataScript(): string {
  return `
ObjC.import("Foundation");

function value(info, key) {
  const item = info.valueForKey(key);
  if (!item) {
    return "";
  }
  const output = item.js;
  return output == null ? "" : output;
}

function numberValue(info, key) {
  const item = info.valueForKey(key);
  if (!item) {
    return 0;
  }
  return Number(item.js) || 0;
}

function hasValue(info, key) {
  return Boolean(info.valueForKey(key));
}

function run() {
  const MediaRemote = $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework/");
  MediaRemote.load;

  const request = $.NSClassFromString("MRNowPlayingRequest");
  if (!request || !request.localNowPlayingItem) {
    return "null";
  }

  const item = request.localNowPlayingItem;
  const info = item.nowPlayingInfo;
  if (!info) {
    return "null";
  }

  const title = value(info, "kMRMediaRemoteNowPlayingInfoTitle");
  if (!title) {
    return "null";
  }

  const playerPath = request.localNowPlayingPlayerPath;
  const client = playerPath ? playerPath.client : null;
  const sourceName = client && client.displayName ? String(client.displayName.js || "") : "";
  const bundleIdentifier = client && client.bundleIdentifier ? String(client.bundleIdentifier.js || "") : "";
  const uniqueIdentifier = value(info, "kMRMediaRemoteNowPlayingInfoUniqueIdentifier");

  return JSON.stringify({
    id: uniqueIdentifier || [bundleIdentifier, title, value(info, "kMRMediaRemoteNowPlayingInfoArtist")].join("::"),
    title,
    artist: value(info, "kMRMediaRemoteNowPlayingInfoArtist"),
    album: value(info, "kMRMediaRemoteNowPlayingInfoAlbum"),
    sourceName,
    duration: numberValue(info, "kMRMediaRemoteNowPlayingInfoDuration"),
    position: numberValue(info, "kMRMediaRemoteNowPlayingInfoElapsedTime"),
    playbackRate: numberValue(info, "kMRMediaRemoteNowPlayingInfoPlaybackRate"),
    hasPlaybackRate: hasValue(info, "kMRMediaRemoteNowPlayingInfoPlaybackRate")
  });
}
`;
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

async function runJavaScriptForAutomation(script: string): Promise<string> {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 5000,
    windowsHide: true
  });
  return stdout;
}

export function parseMediaRemoteResponse(raw: string): ParsedAppleScript | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  const parsed = JSON.parse(trimmed) as MediaRemotePayload;
  if (!parsed.title) {
    return null;
  }
  const hasPlaybackRate = parsed.hasPlaybackRate ?? parsed.playbackRate != null;
  return {
    id: parsed.id || [parsed.sourceName, parsed.title, parsed.artist].join("::"),
    title: parsed.title,
    artist: parsed.artist ?? "",
    album: parsed.album ?? "",
    sourceName: parsed.sourceName || "System audio",
    duration: Number(parsed.duration) || 0,
    position: Number(parsed.position) || 0,
    playbackState: hasPlaybackRate && Number(parsed.playbackRate) <= 0 ? "paused" : "playing"
  };
}

function playbackClockKey(track: ParsedAppleScript): string {
  return [
    track.sourceName,
    track.title.trim().toLowerCase(),
    track.artist.trim().toLowerCase(),
    track.album.trim().toLowerCase(),
    Math.round(track.duration)
  ].join("\u001f");
}

function estimatePlaybackPosition(track: ParsedAppleScript): number {
  const now = Date.now();
  const incomingPosition = Math.max(0, track.position);
  const clockKey = playbackClockKey(track);
  if (track.playbackState !== "playing") {
    playbackClock = { id: clockKey, position: incomingPosition, updatedAt: now };
    return incomingPosition;
  }

  if (!playbackClock || playbackClock.id !== clockKey) {
    playbackClock = { id: clockKey, position: incomingPosition, updatedAt: now };
    return incomingPosition;
  }

  const expectedPosition = playbackClock.position + (now - playbackClock.updatedAt) / 1000;
  const drift = incomingPosition - expectedPosition;
  let trustedPosition = Math.max(incomingPosition, expectedPosition);
  let pendingSeek = playbackClock.pendingSeek;
  if (drift > 1.25) {
    trustedPosition = incomingPosition;
    pendingSeek = undefined;
  } else if (drift < -1.25) {
    const confirmedSeek =
      pendingSeek &&
      Math.abs(incomingPosition - pendingSeek.position) < 1.8 &&
      now - pendingSeek.updatedAt < 2500;
    if (confirmedSeek) {
      trustedPosition = incomingPosition;
      pendingSeek = undefined;
    } else {
      trustedPosition = expectedPosition;
      pendingSeek = { position: incomingPosition, updatedAt: now };
    }
  } else {
    pendingSeek = undefined;
  }
  const nextPosition = track.duration > 0 ? Math.min(trustedPosition, track.duration) : trustedPosition;
  playbackClock = { id: clockKey, position: nextPosition, updatedAt: now, pendingSeek };
  return nextPosition;
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
    let parsed: ParsedAppleScript | null = null;
    try {
      parsed = parseMediaRemoteResponse(await runJavaScriptForAutomation(mediaRemoteMetadataScript()));
    } catch (error) {
      log("warn", `MediaRemote request failed: ${String(error)}`);
    }

    parsed ??= parseAppleScriptResponse(await runAppleScript(trackMetadataScript()));
    if (!parsed) {
      return null;
    }
    const estimatedPosition = estimatePlaybackPosition(parsed);

    let artworkPath = artworkCache.get(parsed.id) ?? null;
    if ((!artworkPath || !fs.existsSync(artworkPath)) && parsed.sourceName === "Music") {
      artworkPath = await saveArtworkByAppleScript(parsed.id);
    }

    if (!artworkPath) {
      artworkPath = await resolveArtworkFromAppleMusicApi({
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album
      }).catch(() => null);
    }

    const lyricLine = await resolveCurrentLyricLine(
      {
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album,
        duration: parsed.duration
      },
      estimatedPosition
    ).catch(() => "");

    return {
      ...parsed,
      position: estimatedPosition,
      artworkPath: artworkPath ?? null,
      lyricLine
    };
  } catch (error) {
    log("warn", `AppleScript request failed: ${String(error)}`);
    return null;
  }
}
