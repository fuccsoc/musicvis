import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedMediaRemoteTrack } from "./mediaRemote";
import { log } from "./logger";

const execFileAsync = promisify(execFile);
// Individual getters avoid Spotify's broken JXA properties() AppleEvent handler.
export const spotifyScript = `
var spotify = Application("com.spotify.client");
var result = null;
if (spotify.running()) {
  var track = spotify.currentTrack;
  var before = track.id();
  result = {
    id: before, title: track.name(), artist: track.artist(), album: track.album(),
    duration: track.duration(), position: spotify.playerPosition(),
    playbackState: spotify.playerState(), artworkUrl: track.artworkUrl()
  };
  if (before !== track.id()) result = null;
}
JSON.stringify(result);
`;

export function parseSpotifyResponse(raw: string): ParsedMediaRemoteTrack | null {
  const data = JSON.parse(raw.trim());
  if (!data || typeof data.title !== "string" || !data.title ||
      !["playing", "paused", "stopped"].includes(data.playbackState)) return null;
  return {
    id: typeof data.id === "string" ? data.id : `spotify::${data.artist}::${data.title}`,
    title: data.title,
    artist: typeof data.artist === "string" ? data.artist : "",
    album: typeof data.album === "string" ? data.album : "",
    sourceName: "Spotify",
    // Spotify returns milliseconds despite the scripting dictionary saying seconds.
    duration: Number.isFinite(data.duration) ? Math.max(0, data.duration / 1000) : 0,
    position: Number.isFinite(data.position) ? Math.max(0, data.position) : 0,
    playbackState: data.playbackState,
    positionReliable: true,
    artworkUrl: typeof data.artworkUrl === "string" ? data.artworkUrl : undefined
  };
}

export function selectTrack(
  spotify: ParsedMediaRemoteTrack | null,
  system: ParsedMediaRemoteTrack | null
): ParsedMediaRemoteTrack | null {
  if (!spotify) return system;
  if (spotify.playbackState === "playing") return spotify;
  // A paused Spotify must override a stale Spotify system session, but not
  // another actively selected player.
  if (system && !/spotify/i.test(system.sourceName)) return system;
  return spotify;
}

let inFlight: Promise<ParsedMediaRemoteTrack | null> | null = null;
let retryAt = 0;

export function getSpotifyTrack(): Promise<ParsedMediaRemoteTrack | null> {
  if (process.env.MUSICVIS_SPOTIFY_DIRECT === "0" || Date.now() < retryAt) return Promise.resolve(null);
  if (inFlight) return inFlight;
  inFlight = execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", spotifyScript], {
    timeout: 2000, maxBuffer: 256 * 1024
  }).then(({ stdout }) => parseSpotifyResponse(stdout)).catch((error: unknown) => {
    retryAt = Date.now() + 30_000;
    log("warn", `Direct Spotify query failed; using MediaRemote, retry in 30s: ${String(error)}`);
    return null;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
