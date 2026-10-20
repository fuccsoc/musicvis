import type { TrackInfo } from "../shared/types";
import { lyricLineAt } from "../shared/lyrics";
import { resolveArtworkPath } from "./artwork";
import { getCachedLyrics, refreshLyrics } from "./lyrics";
import { debugLog, log } from "./logger";
import { selectTrack, type SourceEvent, type SourceName, type SourceTrack } from "./nowPlayingSource";

const debugLyrics = process.env.MUSICVIS_DEBUG_LYRICS === "1";
const sources: Record<SourceName, SourceTrack | null> = { mediaRemote: null, spotify: null };
let lastLoggedLyric = "";

/** Records the latest state reported by a source. */
export function applySourceEvent(event: SourceEvent): void {
  const previous = sources[event.source];
  let track = event.track;
  // The helper only sends artwork when it changes, so keep it for later updates of the same track.
  if (track && previous?.id === track.id && !track.artworkDataBase64 && previous.artworkDataBase64) {
    track = { ...track, artworkDataBase64: previous.artworkDataBase64, artworkMimeType: previous.artworkMimeType };
  }
  sources[event.source] = track;
  debugLog(
    "metadata",
    track
      ? `${event.source} track="${track.artist} - ${track.title}" position=${track.position.toFixed(2)} state=${track.playbackState}`
      : `${event.source} no-track`
  );
}

function logCurrentLyric(line: string): void {
  if (!debugLyrics || line === lastLoggedLyric) {
    return;
  }
  lastLoggedLyric = line;
  log("info", `lyric="${line.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`);
}

/** Builds the current track from the latest source state, kicking off lyric and artwork lookups. */
export function getCurrentTrack(): TrackInfo | null {
  const source = selectTrack(sources.spotify, sources.mediaRemote);
  if (!source) {
    return null;
  }

  const query = { artist: source.artist, title: source.title, album: source.album, duration: source.duration };
  const lyricLines = getCachedLyrics(query);
  refreshLyrics(query);

  if (debugLyrics) {
    const elapsed = source.playbackState === "playing" ? Math.max(0, Date.now() - source.positionTimestamp) / 1000 : 0;
    logCurrentLyric(lyricLineAt(lyricLines, source.position + elapsed));
  }

  return {
    id: source.id,
    title: source.title,
    artist: source.artist,
    album: source.album,
    sourceName: source.sourceName,
    duration: source.duration,
    position: source.position,
    playbackState: source.playbackState,
    artworkPath: resolveArtworkPath(source),
    lyricLines,
    positionUpdatedAt: source.positionTimestamp
  };
}
