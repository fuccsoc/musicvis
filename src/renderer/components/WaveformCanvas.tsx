import { useEffect, useRef } from "react";
import { autoScaleSpectrumBuckets, calculateSpectrumBuckets, smoothWaveform } from "../lib/waveformMath";
import type { AppSettings } from "../types/settings";

interface Props {
  getSamples: () => number[];
  settings: AppSettings;
}

export function WaveformCanvas({ getSamples, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedRef = useRef<number[]>([]);
  const autoScaleRef = useRef({ peak: 0, bassPeak: 0, bodyPeak: 0 });

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
      const nextCanvasWidth = Math.floor(width * dpr);
      const nextCanvasHeight = Math.floor(height * dpr);
      if (canvas.width !== nextCanvasWidth || canvas.height !== nextCanvasHeight) {
        canvas.width = nextCanvasWidth;
        canvas.height = nextCanvasHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const sourceSamples = getSamples();
      const normalized = sourceSamples.map((sample) =>
        Math.max(-1, Math.min(1, sample * settings.sensitivity))
      );
      const bucketCount = Math.max(12, Math.min(256, Math.floor(settings.spectrumBucketCount)));
      const buckets = calculateSpectrumBuckets(normalized, bucketCount, settings.bassLevel);
      const scaled = autoScaleSpectrumBuckets(buckets, autoScaleRef.current, {
        strength: settings.autoScaleStrength,
        maxGain: settings.autoScaleMaxGain
      });
      autoScaleRef.current = scaled.state;
      const idle = new Array(buckets.length || bucketCount).fill(settings.idleAmplitude);
      const target = scaled.values.length ? scaled.values : idle;
      smoothedRef.current = smoothWaveform(smoothedRef.current, target, settings.smoothing);

      const strokeGradient = context.createLinearGradient(0, 0, width, 0);
      strokeGradient.addColorStop(0, settings.waveformColorStart);
      strokeGradient.addColorStop(1, settings.waveformColorEnd);
      const fillGradient = context.createLinearGradient(0, 0, width, height);
      fillGradient.addColorStop(0, settings.waveformColorStart);
      fillGradient.addColorStop(0.55, settings.waveformColorEnd);
      fillGradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.strokeStyle = strokeGradient;
      context.lineWidth = settings.lineWidth;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.shadowColor = settings.waveformColorEnd;
      context.shadowBlur = settings.waveformGlow;

      const centerY = height / 2;
      const segmentWidth = width / Math.max(1, smoothedRef.current.length - 1);

      if (settings.waveformStyle === "bars") {
        const barWidth = Math.max(1, segmentWidth - settings.barGap);
        smoothedRef.current.forEach((value, index) => {
          const amplitude = Math.max(2, value * settings.waveformHeight * 2);
          const x = index * segmentWidth;
          const y = centerY - amplitude / 2;
          context.globalAlpha = settings.waveformFillOpacity;
          context.fillStyle = fillGradient;
          context.fillRect(x, y, barWidth, amplitude);
          context.globalAlpha = 1;
          context.strokeRect(x, y, barWidth, amplitude);
        });
      } else {
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
        context.closePath();
        context.globalAlpha = settings.waveformFillOpacity;
        context.fillStyle = fillGradient;
        context.fill();
        context.globalAlpha = 1;
        context.stroke();
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [getSamples, settings]);

  return <canvas ref={canvasRef} className="waveform-canvas" />;
}
