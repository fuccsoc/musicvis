import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { debugLog, log } from "./logger";

const maxCachedArtworkFiles = 200;
const downloadRetryMs = 30_000;
const artworkPaths = new Map<string, string>();
const downloadStartedAt = new Map<string, number>();

export interface ArtworkSource {
  id: string;
  artworkDataBase64?: string;
  artworkMimeType?: string;
  artworkUrl?: string;
}

export function artworkCacheDir(): string {
  return path.resolve(app.getPath("userData"), "cache", "artwork");
}

function artworkExtension(mimeType: string | undefined): string {
  if (mimeType?.includes("png")) {
    return "png";
  }
  if (mimeType?.includes("webp")) {
    return "webp";
  }
  return "jpg";
}

function writeArtwork(trackId: string, bytes: Buffer, mimeType: string | undefined): string {
  const key = crypto.createHash("sha1").update(trackId).digest("hex");
  const target = path.join(artworkCacheDir(), `mediaremote-${key}.${artworkExtension(mimeType)}`);
  fs.mkdirSync(artworkCacheDir(), { recursive: true });
  fs.writeFileSync(target, bytes);
  artworkPaths.set(trackId, target);
  return target;
}

function downloadArtwork(source: ArtworkSource & { artworkUrl: string }): void {
  const now = Date.now();
  if (now - (downloadStartedAt.get(source.id) ?? 0) < downloadRetryMs) {
    return;
  }
  downloadStartedAt.set(source.id, now);
  // Fetch in the background so artwork never delays playback state updates.
  void (async () => {
    try {
      const url = new URL(source.artworkUrl);
      if (url.protocol !== "https:" || url.hostname !== "i.scdn.co") {
        return;
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        return;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      writeArtwork(source.id, bytes, response.headers.get("content-type") ?? undefined);
      downloadStartedAt.delete(source.id);
    } catch (error) {
      debugLog("artwork", `download failed: ${String(error)}`);
    }
  })();
}

/**
 * Returns a cached artwork path for the track. Embedded artwork is written
 * synchronously; remote artwork is downloaded in the background and shows up
 * on a later call.
 */
export function resolveArtworkPath(source: ArtworkSource): string | null {
  const cached = artworkPaths.get(source.id);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  if (source.artworkDataBase64) {
    try {
      const target = writeArtwork(source.id, Buffer.from(source.artworkDataBase64, "base64"), source.artworkMimeType);
      debugLog("artwork", `saved path="${target}" mime="${source.artworkMimeType ?? ""}"`);
      return target;
    } catch (error) {
      log("warn", `Artwork save failed: ${String(error)}`);
      return null;
    }
  }
  if (source.artworkUrl) {
    downloadArtwork({ ...source, artworkUrl: source.artworkUrl });
  }
  return null;
}

/** Keeps only the most recently written artwork files on disk. */
export function pruneArtworkCache(): void {
  try {
    const dir = artworkCacheDir();
    const files = fs
      .readdirSync(dir)
      .map((name) => {
        const filePath = path.join(dir, name);
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const { filePath } of files.slice(maxCachedArtworkFiles)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("warn", `Artwork cache prune failed: ${String(error)}`);
    }
  }
}
