import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { PlaybackState, TrackInfo } from "./types";
import { resolveArtworkFromAppleMusicApi } from "./appleMusicApi";
import { resolveCurrentLyrics } from "./lyrics";
import { debugLog, log } from "./logger";

const execFileAsync = promisify(execFile);
const SEP = "\u001f";
const artworkCache = new Map<string, string>();
const debugLyrics = process.env.MUSICVIS_DEBUG_LYRICS === "1";
let lastPlaybackDebugAt = 0;
let swiftHelperFailures = 0;
let swiftHelperDisabledUntil = 0;
let playbackClock: {
  id: string;
  position: number;
  updatedAt: number;
  rawPosition: number;
  pausedSince?: number;
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
  positionReliable?: boolean;
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

interface SwiftMediaRemotePayload {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  sourceName?: string;
  duration?: number;
  position?: number;
  playbackState?: PlaybackState;
  playbackRate?: number | null;
  bundleIdentifier?: string;
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

function mediaRemoteHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "native", "MediaRemoteHelper");
  }
  return path.join(app.getAppPath(), "resources", "native", "MediaRemoteHelper");
}

export function parseSwiftMediaRemoteResponse(raw: string): ParsedAppleScript | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  const parsed = JSON.parse(trimmed) as SwiftMediaRemotePayload;
  if (!parsed.title) {
    return null;
  }
  const sourceName = parsed.sourceName || parsed.bundleIdentifier || "System audio";
  return {
    id: parsed.id || [parsed.bundleIdentifier, parsed.title, parsed.artist].join("::"),
    title: parsed.title,
    artist: parsed.artist ?? "",
    album: parsed.album ?? "",
    sourceName,
    duration: Number(parsed.duration) || 0,
    position: Number(parsed.position) || 0,
    playbackState: parsed.playbackState === "paused" ? "paused" : "playing",
    positionReliable: true
  };
}

async function getTrackFromSwiftMediaRemote(): Promise<ParsedAppleScript | null> {
  const now = Date.now();
  if (now < swiftHelperDisabledUntil) {
    debugLog("metadata", `swift-helper skip reason=circuit-open retryIn=${swiftHelperDisabledUntil - now}ms`);
    return null;
  }

  const helperPath = mediaRemoteHelperPath();
  if (!fs.existsSync(helperPath)) {
    debugLog("metadata", `swift-helper missing path="${helperPath}"`);
    return null;
  }

  try {
    debugLog("metadata", `swift-helper start path="${helperPath}"`);
    const { stdout } = await execFileAsync(helperPath, [], {
      timeout: 1200,
      windowsHide: true
    });
    const parsed = parseSwiftMediaRemoteResponse(stdout);
    swiftHelperFailures = parsed ? 0 : swiftHelperFailures + 1;
    debugLog(
      "metadata",
      parsed
        ? `swift-helper ok track="${parsed.artist} - ${parsed.title}" position=${parsed.position.toFixed(2)} state=${parsed.playbackState}`
        : `swift-helper empty stdout="${stdout.trim().slice(0, 160)}"`
    );
    if (!parsed && swiftHelperFailures >= 2) {
      swiftHelperDisabledUntil = Date.now() + 60_000;
      debugLog("metadata", "swift-helper circuit-open reason=empty-response");
    }
    return parsed;
  } catch (error) {
    swiftHelperFailures += 1;
    if (swiftHelperFailures >= 2) {
      swiftHelperDisabledUntil = Date.now() + 60_000;
    }
    debugLog("metadata", `swift-helper failed error="${String(error)}"`);
    if (swiftHelperDisabledUntil > Date.now()) {
      debugLog("metadata", "swift-helper circuit-open reason=failure");
    }
    return null;
  }
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
  if (track.positionReliable) {
    playbackClock = { id: clockKey, position: incomingPosition, updatedAt: now, rawPosition: incomingPosition };
    debugPlaybackClock(track, incomingPosition, incomingPosition, 0, "trusted-raw");
    return incomingPosition;
  }

  if (track.playbackState !== "playing") {
    const activeClock = playbackClock?.id === clockKey ? playbackClock : null;
    const pausedSince = activeClock ? activeClock.pausedSince ?? now : now;
    if (activeClock && now - pausedSince < 1800) {
      const expectedPosition = activeClock.position + (now - activeClock.updatedAt) / 1000;
      const nextPosition = track.duration > 0 ? Math.min(expectedPosition, track.duration) : expectedPosition;
      playbackClock = {
        id: clockKey,
        position: nextPosition,
        updatedAt: now,
        rawPosition: incomingPosition,
        pausedSince,
        pendingSeek: activeClock.pendingSeek
      };
      debugPlaybackClock(track, incomingPosition, nextPosition, incomingPosition - expectedPosition, "paused-grace");
      return nextPosition;
    }

    playbackClock = { id: clockKey, position: incomingPosition, updatedAt: now, rawPosition: incomingPosition, pausedSince };
    debugPlaybackClock(track, incomingPosition, incomingPosition, 0, "paused");
    return incomingPosition;
  }

  if (!playbackClock || playbackClock.id !== clockKey) {
    playbackClock = { id: clockKey, position: incomingPosition, updatedAt: now, rawPosition: incomingPosition };
    debugPlaybackClock(track, incomingPosition, incomingPosition, 0, "reset");
    return incomingPosition;
  }

  const expectedPosition = playbackClock.position + (now - playbackClock.updatedAt) / 1000;
  const drift = incomingPosition - expectedPosition;
  const rawChanged = Math.abs(incomingPosition - playbackClock.rawPosition) > 0.35;
  let trustedPosition = Math.max(incomingPosition, expectedPosition);
  let pendingSeek = playbackClock.pendingSeek;
  let mode = "clock";
  if (drift > 1.25) {
    trustedPosition = incomingPosition;
    pendingSeek = undefined;
    mode = "forward-resync";
  } else if (drift < -1.25) {
    if (!rawChanged && !pendingSeek) {
      trustedPosition = expectedPosition;
      mode = "stale-raw";
    } else {
      const confirmedSeek =
        pendingSeek &&
        Math.abs(incomingPosition - pendingSeek.position) < 1.8 &&
        now - pendingSeek.updatedAt < 2500;
      if (confirmedSeek) {
        trustedPosition = incomingPosition;
        pendingSeek = undefined;
        mode = "confirmed-backseek";
      } else {
        trustedPosition = expectedPosition;
        pendingSeek = { position: incomingPosition, updatedAt: now };
        mode = "pending-backseek";
      }
    }
  } else {
    pendingSeek = undefined;
  }
  const nextPosition = track.duration > 0 ? Math.min(trustedPosition, track.duration) : trustedPosition;
  playbackClock = { id: clockKey, position: nextPosition, updatedAt: now, rawPosition: incomingPosition, pendingSeek };
  debugPlaybackClock(track, incomingPosition, nextPosition, drift, mode);
  return nextPosition;
}

