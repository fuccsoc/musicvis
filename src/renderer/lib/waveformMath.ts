export function normalizeSamples(samples: number[], sensitivity: number): number[] {
  if (!samples.length) {
    return [];
  }
  const nextSensitivity = Math.max(0, sensitivity);
  return samples.map((sample) => Math.min(1, Math.abs(sample) * nextSensitivity));
}

export function calculateRmsBuckets(samples: number[], bucketCount: number): number[] {
  if (!samples.length || bucketCount <= 0) {
    return [];
  }
  const bucketSize = Math.max(1, Math.floor(samples.length / bucketCount));
  const buckets: number[] = [];
  for (let index = 0; index < bucketCount; index += 1) {
    const start = index * bucketSize;
    const chunk = samples.slice(start, Math.min(samples.length, start + bucketSize));
    if (!chunk.length) {
      buckets.push(0);
      continue;
    }
    const rms = Math.sqrt(chunk.reduce((sum, value) => sum + value * value, 0) / chunk.length);
    buckets.push(rms);
  }
  return buckets;
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

function fft(real: number[], imag: number[]): void {
  const n = real.length;
  for (let index = 1, swapIndex = 0; index < n; index += 1) {
    let bit = n >> 1;
    for (; swapIndex & bit; bit >>= 1) {
      swapIndex ^= bit;
    }
    swapIndex ^= bit;
    if (index < swapIndex) {
      [real[index], real[swapIndex]] = [real[swapIndex], real[index]];
      [imag[index], imag[swapIndex]] = [imag[swapIndex], imag[index]];
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const phaseStep = (-2 * Math.PI) / size;
    for (let offset = 0; offset < n; offset += size) {
      for (let step = 0; step < halfSize; step += 1) {
        const phase = step * phaseStep;
        const wr = Math.cos(phase);
        const wi = Math.sin(phase);
        const evenIndex = offset + step;
        const oddIndex = evenIndex + halfSize;
        const tr = wr * real[oddIndex] - wi * imag[oddIndex];
        const ti = wr * imag[oddIndex] + wi * real[oddIndex];
        real[oddIndex] = real[evenIndex] - tr;
        imag[oddIndex] = imag[evenIndex] - ti;
        real[evenIndex] += tr;
        imag[evenIndex] += ti;
      }
    }
  }
}

function frequencyBucketEdges(bucketCount: number, minBin: number, maxExclusiveBin: number): number[] {
  const availableBins = maxExclusiveBin - minBin;
  const safeBucketCount = Math.max(1, Math.min(bucketCount, availableBins));
  const edges = [minBin];

  for (let index = 1; index < safeBucketCount; index += 1) {
    const ratio = index / safeBucketCount;
    const raw = minBin * Math.pow(maxExclusiveBin / minBin, ratio);
    const minEdge = edges[index - 1] + 1;
    const maxEdge = maxExclusiveBin - (safeBucketCount - index);
    edges.push(Math.max(minEdge, Math.min(maxEdge, Math.round(raw))));
  }

  edges.push(maxExclusiveBin);
  return edges;
}

export function calculateSpectrumBuckets(samples: number[], bucketCount: number, bassLevel = 0.62): number[] {
  if (!samples.length || bucketCount <= 0) {
    return [];
  }

  const fftSize = Math.max(64, Math.min(1024, nextPowerOfTwo(samples.length)));
  const real = new Array<number>(fftSize).fill(0);
  const imag = new Array<number>(fftSize).fill(0);
  for (let index = 0; index < Math.min(samples.length, fftSize); index += 1) {
    const windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (fftSize - 1)));
    real[index] = samples[index] * windowValue;
  }

  fft(real, imag);

  const binCount = fftSize / 2;
  const magnitudes = new Array<number>(binCount);
  for (let index = 1; index < binCount; index += 1) {
    magnitudes[index] = Math.sqrt(real[index] * real[index] + imag[index] * imag[index]);
  }
  magnitudes[0] = 0;

  const output: number[] = [];
  const minBin = 1;
  const edges = frequencyBucketEdges(bucketCount, minBin, binCount);
  const effectiveBucketCount = edges.length - 1;
  for (let bucketIndex = 0; bucketIndex < effectiveBucketCount; bucketIndex += 1) {
    const startBin = edges[bucketIndex];
    const endBin = edges[bucketIndex + 1];
    let energy = 0;
    let count = 0;
    for (let bin = startBin; bin < endBin; bin += 1) {
      const magnitude = magnitudes[bin] ?? 0;
      energy += magnitude * magnitude;
      count += 1;
    }
    const rms = Math.sqrt(energy / Math.max(1, count));
    const bucketRatio = bucketIndex / Math.max(1, effectiveBucketCount - 1);
    const bassRolloff = bassLevel + (1 - bassLevel) * Math.min(1, bucketRatio / 0.38);
    const normalized = (rms / (fftSize * 0.22)) * bassRolloff;
    output.push(Math.min(1, Math.pow(normalized, 0.62)));
  }

  return output.map((value, index) => {
    const previous = output[index - 1] ?? value;
    const next = output[index + 1] ?? value;
    return previous * 0.18 + value * 0.64 + next * 0.18;
  });
}

