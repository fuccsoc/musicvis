import { useEffect, useState } from "react";
import { lyricLineAt } from "../../shared/lyrics";
import type { TrackInfo } from "../../shared/types";

interface Props {
  track: TrackInfo | null;
}

export function LyricLine({ track }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = Boolean(track && track.playbackState === "playing" && track.lyricLines.length);

  useEffect(() => {
    if (!ticking) {
      return;
    }
    const intervalId = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(intervalId);
  }, [ticking]);

  let line = "";
  if (track) {
    const elapsed = track.playbackState === "playing" ? Math.max(0, now - track.positionUpdatedAt) / 1000 : 0;
    line = lyricLineAt(track.lyricLines, track.position + elapsed);
  }

  return (
    <p className="lyric-line">
      <span key={line || "empty"} className="lyric-line-text">
        {line}
      </span>
    </p>
  );
}
