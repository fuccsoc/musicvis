import { describe, expect, it } from "vitest";
import { lyricLineAt, parseSyncedLyrics } from "../src/main/lyrics";

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
});
