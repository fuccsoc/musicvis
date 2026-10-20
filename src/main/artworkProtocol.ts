import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { artworkCacheDir } from "./artwork";

export const ARTWORK_PROTOCOL = "musicvis-artwork";

export function registerArtworkProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARTWORK_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ]);
}

function isInsideArtworkCache(filePath: string): boolean {
  const relative = path.relative(artworkCacheDir(), path.resolve(filePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function registerArtworkProtocolHandler(): void {
  protocol.handle(ARTWORK_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");
    if (!filePath || !isInsideArtworkCache(filePath) || !fs.existsSync(filePath)) {
      return new Response(null, { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
