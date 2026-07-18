import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { log } from "./logger";

const apiCache = new Map<string, string>();

function appCacheDir(): string {
  return path.join(app.getPath("userData"), "cache");
}

function cachePathFor(query: string, extension = "jpg"): string {
  const key = crypto.createHash("sha1").update(query).digest("hex");
  return path.join(appCacheDir(), "artwork", `api-${key}.${extension}`);
}

interface ArtworkQuery {
  artist: string;
  title: string;
  album: string;
}

function cleanText(value: string): string {
  return value
    .replace(/\s*\([^)]*(official|audio|video|lyrics|remaster|remastered|feat\.?|ft\.?)[^)]*\)/gi, " ")
    .replace(/\s*\[[^\]]*(official|audio|video|lyrics|remaster|remastered|feat\.?|ft\.?)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryCandidates(query: ArtworkQuery): string[] {
  const artist = cleanText(query.artist);
  const title = cleanText(query.title);
  const album = cleanText(query.album);
  return Array.from(
    new Set([
      [artist, title, album].filter(Boolean).join(" "),
      [artist, title].filter(Boolean).join(" "),
      [title, album].filter(Boolean).join(" "),
      title
    ].filter(Boolean))
  );
}

async function downloadArtwork(url: string, cacheKey: string): Promise<string | null> {
  const image = await fetch(url).catch(() => null);
  if (!image?.ok) {
    return null;
  }

  const contentType = image.headers.get("content-type") ?? "";
  const extension = contentType.includes("png") ? "png" : "jpg";
  const outPath = cachePathFor(cacheKey, extension);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const arrayBuffer = await image.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  apiCache.set(cacheKey, outPath);
  return outPath;
}

async function resolveArtworkFromDeveloperApi(query: ArtworkQuery, cacheKey: string): Promise<string | null> {
  const token = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  if (!token) {
    return null;
  }

  for (const candidate of queryCandidates(query)) {
    const term = encodeURIComponent(candidate);
    const response = await fetch(
      `https://api.music.apple.com/v1/catalog/us/search?types=songs,albums&limit=3&term=${term}`,
      {
        headers: { Authorization: ["Bearer", token].join(" ") }
      }
    ).catch(() => null);

    if (!response?.ok) {
      log("warn", "Apple Music API request failed");
      continue;
    }

    const payload = (await response.json()) as {
      results?: {
        songs?: {
          data?: Array<{
            attributes?: {
              artwork?: {
                url?: string;
              };
            };
          }>;
        };
        albums?: {
          data?: Array<{
            attributes?: {
              artwork?: {
                url?: string;
              };
            };
          }>;
        };
      };
    };

    const urlTemplate =
      payload.results?.songs?.data?.[0]?.attributes?.artwork?.url ??
      payload.results?.albums?.data?.[0]?.attributes?.artwork?.url;
    if (!urlTemplate) {
      continue;
    }

    const url = urlTemplate.replace("{w}", "1200").replace("{h}", "1200");
    const downloaded = await downloadArtwork(url, cacheKey);
    if (downloaded) {
      return downloaded;
    }
  }

  return null;
}

async function resolveArtworkFromItunesSearch(query: ArtworkQuery, cacheKey: string): Promise<string | null> {
  for (const candidate of queryCandidates(query)) {
    const term = encodeURIComponent(candidate);
    const response = await fetch(
      `https://itunes.apple.com/search?media=music&entity=song,album&limit=5&term=${term}`
    ).catch(() => null);

    if (!response?.ok) {
      log("warn", "iTunes artwork request failed");
      continue;
    }

    const payload = (await response.json()) as {
      results?: Array<{
        artworkUrl100?: string;
        artworkUrl600?: string;
      }>;
    };
    const artworkUrl = payload.results?.find((item) => item.artworkUrl100 || item.artworkUrl600);
    const sourceUrl = artworkUrl?.artworkUrl600 ?? artworkUrl?.artworkUrl100;
    if (!sourceUrl) {
      continue;
    }

    const url = sourceUrl.replace(/\/\d+x\d+bb\./, "/1200x1200bb.");
    const downloaded = await downloadArtwork(url, cacheKey);
    if (downloaded) {
      return downloaded;
    }
  }

  return null;
}

export async function resolveArtworkFromAppleMusicApi(query: ArtworkQuery): Promise<string | null> {
  const cacheKey = `${query.artist}::${query.title}::${query.album}`;
  const existing = apiCache.get(cacheKey);
  if (existing && fs.existsSync(existing)) {
    return existing;
  }

  return (
    (await resolveArtworkFromDeveloperApi(query, cacheKey)) ??
    (await resolveArtworkFromItunesSearch(query, cacheKey))
  );
}
