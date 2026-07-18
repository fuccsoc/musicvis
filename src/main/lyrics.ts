import { debugLog, log } from "./logger";

export interface LyricsQuery {
  artist: string;
  title: string;
  album: string;
  duration: number;
}

interface LyricsResponse {
  trackName?: string;
  artistName?: string;
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

interface MusixmatchMessage<T> {
  message?: {
    header?: {
      status_code?: number;
    };
    body?: T;
  };
}

interface MusixmatchTrack {
  track_id?: number;
  has_subtitles?: number;
  has_richsync?: number;
}

interface MusixmatchTrackBody {
  track?: MusixmatchTrack;
}

interface MusixmatchSubtitleBody {
  subtitle?: {
    subtitle_body?: string;
  };
}

interface MusixmatchRichsyncBody {
  richsync?: {
    richsync_body?: string;
  };
}

interface MusixmatchTimedLine {
  text?: string;
  time?: {
    total?: number;
  };
  ts?: number;
}

export interface TimedLyricLine {
  time: number;
  text: string;
}

interface LyricsCacheEntry {
  lines: TimedLyricLine[] | null;
  timestamp: number;
}

const lyricsCache = new Map<string, LyricsCacheEntry>();
const loggedKeys = new Set<string>();
const debugLyrics = process.env.MUSICVIS_DEBUG_LYRICS === "1";
const lastDebugByKey = new Map<string, string>();
const missTtlMs = 5 * 60 * 1000;

function cleanText(value: string): string {
  return value
    .replace(/\s*\([^)]*(official|audio|video|lyrics|remaster|remastered)[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*(official|audio|video|lyrics|remaster|remastered)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTitleArtist(title: string): { artist: string; title: string } | null {
  const match = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (!match) {
    return null;
  }
  return {
    artist: cleanText(match[1]),
    title: cleanText(match[2])
  };
}

function cacheKey(query: LyricsQuery): string {
  return [cleanText(query.artist), cleanText(query.title), cleanText(query.album), Math.round(query.duration)].join("::");
}

function parseTimestamp(raw: string): number | null {
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

export function parseSyncedLyrics(raw: string): TimedLyricLine[] {
  const lines: TimedLyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\]/g)];
    if (!matches.length) {
      continue;
    }
    const text = line.replace(/\[[^\]]+\]/g, "").trim();
    for (const match of matches) {
      const time = parseTimestamp(match[1]);
      if (time !== null) {
        lines.push({ time, text });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export function parseMusixmatchSubtitleBody(raw: string): TimedLyricLine[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as MusixmatchTimedLine[] | { body?: MusixmatchTimedLine[] };
      const items = Array.isArray(parsed) ? parsed : parsed.body ?? [];
      const lines = items
        .map((item) => ({
          time: Number(item.time?.total ?? item.ts),
          text: item.text?.trim() ?? ""
        }))
        .filter((line) => Number.isFinite(line.time));
      if (lines.length) {
        return lines.sort((a, b) => a.time - b.time);
      }
    } catch {
      // Some Musixmatch plans return LRC-style subtitle bodies instead of JSON.
    }
  }

  return parseSyncedLyrics(trimmed);
}

export function lyricLineAt(lines: TimedLyricLine[] | null, position: number): string {
  if (!lines?.length || position < 0) {
    return "";
  }

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= position + 0.25) {
      activeIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex >= 0 ? lines[activeIndex].text : "";
}

function lyricQueries(query: LyricsQuery): Array<{ artist: string; title: string; album: string }> {
  const artist = cleanText(query.artist);
  const title = cleanText(query.title);
  const album = cleanText(query.album);
  const fromTitle = splitTitleArtist(title);
  return Array.from(
    new Map(
      [
        { artist, title, album },
        fromTitle ? { ...fromTitle, album } : null
      ]
        .filter((item): item is { artist: string; title: string; album: string } => Boolean(item?.artist && item.title))
        .map((item) => [`${item.artist}::${item.title}::${item.album}`, item])
    ).values()
  );
}

function parseLyricsPayload(payload: LyricsResponse | null): TimedLyricLine[] | null {
  if (!payload?.syncedLyrics || payload.instrumental) {
    return null;
  }
  const lines = parseSyncedLyrics(payload.syncedLyrics);
  return lines.length ? lines : null;
}

function parseMusixmatchPayload(raw: string | undefined): TimedLyricLine[] | null {
  if (!raw) {
    return null;
  }
  const lines = parseMusixmatchSubtitleBody(raw);
  return lines.length ? lines : null;
}

async function musixmatchGet<T>(method: string, params: URLSearchParams): Promise<T | null> {
  const apiKey = process.env.MUSIXMATCH_API_KEY;
  if (!apiKey) {
    debugLog("lyrics", `musixmatch skip method=${method} reason=no-api-key`);
    return null;
  }

  params.set("apikey", apiKey);
  debugLog("lyrics", `musixmatch request method=${method}`);
  const response = await fetch(`https://api.musixmatch.com/ws/1.1/${method}?${params.toString()}`).catch(() => null);
  if (!response?.ok) {
    debugLog("lyrics", `musixmatch failed method=${method} http=${response?.status ?? "network"}`);
    return null;
  }

  const payload = (await response.json()) as MusixmatchMessage<T>;
  const status = payload.message?.header?.status_code ?? 0;
  if (status !== 200) {
    debugLog("lyrics", `musixmatch rejected method=${method} status=${status}`);
    return null;
  }
  debugLog("lyrics", `musixmatch ok method=${method}`);
  return payload.message?.body ?? null;
}

async function fetchMusixmatchByMatcher(
  query: LyricsQuery,
  candidate: { artist: string; title: string; album: string }
): Promise<TimedLyricLine[] | null> {
  const params = new URLSearchParams({
    q_track: candidate.title,
    q_artist: candidate.artist
  });
  if (candidate.album) {
    params.set("q_album", candidate.album);
  }
  if (query.duration > 0) {
    params.set("f_subtitle_length", String(Math.round(query.duration)));
  }

  const body = await musixmatchGet<MusixmatchSubtitleBody>("matcher.subtitle.get", params);
  return parseMusixmatchPayload(body?.subtitle?.subtitle_body);
}

async function fetchMusixmatchByTrackId(
  query: LyricsQuery,
  candidate: { artist: string; title: string; album: string }
): Promise<TimedLyricLine[] | null> {
  const matchParams = new URLSearchParams({
    q_track: candidate.title,
    q_artist: candidate.artist
  });
  if (candidate.album) {
    matchParams.set("q_album", candidate.album);
  }
  if (query.duration > 0) {
    matchParams.set("f_track_length", String(Math.round(query.duration)));
  }

  const trackBody = await musixmatchGet<MusixmatchTrackBody>("matcher.track.get", matchParams);
  const track = trackBody?.track;
  if (!track?.track_id) {
    return null;
  }

  if (track.has_richsync) {
    const richsyncBody = await musixmatchGet<MusixmatchRichsyncBody>(
      "track.richsync.get",
      new URLSearchParams({ track_id: String(track.track_id) })
    );
    const richsync = parseMusixmatchPayload(richsyncBody?.richsync?.richsync_body);
    if (richsync) {
      return richsync;
    }
  }

  if (!track.has_subtitles && !track.has_richsync) {
    return null;
  }

  const subtitleBody = await musixmatchGet<MusixmatchSubtitleBody>(
    "track.subtitle.get",
    new URLSearchParams({ track_id: String(track.track_id) })
  );
  return parseMusixmatchPayload(subtitleBody?.subtitle?.subtitle_body);
}

async function fetchMusixmatchLyrics(query: LyricsQuery): Promise<TimedLyricLine[] | null> {
  if (!process.env.MUSIXMATCH_API_KEY) {
    debugLog("lyrics", "musixmatch provider skip reason=no-api-key");
    return null;
  }

  for (const candidate of lyricQueries(query)) {
    debugLog("lyrics", `musixmatch candidate artist="${candidate.artist}" title="${candidate.title}" album="${candidate.album}"`);
    const matchedSubtitle = await fetchMusixmatchByMatcher(query, candidate);
    if (matchedSubtitle) {
      debugLog("lyrics", `musixmatch hit source=matcher lines=${matchedSubtitle.length}`);
      return matchedSubtitle;
    }

    const trackSubtitle = await fetchMusixmatchByTrackId(query, candidate);
    if (trackSubtitle) {
      debugLog("lyrics", `musixmatch hit source=track lines=${trackSubtitle.length}`);
      return trackSubtitle;
    }
  }

  return null;
}

async function fetchExactLyrics(
  query: LyricsQuery,
  candidate: { artist: string; title: string; album: string }
): Promise<TimedLyricLine[] | null> {
  const baseParams = new URLSearchParams({
    track_name: candidate.title,
    artist_name: candidate.artist
  });
  if (candidate.album) {
    baseParams.set("album_name", candidate.album);
  }

  const attempts = [baseParams];
  if (query.duration > 0) {
    const withDuration = new URLSearchParams(baseParams);
    withDuration.set("duration", String(Math.round(query.duration)));
    attempts.unshift(withDuration);
  }

  for (const params of attempts) {
    debugLog("lyrics", `lrclib exact request params="${params.toString()}"`);
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      debugLog("lyrics", `lrclib exact failed http=${response?.status ?? "network"}`);
      continue;
    }

    const lines = parseLyricsPayload((await response.json()) as LyricsResponse);
    if (lines) {
      debugLog("lyrics", `lrclib exact hit lines=${lines.length}`);
      return lines;
    }
    debugLog("lyrics", "lrclib exact empty");
  }

  return null;
}

async function fetchSearchLyrics(
  candidate: { artist: string; title: string; album: string }
): Promise<TimedLyricLine[] | null> {
  const attempts = [
    new URLSearchParams({
      track_name: candidate.title,
      artist_name: candidate.artist
    }),
    new URLSearchParams({
      q: [candidate.artist, candidate.title, candidate.album].filter(Boolean).join(" ")
    })
  ];

  for (const params of attempts) {
    debugLog("lyrics", `lrclib search request params="${params.toString()}"`);
    const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      debugLog("lyrics", `lrclib search failed http=${response?.status ?? "network"}`);
      continue;
    }

    const payload = (await response.json()) as LyricsResponse[];
    debugLog("lyrics", `lrclib search results=${payload.length}`);
    for (const item of payload) {
      const lines = parseLyricsPayload(item);
      if (lines) {
        debugLog("lyrics", `lrclib search hit lines=${lines.length}`);
        return lines;
      }
    }
  }

