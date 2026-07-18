import { describe, expect, it } from "vitest";
import {
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

  it("smooths waveforms", () => {
    expect(smoothWaveform([1, 0], [0, 1], 0.5)).toEqual([0.5, 0.5]);
  });

  it("mirrors waveform", () => {
    expect(mirrorWaveform([1, 2, 3])).toEqual([1, 2, 3, 2, 1]);
  });
});
