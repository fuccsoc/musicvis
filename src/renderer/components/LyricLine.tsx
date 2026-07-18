import { useEffect, useMemo, useState } from "react";
import type { TrackInfo } from "../types/track";

interface Props {
  track: TrackInfo | null;
}

export function LyricLine({ track }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!track || track.playbackState !== "playing" || !track.lyricLines.length) {
      return;
    }
    const intervalId = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(intervalId);
  }, [track]);

  const line = useMemo(() => {
    if (!track?.lyricLines.length) {
      return track?.lyricLine ?? "";
    }
    const position =
      track.playbackState === "playing"
        ? track.position + Math.max(0, now - track.positionUpdatedAt) / 1000
        : track.position;
    let active = "";
    for (const lyricLine of track.lyricLines) {
      if (lyricLine.time <= position + 0.16) {
        active = lyricLine.text;
      } else {
        break;
      }
    }
    return active;
  }, [now, track]);

  return (
    <p className="lyric-line">
      <span key={line || "empty"} className="lyric-line-text">
        {line}
      </span>
    </p>
  );
}
