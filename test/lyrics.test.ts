import { describe, expect, it } from "vitest";
import { lyricLineAt, parseMusixmatchSubtitleBody, parseSyncedLyrics } from "../src/main/lyrics";

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