export interface AutoScaleState {
  peak: number;
  bassPeak: number;
  bodyPeak: number;
}

export interface AutoScaleOptions {
  strength: number;
  maxGain: number;
  targetPeak?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function smoothEnvelope(previous: number, current: number, attack: number, release: number): number {
  const amount = current > previous ? attack : release;
  return previous * (1 - amount) + current * amount;
}

export function autoScaleSpectrumBuckets(
  values: number[],
  state: AutoScaleState,
  options: AutoScaleOptions
): { values: number[]; state: AutoScaleState } {
  if (!values.length) {
    return { values, state };
  }

  const strength = clamp(options.strength, 0, 1);
  if (strength === 0) {
    return { values, state };
  }

  const targetPeak = options.targetPeak ?? 0.72;
  const maxGain = Math.max(1, options.maxGain);
  const activePeak = Math.max(percentile(values, 0.92), Math.max(...values) * 0.72, 0.035);
  const bassEnd = Math.max(1, Math.floor(values.length * 0.28));
  const bodyStart = Math.min(values.length - 1, Math.floor(values.length * 0.34));
  const bassPeak = Math.max(...values.slice(0, bassEnd), 0.025);
  const bodyPeak = Math.max(...values.slice(bodyStart), 0.025);

  const nextState = {
    peak: smoothEnvelope(state.peak || activePeak, activePeak, 0.34, 0.035),
    bassPeak: smoothEnvelope(state.bassPeak || bassPeak, bassPeak, 0.3, 0.045),
    bodyPeak: smoothEnvelope(state.bodyPeak || bodyPeak, bodyPeak, 0.3, 0.045)
  };

  const rawGain = clamp(targetPeak / Math.max(0.035, nextState.peak), 0.78, maxGain);
  const gain = 1 + (rawGain - 1) * strength;
  const rawBassGain = clamp(nextState.bodyPeak / Math.max(0.025, nextState.bassPeak), 0.72, 1.28);
  const bassGain = 1 + (rawBassGain - 1) * strength * 0.72;

  return {
    state: nextState,
    values: values.map((value, index) => {
      const lowRatio = 1 - clamp(index / Math.max(1, values.length * 0.36), 0, 1);
      const bandGain = 1 + (bassGain - 1) * lowRatio;
      return clamp(value * gain * bandGain, 0, 0.98);
    })
  };
}

export function smoothWaveform(previous: number[], current: number[], smoothing: number): number[] {
  const clamped = Math.max(0, Math.min(0.95, smoothing));
  const length = Math.max(previous.length, current.length);
  const next = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    const prevValue = previous[index] ?? 0;
    const nextValue = current[index] ?? 0;
    next[index] = prevValue * clamped + nextValue * (1 - clamped);
  }
  return next;
}

export function mirrorWaveform(values: number[]): number[] {
  if (!values.length) {
    return [];
  }
  const mirrored = [...values];
  for (let index = values.length - 2; index >= 0; index -= 1) {
    mirrored.push(values[index]);
  }
  return mirrored;
}
