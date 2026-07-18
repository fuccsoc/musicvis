import { log } from "./logger";

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

interface TimedLyricLine {
  time: number;
  text: string;
}

interface LyricsCacheEntry {
  lines: TimedLyricLine[] | null;
  timestamp: number;
}

const lyricsCache = new Map<string, LyricsCacheEntry>();
const loggedKeys = new Set<string>();
const lastLineLog = new Map<string, string>();
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
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      continue;
    }

    const lines = parseLyricsPayload((await response.json()) as LyricsResponse);
    if (lines) {
      return lines;
    }
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
    const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      continue;
    }

    const payload = (await response.json()) as LyricsResponse[];
    for (const item of payload) {
      const lines = parseLyricsPayload(item);
      if (lines) {
        return lines;
      }
    }
  }

  return null;
}

async function fetchLyrics(query: LyricsQuery): Promise<TimedLyricLine[] | null> {
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
  const key = cacheKey(query);
  const cached = lyricsCache.get(key);
  if (!cached || (!cached.lines && Date.now() - cached.timestamp > missTtlMs)) {
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
  }
  const lines = lyricsCache.get(key)?.lines ?? null;
  const line = lyricLineAt(lines, position);
  if (lines?.length) {
    const signature = `${line}::${Math.floor(position / 5)}`;
    if (lastLineLog.get(key) !== signature) {
      lastLineLog.set(key, signature);
      log("info", line ? `Lyric line at ${position.toFixed(1)}s: ${line}` : `No active lyric line at ${position.toFixed(1)}s`);
    }
  }
  return line;
}
