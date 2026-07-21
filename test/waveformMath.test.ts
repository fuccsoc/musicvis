import { describe, expect, it } from "vitest";
import {
  autoScaleSpectrumBuckets,
  calculateSpectrumBuckets,
  calculateRmsBuckets,
  mirrorWaveform,
  normalizeSamples,
  smoothWaveform
} from "../src/renderer/lib/waveformMath";

describe("waveform math", () => {
  it("normalizes samples", () => {
    expect(normalizeSamples([0.5, -2], 1)).toEqual([0.5, 1]);
  });

  it("calculates rms buckets", () => {
    expect(calculateRmsBuckets([1, 1, 0, 0], 2)).toEqual([1, 0]);
  });

  it("orders spectrum buckets from low to high frequencies", () => {
    const lowTone = Array.from({ length: 512 }, (_value, index) => Math.sin((2 * Math.PI * index * 4) / 512));
    const highTone = Array.from({ length: 512 }, (_value, index) => Math.sin((2 * Math.PI * index * 96) / 512));
    const lowSpectrum = calculateSpectrumBuckets(lowTone, 24);
    const highSpectrum = calculateSpectrumBuckets(highTone, 24);
    const lowPeak = lowSpectrum.indexOf(Math.max(...lowSpectrum));
    const highPeak = highSpectrum.indexOf(Math.max(...highSpectrum));

    expect(lowPeak).toBeLessThan(highPeak);
  });

  it("keeps spectrum buckets below hard clipping for a steady tone", () => {
    const tone = Array.from({ length: 512 }, (_value, index) => Math.sin((2 * Math.PI * index * 8) / 512));
    const spectrum = calculateSpectrumBuckets(tone, 48);

    expect(spectrum.filter((value) => value >= 1)).toHaveLength(0);
  });

  it("keeps dense spectrum buckets populated when fft bins are available", () => {
    const tone = Array.from({ length: 1024 }, (_value, index) => Math.sin((2 * Math.PI * index * 12) / 1024));
    const spectrum = calculateSpectrumBuckets(tone, 384);

    expect(spectrum).toHaveLength(384);
  });

  it("uses longer sample windows for low-frequency detail", () => {
    const tone = Array.from({ length: 4096 }, (_value, index) => Math.sin((2 * Math.PI * index * 8) / 4096));
    const spectrum = calculateSpectrumBuckets(tone, 384);

    expect(spectrum).toHaveLength(384);
    expect(Math.max(...spectrum.slice(0, 32))).toBeGreaterThan(0);
  });

  it("can attenuate low frequency buckets", () => {
    const tone = Array.from({ length: 512 }, (_value, index) => Math.sin((2 * Math.PI * index * 4) / 512));
    const fullBass = calculateSpectrumBuckets(tone, 48, 1);
    const reducedBass = calculateSpectrumBuckets(tone, 48, 0.45);

    expect(Math.max(...reducedBass.slice(0, 12))).toBeLessThan(Math.max(...fullBass.slice(0, 12)));
  });

  it("auto-scales quiet spectrum buckets without hard clipping", () => {
    const values = new Array(24).fill(0.08);
    const result = autoScaleSpectrumBuckets(values, { peak: 0, bassPeak: 0, bodyPeak: 0 }, {
      strength: 1,
      maxGain: 1.5
    });

    expect(Math.max(...result.values)).toBeGreaterThan(0.08);
    expect(Math.max(...result.values)).toBeLessThanOrEqual(0.12);
  });

  it("keeps bass matching bounded", () => {
    const values = [0.03, 0.04, 0.03, ...new Array(21).fill(0.25)];
    const result = autoScaleSpectrumBuckets(values, { peak: 0, bassPeak: 0, bodyPeak: 0 }, {
      strength: 1,
      maxGain: 1
    });

    expect(Math.max(...result.values.slice(0, 3))).toBeLessThan(0.06);
  });

  it("smooths waveforms", () => {
    expect(smoothWaveform([1, 0], [0, 1], 0.5)).toEqual([0.5, 0.5]);
  });

  it("mirrors waveform", () => {
    expect(mirrorWaveform([1, 2, 3])).toEqual([1, 2, 3, 2, 1]);
  });
});
