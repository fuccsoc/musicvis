import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { log } from "./logger";

const apiCache = new Map<string, string>();

function appCacheDir(): string {
  return path.join(app.getPath("userData"), "cache");
}

function cachePathFor(query: string): string {
  const key = crypto.createHash("sha1").update(query).digest("hex");
  return path.join(appCacheDir(), "artwork", `api-${key}.jpg`);
}

export async function resolveArtworkFromAppleMusicApi(query: {
  artist: string;
  title: string;
  album: string;
}): Promise<string | null> {
  const token = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  if (!token) {
    return null;
  }

  const cacheKey = `${query.artist}::${query.title}::${query.album}`;
  const existing = apiCache.get(cacheKey);
  if (existing && fs.existsSync(existing)) {
    return existing;
  }

  const term = encodeURIComponent(`${query.artist} ${query.title} ${query.album}`.trim());
  const response = await fetch(
    `https://api.music.apple.com/v1/catalog/us/search?types=songs&limit=1&term=${term}`,
    {
      headers: { Authorization: ["Bearer", token].join(" ") }
    }
  ).catch(() => null);

  if (!response?.ok) {
    log("warn", "Apple Music API request failed");
    return null;
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
    };
  };

  const urlTemplate = payload.results?.songs?.data?.[0]?.attributes?.artwork?.url;
  if (!urlTemplate) {
    return null;
  }

  const url = urlTemplate.replace("{w}", "1000").replace("{h}", "1000");
  const image = await fetch(url).catch(() => null);
  if (!image?.ok) {
    return null;
  }

  const outPath = cachePathFor(cacheKey);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const arrayBuffer = await image.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
  apiCache.set(cacheKey, outPath);
  return outPath;
}
