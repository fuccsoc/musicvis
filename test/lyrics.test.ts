import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCachedLyrics,
  lyricLineAt,
  parseMusixmatchSubtitleBody,
  parseSyncedLyrics,
  refreshLyrics
} from "../src/main/lyrics";

describe("lyrics", () => {
  it("parses synced lyric timestamps", () => {
    const lines = parseSyncedLyrics("[00:01.20]First line\n[00:04.50][00:05.00]Second line");

    expect(lines).toEqual([
      { time: 1.2, text: "First line" },
      { time: 4.5, text: "Second line" },
      { time: 5, text: "Second line" }
    ]);
  });

  it("returns the active lyric line for a playback position", () => {
    const lines = parseSyncedLyrics("[00:01.00]First\n[00:04.00]Second");

    expect(lyricLineAt(lines, 0)).toBe("");
    expect(lyricLineAt(lines, 1.1)).toBe("First");
    expect(lyricLineAt(lines, 4.2)).toBe("Second");
  });

  it("parses Musixmatch JSON subtitle bodies", () => {
    const lines = parseMusixmatchSubtitleBody(
      JSON.stringify([
        { text: "First", time: { total: 1.3 } },
        { text: "Second", time: { total: 2.8 } }
      ])
    );

    expect(lines).toEqual([
      { time: 1.3, text: "First" },
      { time: 2.8, text: "Second" }
    ]);
  });

  it("parses Musixmatch LRC subtitle bodies", () => {
    expect(parseMusixmatchSubtitleBody("[00:03.00]Line")).toEqual([{ time: 3, text: "Line" }]);
  });
});

describe("lyrics cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills the cache from a background refresh", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://lrclib.net/api/get")) {
        return new Response(JSON.stringify({ syncedLyrics: "[00:01.00]Hello\n[00:03.00]World" }));
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const query = { artist: "Cache Artist", title: "Cache Song", album: "", duration: 120 };

    expect(getCachedLyrics(query)).toEqual([]);
    refreshLyrics(query);
    await vi.waitFor(() => expect(getCachedLyrics(query)).toHaveLength(2));
    expect(lyricLineAt(getCachedLyrics(query), 3.2)).toBe("World");
  });

  it("does not cache transient provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const query = { artist: "Flaky Artist", title: "Flaky Song", album: "", duration: 100 };

    refreshLyrics(query);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCachedLyrics(query)).toEqual([]);
  });
});
