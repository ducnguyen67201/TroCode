export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let squareSum = 0;
  for (const sample of samples) squareSum += sample * sample;
  return Math.sqrt(squareSum / samples.length);
}