function debugPlaybackClock(
  track: ParsedAppleScript,
  incomingPosition: number,
  estimatedPosition: number,
  drift: number,
  mode: string
): void {
  if (!debugLyrics) {
    return;
  }
  const now = Date.now();
  if (now - lastPlaybackDebugAt < 1000) {
    return;
  }
  lastPlaybackDebugAt = now;
  log(
    "info",
    [
      "lyrics-debug playback",
      `mode=${mode}`,
      `state=${track.playbackState}`,
      `source=${track.sourceName}`,
      `track="${track.artist} - ${track.title}"`,
      `raw=${incomingPosition.toFixed(2)}`,
      `estimated=${estimatedPosition.toFixed(2)}`,
      `drift=${drift.toFixed(2)}`,
      `duration=${track.duration.toFixed(2)}`
    ].join(" ")
  );
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
    let parsed: ParsedAppleScript | null = await getTrackFromSwiftMediaRemote();
    try {
      if (!parsed) {
        debugLog("metadata", "jxa-mediaremote start");
        parsed = parseMediaRemoteResponse(await runJavaScriptForAutomation(mediaRemoteMetadataScript()));
        debugLog(
          "metadata",
          parsed
            ? `jxa-mediaremote ok track="${parsed.artist} - ${parsed.title}" position=${parsed.position.toFixed(2)} state=${parsed.playbackState}`
            : "jxa-mediaremote empty"
        );
      }
    } catch (error) {
      log("warn", `MediaRemote request failed: ${String(error)}`);
    }

    if (!parsed) {
      debugLog("metadata", "applescript start");
      parsed = parseAppleScriptResponse(await runAppleScript(trackMetadataScript()));
      debugLog(
        "metadata",
        parsed
          ? `applescript ok track="${parsed.artist} - ${parsed.title}" position=${parsed.position.toFixed(2)} state=${parsed.playbackState}`
          : "applescript empty"
      );
    }
    if (!parsed) {
      debugLog("metadata", "no-track");
      return null;
    }
    const estimatedPosition = estimatePlaybackPosition(parsed);

    let artworkPath = artworkCache.get(parsed.id) ?? null;
    if ((!artworkPath || !fs.existsSync(artworkPath)) && parsed.sourceName === "Music") {
      debugLog("artwork", `local-music-artwork start id="${parsed.id}"`);
      artworkPath = await saveArtworkByAppleScript(parsed.id);
      debugLog("artwork", artworkPath ? `local-music-artwork hit path="${artworkPath}"` : "local-music-artwork miss");
    }

    if (!artworkPath) {
      debugLog("artwork", `api-artwork start track="${parsed.artist} - ${parsed.title}"`);
      artworkPath = await resolveArtworkFromAppleMusicApi({
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album
      }).catch(() => null);
      debugLog("artwork", artworkPath ? `api-artwork hit path="${artworkPath}"` : "api-artwork miss");
    }

    const lyrics = await resolveCurrentLyrics(
      {
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album,
        duration: parsed.duration
      },
      estimatedPosition
    ).catch(() => ({ line: "", lines: [] }));
    debugLog(
      "track",
      `ready provider="${parsed.sourceName}" track="${parsed.artist} - ${parsed.title}" position=${estimatedPosition.toFixed(2)} state=${parsed.playbackState} lyric="${lyrics.line}"`
    );

    return {
      ...parsed,
      position: estimatedPosition,
      positionReliable: parsed.positionReliable === true,
      artworkPath: artworkPath ?? null,
      lyricLine: lyrics.line,
      lyricLines: lyrics.lines,
      positionUpdatedAt: Date.now()
    };
  } catch (error) {
    log("warn", `AppleScript request failed: ${String(error)}`);
    return null;
  }
}
