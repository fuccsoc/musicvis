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
