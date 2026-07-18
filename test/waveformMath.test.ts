import { describe, expect, it } from "vitest";
import {
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

  it("smooths waveforms", () => {
    expect(smoothWaveform([1, 0], [0, 1], 0.5)).toEqual([0.5, 0.5]);
  });

  it("mirrors waveform", () => {
    expect(mirrorWaveform([1, 2, 3])).toEqual([1, 2, 3, 2, 1]);
  });
});
