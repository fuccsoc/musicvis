import { useEffect, useRef } from "react";
import { calculateRmsBuckets, normalizeSamples, smoothWaveform } from "../lib/waveformMath";
import type { AppSettings } from "../types/settings";

interface Props {
  getSamples: () => number[];
  playing: boolean;
  settings: AppSettings;
}

export function WaveformCanvas({ getSamples, playing, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let rafId = 0;

    const render = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const sourceSamples = playing ? getSamples() : [];
      const normalized = normalizeSamples(sourceSamples, settings.sensitivity);
      const buckets = calculateRmsBuckets(normalized, Math.max(32, Math.floor(width / 6)));
      const idle = new Array(buckets.length || Math.max(32, Math.floor(width / 6))).fill(settings.idleAmplitude);
      const target = buckets.length ? buckets : idle;
      smoothedRef.current = smoothWaveform(smoothedRef.current, target, settings.smoothing);

      context.strokeStyle = "#ffffff";
      context.lineWidth = settings.lineWidth;
      context.lineJoin = "round";
      context.lineCap = "round";

      const centerY = height / 2;
      const segmentWidth = width / Math.max(1, smoothedRef.current.length - 1);
      context.beginPath();
      smoothedRef.current.forEach((value, index) => {
        const x = index * segmentWidth;
        const y = centerY - value * settings.waveformHeight;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      for (let index = smoothedRef.current.length - 1; index >= 0; index -= 1) {
        const x = index * segmentWidth;
        const y = centerY + smoothedRef.current[index] * settings.waveformHeight;
        context.lineTo(x, y);
      }
      context.stroke();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [getSamples, playing, settings]);

  return <canvas ref={canvasRef} className="waveform-canvas" />;
}
