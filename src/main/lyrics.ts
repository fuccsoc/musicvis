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

export interface TimedLyricLine {
  time: number;
  text: string;
}

interface LyricsCacheEntry {
  lines: TimedLyricLine[] | null;
  timestamp: number;
}

interface LyricsFetchResult {
  lines: TimedLyricLine[] | null;
  transientFailure: boolean;
}

const lyricsCache = new Map<string, LyricsCacheEntry>();
const lyricsInFlight = new Map<string, Promise<LyricsFetchResult>>();
const loggedKeys = new Set<string>();
const debugLyrics = process.env.MUSICVIS_DEBUG === "1";
const lyricLineOnlyDebug = process.env.MUSICVIS_DEBUG_LYRICS === "1" && process.env.MUSICVIS_DEBUG !== "1";
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

function lyricsResult(lines: TimedLyricLine[] | null, transientFailure = false): LyricsFetchResult {
  return { lines, transientFailure };
}

function isTransientLyricsFailure(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

async function readLyricsJson<T>(response: Response, label: string): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    debugLog("lyrics", `${label} json failed error="${String(error)}"`);
    return null;
  }
}

async function firstLyricsResult(tasks: Array<Promise<LyricsFetchResult>>, label: string): Promise<LyricsFetchResult> {
  if (!tasks.length) {
    return lyricsResult(null);
  }

  return new Promise((resolve) => {
    let pending = tasks.length;
    let settled = false;
    let transientFailure = false;
    const finishEmpty = (): void => {
      pending -= 1;
      if (!settled && pending === 0) {
        settled = true;
        resolve(lyricsResult(null, transientFailure));
      }
    };

    for (const task of tasks) {
      void task
        .then((result) => {
          transientFailure ||= result.transientFailure;
          if (settled) {
            return;
          }
          if (result.lines) {
            settled = true;
            resolve(result);
            return;
          }
          finishEmpty();
        })
        .catch((error) => {
          debugLog("lyrics", `${label} failed error="${String(error)}"`);
          transientFailure = true;
          finishEmpty();
        });
    }
  });
}

async function fetchExactLyrics(
  query: LyricsQuery,
  candidate: { artist: string; title: string; album: string }
): Promise<LyricsFetchResult> {
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

  let transientFailure = false;
  for (const params of attempts) {
    debugLog("lyrics", `lrclib exact request params="${params.toString()}"`);
    const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      transientFailure ||= isTransientLyricsFailure(response?.status);
      debugLog("lyrics", `lrclib exact failed http=${response?.status ?? "network"}`);
      continue;
    }

    const payload = await readLyricsJson<LyricsResponse>(response, "lrclib exact");
    if (!payload) {
      transientFailure = true;
      continue;
    }

    const lines = parseLyricsPayload(payload);
    if (lines) {
      debugLog("lyrics", `lrclib exact hit lines=${lines.length}`);
      return lyricsResult(lines);
    }
    debugLog("lyrics", "lrclib exact empty");
  }

  return lyricsResult(null, transientFailure);
}

async function fetchSearchLyrics(
  candidate: { artist: string; title: string; album: string }
): Promise<LyricsFetchResult> {
  const attempts = [
    new URLSearchParams({
      track_name: candidate.title,
      artist_name: candidate.artist
    }),
    new URLSearchParams({
      q: [candidate.artist, candidate.title, candidate.album].filter(Boolean).join(" ")
    })
  ];

  let transientFailure = false;
  for (const params of attempts) {
    debugLog("lyrics", `lrclib search request params="${params.toString()}"`);
    const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
      headers: {
        "User-Agent": "musicvis/0.1.0"
      }
    }).catch(() => null);

    if (!response?.ok) {
      transientFailure ||= isTransientLyricsFailure(response?.status);
      debugLog("lyrics", `lrclib search failed http=${response?.status ?? "network"}`);
      continue;
    }

    const payload = await readLyricsJson<LyricsResponse[]>(response, "lrclib search");
    if (!payload) {
      transientFailure = true;
      continue;
    }

    debugLog("lyrics", `lrclib search results=${payload.length}`);
    for (const item of payload) {
      const lines = parseLyricsPayload(item);
      if (lines) {
        debugLog("lyrics", `lrclib search hit lines=${lines.length}`);
        return lyricsResult(lines);
      }
    }
  }

  return lyricsResult(null, transientFailure);
}

async function fetchLrclibLyrics(query: LyricsQuery): Promise<LyricsFetchResult> {
  return firstLyricsResult(
    lyricQueries(query).map(async (candidate) => {
      const exact = await fetchExactLyrics(query, candidate);
      if (exact.lines) {
        return exact;
      }

      const searched = await fetchSearchLyrics(candidate);
      return lyricsResult(searched.lines, exact.transientFailure || searched.transientFailure);
    }),
    "lrclib provider"
  );
}

async function fetchLyrics(query: LyricsQuery): Promise<LyricsFetchResult> {
  return fetchLrclibLyrics(query);
}

export async function resolveCurrentLyricLine(query: LyricsQuery, position: number): Promise<string> {
  return (await resolveCurrentLyrics(query, position)).line;
}

export function getCachedCurrentLyrics(
  query: LyricsQuery,
  position: number
): { line: string; lines: TimedLyricLine[]; hasCache: boolean } {
  const key = cacheKey(query);
  const lines = lyricsCache.get(key)?.lines ?? null;
  const line = lyricLineAt(lines, position);
  debugLyricLine(key, position, line, lines?.length ?? 0);
  return { line, lines: lines ?? [], hasCache: lyricsCache.has(key) };
}

export async function resolveCurrentLyrics(
  query: LyricsQuery,
  position: number
): Promise<{ line: string; lines: TimedLyricLine[] }> {
  const key = cacheKey(query);
  const cached = lyricsCache.get(key);
  if (!cached || (!cached.lines && Date.now() - cached.timestamp > missTtlMs)) {
    let linesPromise = lyricsInFlight.get(key);
    if (!linesPromise) {
      debugLog("lyrics", cached ? `cache retry key="${key}"` : `cache miss key="${key}"`);
      linesPromise = fetchLyrics(query).finally(() => {
        lyricsInFlight.delete(key);
      });
      lyricsInFlight.set(key, linesPromise);
    } else {
      debugLog("lyrics", `cache join-inflight key="${key}"`);
    }
    const result = await linesPromise;
    if (result.lines || !result.transientFailure) {
      lyricsCache.set(key, {
        lines: result.lines,
        timestamp: Date.now()
      });
    }
    if (!lyricLineOnlyDebug && !loggedKeys.has(key) && (result.lines || !result.transientFailure)) {
      loggedKeys.add(key);
      const label = [cleanText(query.artist), cleanText(query.title)].filter(Boolean).join(" - ");
      log("info", result.lines ? `Lyrics found for ${label}: ${result.lines.length} synced lines` : `No synced lyrics found for ${label}`);
    } else if (result.transientFailure) {
      debugLog("lyrics", `lookup transient failure key="${key}"`);
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
