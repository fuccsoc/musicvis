export interface LyricsQuery {
  artist: string;
  title: string;
  album: string;
  duration: number;
}

interface LyricsResponse {
  syncedLyrics?: string | null;
  instrumental?: boolean;
}

interface TimedLyricLine {
  time: number;
  text: string;
}

const lyricsCache = new Map<string, TimedLyricLine[] | null>();

function cleanText(value: string): string {
  return value
    .replace(/\s*\([^)]*(official|audio|video|lyrics|remaster|remastered)[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*(official|audio|video|lyrics|remaster|remastered)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchLyrics(query: LyricsQuery): Promise<TimedLyricLine[] | null> {
  if (!query.title || !query.artist) {
    return null;
  }

  const baseParams = new URLSearchParams({
    track_name: cleanText(query.title),
    artist_name: cleanText(query.artist)
  });
  const album = cleanText(query.album);
  if (album) {
    baseParams.set("album_name", album);
  }

  const candidates = [baseParams];
  if (query.duration > 0) {
    const withDuration = new URLSearchParams(baseParams);
    withDuration.set("duration", String(Math.round(query.duration)));
    candidates.unshift(withDuration);
  }

  for (const params of candidates) {
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      continue;
    }

    const payload = (await response.json()) as LyricsResponse;
    if (payload.instrumental || !payload.syncedLyrics) {
      continue;
    }
    return parseSyncedLyrics(payload.syncedLyrics);
  }

  return null;
}

export async function resolveCurrentLyricLine(query: LyricsQuery, position: number): Promise<string> {
  const key = cacheKey(query);
  if (!lyricsCache.has(key)) {
    lyricsCache.set(key, await fetchLyrics(query));
  }
  return lyricLineAt(lyricsCache.get(key) ?? null, position);
}
