import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { AudioSamplesEvent, AudioStatusEvent } from "../types/audio";

export function useAudioSamples(): {
  latestSamplesRef: MutableRefObject<number[]>;
  audioStatus: AudioStatusEvent | null;
} {
  const latestSamplesRef = useRef<number[]>([]);
  const [audioStatus, setAudioStatus] = useState<AudioStatusEvent | null>(null);

  useEffect(() => {
    const unsubscribeSamples = window.visualizerApi.onAudioSamples((event: AudioSamplesEvent) => {
      latestSamplesRef.current = event.samples;
    });
    const unsubscribeStatus = window.visualizerApi.onAudioStatus((event) => {
      setAudioStatus(event);
    });

    return () => {
      unsubscribeSamples();
      unsubscribeStatus();
    };
  }, []);

  return { latestSamplesRef, audioStatus };
}
