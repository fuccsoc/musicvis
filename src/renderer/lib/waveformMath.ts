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

export function calculateSpectrumBuckets(samples: number[], bucketCount: number): number[] {
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
  const maxBin = binCount - 1;
  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const startRatio = bucketIndex / bucketCount;
    const endRatio = (bucketIndex + 1) / bucketCount;
    const startBin = Math.max(minBin, Math.floor(minBin * Math.pow(maxBin / minBin, startRatio)));
    const endBin = Math.max(startBin + 1, Math.ceil(minBin * Math.pow(maxBin / minBin, endRatio)));
    let peak = 0;
    for (let bin = startBin; bin < Math.min(endBin, binCount); bin += 1) {
      peak = Math.max(peak, magnitudes[bin] ?? 0);
    }
    const lowFrequencyWeight = 1 + (1 - bucketIndex / Math.max(1, bucketCount - 1)) * 0.55;
    output.push(Math.min(1, Math.log1p(peak * lowFrequencyWeight) / 3));
  }

  return output;
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
