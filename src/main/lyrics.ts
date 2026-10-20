import type { TimedLyricLine } from "../shared/types";
import { debugLog, log } from "./logger";

export { lyricLineAt } from "../shared/lyrics";

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

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseSong[];
  };
}

interface NeteaseSong {
  id?: number;
  name?: string;
  duration?: number;
  album?: {
    name?: string;
  };
}

interface NeteaseLyricsResponse {
  lrc?: {
    lyric?: string;
  };
}

interface MusixmatchMessage<T> {
  message?: {
    header?: {
      status_code?: number;
      mode?: string;
    };
    body?: T;
  };
}

interface MusixmatchTokenBody {
  user_token?: string;
}

interface MusixmatchMacroBody {
  macro_calls?: {
    "matcher.track.get"?: MusixmatchMessage<{
      track?: {
        instrumental?: boolean;
        has_subtitles?: number;
      };
    }>;
    "track.subtitles.get"?: MusixmatchMessage<{
      subtitle_list?: Array<{
        subtitle?: {
          subtitle_body?: string;
        };
      }>;
    }>;
    "track.lyrics.get"?: MusixmatchMessage<{
      lyrics?: {
        restricted?: boolean;
      };
    }>;
  };
}

interface MusixmatchTimedLine {
  text?: string;
  time?: {
    total?: number;
  };
  ts?: number;
}

interface LyricsCacheEntry {
  lines: TimedLyricLine[] | null;
  timestamp: number;
}

interface LyricsFetchResult {
  lines: TimedLyricLine[] | null;
  transientFailure: boolean;
}

interface JsonResult<T> {
  payload: T | null;
  transientFailure: boolean;
}

const maxCacheEntries = 300;
const missTtlMs = 5 * 60 * 1000;
const refreshIntervalMs = 10_000;
const requestTimeoutMs = 8000;
const lyricsCache = new Map<string, LyricsCacheEntry>();
const lyricsInFlight = new Map<string, Promise<LyricsFetchResult>>();
const refreshStartedAt = new Map<string, number>();
const logLookups = !(process.env.MUSICVIS_DEBUG_LYRICS === "1" && process.env.MUSICVIS_DEBUG !== "1");
const lrclibHeaders = {
  "User-Agent": "musicvis (https://github.com/fuccsoc/musicvis)"
};
const neteaseBaseUrl = "https://music.xianqiao.wang/neteaseapiv2";
const neteaseHeaders = {
  "User-Agent": "Mozilla/5.0 musicvis"
};
const musixmatchBaseUrl = "https://apic-appmobile.musixmatch.com/ws/1.1";
const musixmatchHeaders = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Cookie": "x-mxm-token-guid=",
  "X-User-Agent": "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0",
  "x-mxm-app-version": "10.1.1"
};
let musixmatchToken: string | null = null;
let musixmatchTokenPromise: Promise<string | null> | null = null;
let musixmatchTokenRetryAfter = 0;

