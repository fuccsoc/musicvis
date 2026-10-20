import { useEffect, useState } from "react";
import type { TrackInfo } from "../../shared/types";

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