  return null;
}

async function fetchLyrics(query: LyricsQuery): Promise<TimedLyricLine[] | null> {
  const musixmatch = await fetchMusixmatchLyrics(query);
  if (musixmatch) {
    return musixmatch;
  }

  for (const candidate of lyricQueries(query)) {
    const exact = await fetchExactLyrics(query, candidate);
    if (exact) {
      return exact;
    }

    const searched = await fetchSearchLyrics(candidate);
    if (searched) {
      return searched;
    }
  }

  return null;
}

export async function resolveCurrentLyricLine(query: LyricsQuery, position: number): Promise<string> {
  return (await resolveCurrentLyrics(query, position)).line;
}

export async function resolveCurrentLyrics(
  query: LyricsQuery,
  position: number
): Promise<{ line: string; lines: TimedLyricLine[] }> {
  const key = cacheKey(query);
  const cached = lyricsCache.get(key);
  if (!cached || (!cached.lines && Date.now() - cached.timestamp > missTtlMs)) {
    debugLog("lyrics", cached ? `cache retry key="${key}"` : `cache miss key="${key}"`);
    const lines = await fetchLyrics(query);
    lyricsCache.set(key, {
      lines,
      timestamp: Date.now()
    });
    if (!loggedKeys.has(key)) {
      loggedKeys.add(key);
      const label = [cleanText(query.artist), cleanText(query.title)].filter(Boolean).join(" - ");
      log("info", lines ? `Lyrics found for ${label}: ${lines.length} synced lines` : `No synced lyrics found for ${label}`);
    }
  } else {
    debugLog("lyrics", `cache hit key="${key}" lines=${cached.lines?.length ?? 0}`);
  }
  const lines = lyricsCache.get(key)?.lines ?? null;
  const line = lyricLineAt(lines, position);
  debugLyricLine(key, position, line, lines?.length ?? 0);
  return { line, lines: lines ?? [] };
}

function debugLyricLine(key: string, position: number, line: string, lineCount: number): void {
  if (!debugLyrics || !lineCount) {
    return;
  }
  const signature = `${line}::${Math.floor(position)}`;
  if (lastDebugByKey.get(key) === signature) {
    return;
  }
  lastDebugByKey.set(key, signature);
  log(
    "info",
    line
      ? `lyrics-debug line position=${position.toFixed(2)} lines=${lineCount} text="${line}"`
      : `lyrics-debug line position=${position.toFixed(2)} lines=${lineCount} text=""`
  );
}