function cleanText(value: string): string {
  return value
    .replace(/\s*\([^)]*(official|audio|video|lyrics|remaster|remastered)[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*(official|audio|video|lyrics|remaster|remastered)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProviderText(value: string): string {
  return cleanText(value)
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/【/g, "[")
    .replace(/】/g, "]")
    .replace(/[’‘′＇]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function stripProviderTitleNoise(value: string): string {
  return normalizeProviderText(value)
    .replace(/\s+(feat|ft|with|prod)\.?\s+.*$/i, "")
    .replace(/\s*[-–—]\s+.*$/i, "")
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
        .filter((line) => Number.isFinite(line.time) && line.text);
      if (lines.length) {
        return lines.sort((a, b) => a.time - b.time);
      }
    } catch {
      debugLog("lyrics", "musixmatch subtitle json parse failed");
    }
  }

  return parseSyncedLyrics(trimmed);
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

function filterLyricCredits(lines: TimedLyricLine[]): TimedLyricLine[] {
  const creditPattern =
    /^(作?词|作?曲|编曲|监制|制作|出品|发行|后期|混音|lrc|publish|vocal|guitar|program|produce|write|mix)\s*[:：]/i;
  return lines.filter((line) => line.text && line.text !== "纯音乐, 请欣赏" && !creditPattern.test(line.text));
}

function lyricsResult(lines: TimedLyricLine[] | null, transientFailure = false): LyricsFetchResult {
  return { lines, transientFailure };
}

function isTransientLyricsFailure(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

async function fetchJson<T>(url: string, headers: Record<string, string>, label: string): Promise<JsonResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
  } catch (error) {
    debugLog("lyrics", `${label} failed error="${String(error)}"`);
    return { payload: null, transientFailure: true };
  }
  if (!response.ok) {
    debugLog("lyrics", `${label} failed http=${response.status}`);
    return { payload: null, transientFailure: isTransientLyricsFailure(response.status) };
  }
  try {
    return { payload: (await response.json()) as T, transientFailure: false };
  } catch (error) {
    debugLog("lyrics", `${label} json failed error="${String(error)}"`);
    return { payload: null, transientFailure: true };
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
    const result = await fetchJson<LyricsResponse>(`https://lrclib.net/api/get?${params.toString()}`, lrclibHeaders, "lrclib exact");
    transientFailure ||= result.transientFailure;
    const lines = parseLyricsPayload(result.payload);
    if (lines) {
      debugLog("lyrics", `lrclib exact hit lines=${lines.length}`);
      return lyricsResult(lines);
    }
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
    const result = await fetchJson<LyricsResponse[]>(`https://lrclib.net/api/search?${params.toString()}`, lrclibHeaders, "lrclib search");
    transientFailure ||= result.transientFailure;
    for (const item of Array.isArray(result.payload) ? result.payload : []) {
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

function chooseNeteaseSong(query: LyricsQuery, songs: NeteaseSong[]): NeteaseSong | null {
  const album = normalizeProviderText(query.album);
  const title = stripProviderTitleNoise(query.title);
  const durationMs = query.duration > 0 ? query.duration * 1000 : 0;

  return (
    songs.find((song) => Boolean(album && normalizeProviderText(song.album?.name ?? "") === album)) ??
    songs.find((song) => Boolean(durationMs && Math.abs(durationMs - (song.duration ?? 0)) < 3000)) ??
    songs.find((song) => normalizeProviderText(song.name ?? "") === title) ??
    null
  );
}

async function fetchNeteaseLyrics(query: LyricsQuery): Promise<LyricsFetchResult> {
  const title = stripProviderTitleNoise(query.title);
  const search = [title, cleanText(query.artist)].filter(Boolean).join(" ");
  if (!search) {
    return lyricsResult(null);
  }

  const searchParams = new URLSearchParams({
    limit: "10",
    type: "1",
    keywords: search
  });
  debugLog("lyrics", `netease search request params="${searchParams.toString()}"`);
  const searched = await fetchJson<NeteaseSearchResponse>(`${neteaseBaseUrl}/search?${searchParams.toString()}`, neteaseHeaders, "netease search");
  if (!searched.payload) {
    return lyricsResult(null, searched.transientFailure);
  }

  const songs = searched.payload.result?.songs ?? [];
  const song = chooseNeteaseSong(query, songs);
  if (!song?.id) {
    debugLog("lyrics", `netease search no-match results=${songs.length}`);
    return lyricsResult(null);
  }

  debugLog("lyrics", `netease lyric request id=${song.id}`);
  const lyric = await fetchJson<NeteaseLyricsResponse>(`${neteaseBaseUrl}/lyric?id=${song.id}`, neteaseHeaders, "netease lyric");
  if (!lyric.payload) {
    return lyricsResult(null, lyric.transientFailure);
  }

  const lines = filterLyricCredits(parseSyncedLyrics(lyric.payload.lrc?.lyric ?? ""));
  if (!lines.length) {
    debugLog("lyrics", "netease lyric empty");
    return lyricsResult(null);
  }

  debugLog("lyrics", `netease hit lines=${lines.length}`);
  return lyricsResult(lines);
}

async function requestMusixmatchToken(): Promise<string | null> {
  debugLog("lyrics", "musixmatch token request");
  const result = await fetchJson<MusixmatchMessage<MusixmatchTokenBody>>(
    `${musixmatchBaseUrl}/token.get?app_id=mac-ios-v2.0`,
    musixmatchHeaders,
    "musixmatch token"
  );
  if (!result.payload) {
    musixmatchTokenRetryAfter = Date.now() + (result.transientFailure ? 30_000 : 120_000);
    return null;
  }
  const status = result.payload.message?.header?.status_code ?? 0;
  const token = result.payload.message?.body?.user_token ?? null;
  if (status !== 200 || !token) {
    debugLog("lyrics", `musixmatch token rejected status=${status}`);
    musixmatchTokenRetryAfter = Date.now() + (isTransientLyricsFailure(status) || status === 401 ? 120_000 : 300_000);
    return null;
  }
  debugLog("lyrics", "musixmatch token ok");
  musixmatchToken = token;
  musixmatchTokenRetryAfter = 0;
  return token;
}

async function getMusixmatchToken(): Promise<string | null> {
  if (musixmatchToken) {
    return musixmatchToken;
  }
  if (Date.now() < musixmatchTokenRetryAfter) {
    debugLog("lyrics", "musixmatch token skip reason=backoff");
    return null;
  }
  musixmatchTokenPromise ??= requestMusixmatchToken().finally(() => {
    musixmatchTokenPromise = null;
  });
  return musixmatchTokenPromise;
}

async function fetchMusixmatchLyrics(query: LyricsQuery): Promise<LyricsFetchResult> {
  const token = await getMusixmatchToken();
  if (!token) {
    return lyricsResult(null, true);
  }

  const duration = Math.max(0, Math.floor(query.duration));
  const params = new URLSearchParams({
    format: "json",
    namespace: "lyrics_richsynched",
    subtitle_format: "mxm",
    app_id: "mac-ios-v2.0",
    q_album: cleanText(query.album),
    q_artist: cleanText(query.artist),
    q_artists: cleanText(query.artist),
    q_track: cleanText(query.title),
    q_duration: String(duration),
    f_subtitle_length: String(duration),
    usertoken: token,
    part: "track_structure,track_performer_tagging"
  });

  debugLog("lyrics", "musixmatch macro request");
  const result = await fetchJson<MusixmatchMessage<MusixmatchMacroBody>>(
    `${musixmatchBaseUrl}/macro.subtitles.get?${params.toString()}`,
    musixmatchHeaders,
    "musixmatch macro"
  );
  if (!result.payload) {
    return lyricsResult(null, result.transientFailure);
  }

  const body = result.payload.message?.body?.macro_calls;
  const matcher = body?.["matcher.track.get"]?.message;
  const matcherStatus = matcher?.header?.status_code ?? 0;
  if (matcherStatus !== 200) {
    debugLog("lyrics", `musixmatch matcher rejected status=${matcherStatus} mode="${matcher?.header?.mode ?? ""}"`);
    if (matcherStatus === 401) {
      musixmatchToken = null;
      musixmatchTokenRetryAfter = Date.now() + 120_000;
    }
    return lyricsResult(null, matcherStatus === 401 || matcherStatus === 402 || matcherStatus === 429 || matcherStatus >= 500);
  }

  if (body?.["track.lyrics.get"]?.message?.body?.lyrics?.restricted) {
    debugLog("lyrics", "musixmatch restricted");
    return lyricsResult(null);
  }

  const track = matcher?.body?.track;
  if (track?.instrumental) {
    return lyricsResult(null);
  }
  if (!track?.has_subtitles) {
    debugLog("lyrics", "musixmatch no-subtitles");
    return lyricsResult(null);
  }

  const subtitleBody = body?.["track.subtitles.get"]?.message?.body?.subtitle_list?.[0]?.subtitle?.subtitle_body;
  const lines = parseMusixmatchSubtitleBody(subtitleBody ?? "");
  if (!lines.length) {
    debugLog("lyrics", "musixmatch subtitle empty");
    return lyricsResult(null);
  }

  debugLog("lyrics", `musixmatch hit lines=${lines.length}`);
  return lyricsResult(lines);
}

async function fetchLyrics(query: LyricsQuery): Promise<LyricsFetchResult> {
  return firstLyricsResult([fetchLrclibLyrics(query), fetchNeteaseLyrics(query), fetchMusixmatchLyrics(query)], "lyrics provider");
}

function storeLyrics(key: string, lines: TimedLyricLine[] | null): void {
  lyricsCache.delete(key);
  lyricsCache.set(key, { lines, timestamp: Date.now() });
  // Map preserves insertion order, so the first keys are the least recently stored.
  for (const oldKey of lyricsCache.keys()) {
    if (lyricsCache.size <= maxCacheEntries) {
      break;
    }
    lyricsCache.delete(oldKey);
    refreshStartedAt.delete(oldKey);
  }
}

async function resolveLyrics(query: LyricsQuery): Promise<void> {
  const key = cacheKey(query);
  const cached = lyricsCache.get(key);
  if (cached && (cached.lines || Date.now() - cached.timestamp <= missTtlMs)) {
    return;
  }

  let pending = lyricsInFlight.get(key);
  if (!pending) {
    debugLog("lyrics", cached ? `cache retry key="${key}"` : `cache miss key="${key}"`);
    pending = fetchLyrics(query).finally(() => {
      lyricsInFlight.delete(key);
    });
    lyricsInFlight.set(key, pending);
  }

  const result = await pending;
  if (!result.lines && result.transientFailure) {
    debugLog("lyrics", `lookup transient failure key="${key}"`);
    return;
  }
  const isFirstResult = !lyricsCache.has(key);
  storeLyrics(key, result.lines);
  if (logLookups && isFirstResult) {
    const label = [cleanText(query.artist), cleanText(query.title)].filter(Boolean).join(" - ");
    log("info", result.lines ? `Lyrics found for ${label}: ${result.lines.length} synced lines` : `No synced lyrics found for ${label}`);
  }
}

/** Returns lyrics already in the cache without touching the network. */
export function getCachedLyrics(query: LyricsQuery): TimedLyricLine[] {
  return lyricsCache.get(cacheKey(query))?.lines ?? [];
}

/** Starts a throttled background lookup so later updates find lyrics in the cache. */
export function refreshLyrics(query: LyricsQuery): void {
  const key = cacheKey(query);
  const now = Date.now();
  if (now - (refreshStartedAt.get(key) ?? 0) < refreshIntervalMs) {
    return;
  }
  refreshStartedAt.set(key, now);
  void resolveLyrics(query).catch((error) => {
    debugLog("lyrics", `background refresh failed key="${key}" error="${String(error)}"`);
  });
}
