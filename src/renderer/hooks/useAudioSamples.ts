import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { AudioStatusEvent } from "../../shared/types";

const maxBufferedSamples = 4096;

export function useAudioSamples(): {
  latestSamplesRef: MutableRefObject<number[]>;
  audioStatus: AudioStatusEvent | null;
} {
  const latestSamplesRef = useRef<number[]>([]);
  const [audioStatus, setAudioStatus] = useState<AudioStatusEvent | null>(null);

  useEffect(() => {
    const unsubscribeSamples = window.visualizerApi.onAudioSamples((event) => {
      const buffer = latestSamplesRef.current;
      buffer.push(...event.samples);
      if (buffer.length > maxBufferedSamples) {
        buffer.splice(0, buffer.length - maxBufferedSamples);
      }
    });
    const unsubscribeStatus = window.visualizerApi.onAudioStatus(setAudioStatus);

    return () => {
      unsubscribeSamples();
      unsubscribeStatus();
    };
  }, []);

  return { latestSamplesRef, audioStatus };
}
