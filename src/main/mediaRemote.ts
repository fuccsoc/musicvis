import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { PlaybackState, TrackInfo } from "./types";
import { getCachedCurrentLyrics, resolveCurrentLyrics } from "./lyrics";
import { debugLog, log } from "./logger";

const execFileAsync = promisify(execFile);
const artworkCache = new Map<string, string>();
const debugLyrics = process.env.MUSICVIS_DEBUG_LYRICS === "1";
const swiftHelperFailureBackoffMs = 2500;
const lyricRefreshIntervalMs = 10_000;
let lastPlaybackDebugAt = 0;
let swiftHelperFailures = 0;
let swiftHelperDisabledUntil = 0;
let swiftHelperInFlight: Promise<ParsedMediaRemoteTrack | null> | null = null;
const lyricRefreshStartedAt = new Map<string, number>();
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

interface ParsedMediaRemoteTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  sourceName: string;
  duration: number;
  position: number;
  playbackState: PlaybackState;
  positionReliable?: boolean;
  artworkDataBase64?: string;
  artworkMimeType?: string;
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
  artworkDataBase64?: string | null;
  artworkMimeType?: string | null;
}

function mediaRemoteHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "native", "MediaRemoteHelper");
  }
  return path.join(app.getAppPath(), "resources", "native", "MediaRemoteHelper");
}

export function parseSwiftMediaRemoteResponse(raw: string): ParsedMediaRemoteTrack | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }
  const parsed = JSON.parse(trimmed) as SwiftMediaRemotePayload;
  if (!parsed.title) {
    return null;
  }
  const sourceName = parsed.sourceName || parsed.bundleIdentifier || "System audio";
  const artworkDataBase64 = typeof parsed.artworkDataBase64 === "string" ? parsed.artworkDataBase64 : undefined;
  const artworkMimeType = typeof parsed.artworkMimeType === "string" ? parsed.artworkMimeType : undefined;
  return {
    id: parsed.id || [parsed.bundleIdentifier, parsed.title, parsed.artist].join("::"),
    title: parsed.title,
    artist: parsed.artist ?? "",
    album: parsed.album ?? "",
    sourceName,
    duration: Number(parsed.duration) || 0,
    position: Number(parsed.position) || 0,
    playbackState: parsed.playbackState === "paused" ? "paused" : "playing",
    positionReliable: true,
    artworkDataBase64,
    artworkMimeType
  };
}

function commandErrorDetails(error: unknown): string {
  const err = error as {
    message?: string;
    code?: unknown;
    signal?: unknown;
    stdout?: string;
    stderr?: string;
  };
  const message = err.message ?? String(error);
  const stdout = (err.stdout ?? "").trim().slice(0, 240);
  const stderr = (err.stderr ?? "").trim().slice(0, 240);
  return `message="${message}" code=${String(err.code ?? "")} signal=${String(err.signal ?? "")} stdout="${stdout}" stderr="${stderr}"`;
}

async function runSwiftMediaRemoteHelper(): Promise<ParsedMediaRemoteTrack | null> {
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
      timeout: 1500,
      windowsHide: true
    });
    const parsed = parseSwiftMediaRemoteResponse(stdout);
    swiftHelperFailures = parsed ? 0 : swiftHelperFailures;
    debugLog(
      "metadata",
      parsed
        ? `swift-helper ok track="${parsed.artist} - ${parsed.title}" position=${parsed.position.toFixed(2)} state=${parsed.playbackState}`
        : `swift-helper empty no-circuit stdout="${stdout.trim().slice(0, 160)}"`
    );
    return parsed;
  } catch (error) {
    swiftHelperFailures += 1;
    if (swiftHelperFailures >= 2) {
      swiftHelperDisabledUntil = Date.now() + swiftHelperFailureBackoffMs;
    }
    debugLog("metadata", `swift-helper failed ${commandErrorDetails(error)}`);
    if (swiftHelperDisabledUntil > Date.now()) {
      debugLog("metadata", "swift-helper circuit-open reason=failure");
    }
    return null;
  }
}

