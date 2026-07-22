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
const neteaseBaseUrl = "https://music.xianqiao.wang/neteaseapiv2";
const neteaseHeaders = {
  "User-Agent": "Mozilla/5.0 musicvis/0.1.0"
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
  const searchResponse = await fetch(`${neteaseBaseUrl}/search?${searchParams.toString()}`, {
    headers: neteaseHeaders
  }).catch(() => null);
  if (!searchResponse?.ok) {
    debugLog("lyrics", `netease search failed http=${searchResponse?.status ?? "network"}`);
    return lyricsResult(null, isTransientLyricsFailure(searchResponse?.status));
  }

  const searchPayload = await readLyricsJson<NeteaseSearchResponse>(searchResponse, "netease search");
  const songs = searchPayload?.result?.songs ?? [];
  debugLog("lyrics", `netease search results=${songs.length}`);
  const song = chooseNeteaseSong(query, songs);
  if (!song?.id) {
    debugLog("lyrics", "netease search empty");
    return lyricsResult(null);
  }

  debugLog("lyrics", `netease lyric request id=${song.id}`);
  const lyricResponse = await fetch(`${neteaseBaseUrl}/lyric?id=${song.id}`, {
    headers: neteaseHeaders
  }).catch(() => null);
  if (!lyricResponse?.ok) {
    debugLog("lyrics", `netease lyric failed http=${lyricResponse?.status ?? "network"}`);
    return lyricsResult(null, isTransientLyricsFailure(lyricResponse?.status));
  }

  const lyricPayload = await readLyricsJson<NeteaseLyricsResponse>(lyricResponse, "netease lyric");
  if (!lyricPayload) {
    return lyricsResult(null, true);
  }

  const lines = filterLyricCredits(parseSyncedLyrics(lyricPayload.lrc?.lyric ?? ""));
  if (!lines.length) {
    debugLog("lyrics", "netease lyric empty");
    return lyricsResult(null);
  }

  debugLog("lyrics", `netease hit lines=${lines.length}`);
  return lyricsResult(lines);
}

async function getMusixmatchToken(): Promise<string | null> {
  if (musixmatchToken) {
    return musixmatchToken;
  }
  if (Date.now() < musixmatchTokenRetryAfter) {
    debugLog("lyrics", "musixmatch token skip reason=backoff");
    return null;
  }
  if (!musixmatchTokenPromise) {
    debugLog("lyrics", "musixmatch token request");
    musixmatchTokenPromise = fetch(`${musixmatchBaseUrl}/token.get?app_id=mac-ios-v2.0`, {
      headers: musixmatchHeaders
    })
      .then(async (response) => {
        if (!response.ok) {
          debugLog("lyrics", `musixmatch token failed http=${response.status}`);
          musixmatchTokenRetryAfter = Date.now() + (isTransientLyricsFailure(response.status) ? 30_000 : 120_000);
          return null;
        }
        const payload = await readLyricsJson<MusixmatchMessage<MusixmatchTokenBody>>(response, "musixmatch token");
        const status = payload?.message?.header?.status_code ?? 0;
        const token = payload?.message?.body?.user_token ?? null;
        if (status !== 200 || !token) {
          debugLog("lyrics", `musixmatch token rejected status=${status}`);
          musixmatchTokenRetryAfter = Date.now() + (isTransientLyricsFailure(status) || status === 401 ? 120_000 : 300_000);
          return null;
        }
        debugLog("lyrics", "musixmatch token ok");
        musixmatchToken = token;
        musixmatchTokenRetryAfter = 0;
        return token;
      })
      .catch((error) => {
        debugLog("lyrics", `musixmatch token failed error="${String(error)}"`);
        musixmatchTokenRetryAfter = Date.now() + 30_000;
        return null;
      })
      .finally(() => {
        musixmatchTokenPromise = null;
      });
  }

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
  const response = await fetch(`${musixmatchBaseUrl}/macro.subtitles.get?${params.toString()}`, {
    headers: musixmatchHeaders
  }).catch(() => null);
  if (!response?.ok) {
    debugLog("lyrics", `musixmatch macro failed http=${response?.status ?? "network"}`);
    return lyricsResult(null, isTransientLyricsFailure(response?.status));
  }

  const payload = await readLyricsJson<MusixmatchMessage<MusixmatchMacroBody>>(response, "musixmatch macro");
  if (!payload) {
    return lyricsResult(null, true);
  }

  const body = payload.message?.body?.macro_calls;
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
