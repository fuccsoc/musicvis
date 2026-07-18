import { useEffect, useState } from "react";
import type { TrackInfo } from "../types/track";

export function useCurrentTrack(): TrackInfo | null {
  const [track, setTrack] = useState<TrackInfo | null>(null);

  useEffect(() => {
    void window.visualizerApi.getCurrentTrack().then(setTrack);
    return window.visualizerApi.onTrackChanged((nextTrack) => {
      setTrack(nextTrack);
    });
  }, []);

  return track;
}
