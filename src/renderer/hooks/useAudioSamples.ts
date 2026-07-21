import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { AudioSamplesEvent, AudioStatusEvent } from "../types/audio";

const maxBufferedSamples = 4096;

export function useAudioSamples(): {
  latestSamplesRef: MutableRefObject<number[]>;
  audioStatus: AudioStatusEvent | null;
} {
  const latestSamplesRef = useRef<number[]>([]);
  const [audioStatus, setAudioStatus] = useState<AudioStatusEvent | null>(null);

  useEffect(() => {
    const unsubscribeSamples = window.visualizerApi.onAudioSamples((event: AudioSamplesEvent) => {
      latestSamplesRef.current = [...latestSamplesRef.current, ...event.samples].slice(-maxBufferedSamples);
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
