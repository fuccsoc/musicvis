import type { PlaybackState } from "../shared/types";
import { HelperProcess } from "./helperProcess";
import { log } from "./logger";

export type SourceName = "mediaRemote" | "spotify";

/** Track metadata as reported by a now-playing source (MediaRemote or Spotify). */
export interface SourceTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  sourceName: string;
  duration: number;
  /** Playback position in seconds, valid at `positionTimestamp`. */
  position: number;
  /** Epoch milliseconds. */
  positionTimestamp: number;
  playbackState: PlaybackState;
  artworkDataBase64?: string;
  artworkMimeType?: string;
  artworkUrl?: string;
}

export interface SourceEvent {
  source: SourceName;
  track: SourceTrack | null;
}

const playbackStates: PlaybackState[] = ["playing", "paused", "stopped"];

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseSourceTrack(value: unknown): SourceTrack | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const data = value as Record<string, unknown>;
  const title = optionalString(data.title);
  if (!title) {
    return null;
  }
  const artist = optionalString(data.artist) ?? "";
  const sourceName = optionalString(data.sourceName) ?? "System audio";
  return {
    id: optionalString(data.id) ?? [sourceName, title, artist].join("::"),
    title,
    artist,
    album: optionalString(data.album) ?? "",
    sourceName,
    duration: Math.max(0, finiteNumber(data.duration)),
    position: Math.max(0, finiteNumber(data.position)),
    positionTimestamp: finiteNumber(data.positionTimestamp, Date.now()),
    playbackState: playbackStates.includes(data.playbackState as PlaybackState) ? (data.playbackState as PlaybackState) : "paused",
    artworkDataBase64: optionalString(data.artworkDataBase64),
    artworkMimeType: optionalString(data.artworkMimeType),
    artworkUrl: optionalString(data.artworkUrl)
  };
}

export function parseSourceEventLine(line: string): SourceEvent | null {
  try {
    const payload = JSON.parse(line) as { type?: unknown; track?: unknown };
    if (payload.type !== "mediaRemote" && payload.type !== "spotify") {
      return null;
    }
    return { source: payload.type, track: parseSourceTrack(payload.track) };
  } catch {
    return null;
  }
}

export function selectTrack(spotify: SourceTrack | null, system: SourceTrack | null): SourceTrack | null {
  if (!spotify) return system;
  if (spotify.playbackState === "playing") return spotify;
  // A paused Spotify must override a stale Spotify system session, but not
  // another actively selected player.
  if (system && !/spotify/i.test(system.sourceName)) return system;
  return spotify;
}

/** Runs the MediaRemoteHelper, which streams MediaRemote and Spotify changes. */
export function createNowPlayingSource(onEvent: (event: SourceEvent) => void): HelperProcess<SourceEvent> {
  return new HelperProcess<SourceEvent>({
    name: "MediaRemoteHelper",
    debugEnv: "MUSICVIS_DEBUG",
    parseLine: parseSourceEventLine,
    onEvent,
    onError: (message) => log("warn", message)
  });
}
