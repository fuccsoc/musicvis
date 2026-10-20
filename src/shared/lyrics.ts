import type { TimedLyricLine } from "./types";

// Show a line slightly before its timestamp so it lands with the vocal.
const lyricLeadSeconds = 0.16;

export function lyricLineAt(lines: TimedLyricLine[] | null | undefined, position: number): string {
  if (!lines?.length || position < 0) {
    return "";
  }

  let low = 0;
  let high = lines.length - 1;
  let activeIndex = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].time <= position + lyricLeadSeconds) {
      activeIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex >= 0 ? lines[activeIndex].text : "";
}