async function getTrackFromSwiftMediaRemote(): Promise<ParsedMediaRemoteTrack | null> {
  if (swiftHelperInFlight) {
    debugLog("metadata", "swift-helper join-inflight");
    return swiftHelperInFlight;
  }

  swiftHelperInFlight = runSwiftMediaRemoteHelper().finally(() => {
    swiftHelperInFlight = null;
  });
  return swiftHelperInFlight;
}

function playbackClockKey(track: ParsedMediaRemoteTrack): string {
  return [
    track.sourceName,
    track.title.trim().toLowerCase(),
    track.artist.trim().toLowerCase(),
    track.album.trim().toLowerCase(),
    Math.round(track.duration)
  ].join("\u001f");
}

function estimatePlaybackPosition(track: ParsedMediaRemoteTrack): number {
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
  track: ParsedMediaRemoteTrack,
  incomingPosition: number,
  estimatedPosition: number,
  drift: number,
  mode: string
): void {
  if (process.env.MUSICVIS_DEBUG !== "1") {
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

function logCurrentLyric(line: string): void {
  if (!debugLyrics) {
    return;
  }
  log("info", `lyric="${line.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`);
}

function lyricQueryForTrack(track: ParsedMediaRemoteTrack): {
  artist: string;
  title: string;
  album: string;
  duration: number;
} {
  return {
    artist: track.artist,
    title: track.title,
    album: track.album,
    duration: track.duration
  };
}

function refreshLyricsInBackground(track: ParsedMediaRemoteTrack, position: number): void {
  const key = playbackClockKey(track);
  const now = Date.now();
  const lastStartedAt = lyricRefreshStartedAt.get(key) ?? 0;
  if (now - lastStartedAt < lyricRefreshIntervalMs) {
    return;
  }
  lyricRefreshStartedAt.set(key, now);
  void resolveCurrentLyrics(lyricQueryForTrack(track), position)
    .then(({ line }) => {
      logCurrentLyric(line);
      debugLog("lyrics", `background refresh done track="${track.artist} - ${track.title}" line="${line}"`);
    })
    .catch((error) => {
      debugLog("lyrics", `background refresh failed track="${track.artist} - ${track.title}" error="${String(error)}"`);
    });
}

function artworkExtension(mimeType: string | undefined): string {
  if (mimeType?.includes("png")) {
    return "png";
  }
  if (mimeType?.includes("webp")) {
    return "webp";
  }
  return "jpg";
}

function artworkPathForTrack(trackId: string, mimeType: string | undefined): string {
  const key = crypto.createHash("sha1").update(trackId).digest("hex");
  return path.join(artworkCacheDir(), `mediaremote-${key}.${artworkExtension(mimeType)}`);
}

function saveMediaRemoteArtwork(track: ParsedMediaRemoteTrack): string | null {
  const cached = artworkCache.get(track.id);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  if (!track.artworkDataBase64) {
    return null;
  }

  const folder = artworkCacheDir();
  fs.mkdirSync(folder, { recursive: true });
  const target = artworkPathForTrack(track.id, track.artworkMimeType);
  try {
    fs.writeFileSync(target, Buffer.from(track.artworkDataBase64, "base64"));
    artworkCache.set(track.id, target);
    debugLog("artwork", `mediaremote-artwork saved path="${target}" mime="${track.artworkMimeType ?? ""}"`);
    return target;
  } catch (error) {
    log("warn", `MediaRemote artwork save failed: ${String(error)}`);
    return null;
  }
}

export async function getCurrentTrack(): Promise<TrackInfo | null> {
  try {
    const parsed = await getTrackFromSwiftMediaRemote();
    if (!parsed) {
      debugLog("metadata", "no-track source=mediaremote-adapter");
      return null;
    }
    const estimatedPosition = estimatePlaybackPosition(parsed);
    const artworkPath = saveMediaRemoteArtwork(parsed);

    const lyrics = getCachedCurrentLyrics(lyricQueryForTrack(parsed), estimatedPosition);
    refreshLyricsInBackground(parsed, estimatedPosition);
    logCurrentLyric(lyrics.line);
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
    log("warn", `MediaRemote metadata request failed: ${String(error)}`);
    return null;
  }
}
