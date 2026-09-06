import { rms } from './audio-level';

export interface EncodedPcm16Wav {
  bytes: Uint8Array;
  durationMs: number;
  sampleRate: 16_000;
}

export interface NormalizedVoiceSamples {
  gain: number;
  inputRms: number;
  samples: Float32Array;
}

export function normalizeVoiceSamples(
  samples: Float32Array,
  targetRms = 0.08,
  maximumGain = 8,
): NormalizedVoiceSamples {
  const inputRms = rms(samples);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (samples.length === 0 || inputRms < 0.000_01 || peak === 0) {
    return { gain: 1, inputRms, samples: samples.slice() };
  }
  const gain = Math.max(
    1,
    Math.min(maximumGain, targetRms / inputRms, 0.95 / peak),
  );
  if (gain === 1) return { gain, inputRms, samples: samples.slice() };
  return {
    gain,
    inputRms,
    samples: Float32Array.from(samples, (sample) => sample * gain),
  };
}

export function encodePcm16Wav(
  samples: Float32Array,
  inputSampleRate: number,
  maximumInputMs = 15_000,
): EncodedPcm16Wav {
  if (samples.length === 0) throw new Error('Cannot encode empty voice audio.');
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error('Voice input sample rate must be positive.');
  }
  const inputDurationMs = (samples.length / inputSampleRate) * 1_000;
  if (inputDurationMs > maximumInputMs + 1) {
    throw new Error('Voice segment exceeds the encoding duration limit.');
  }

  const outputSampleRate = 16_000 as const;
  const outputLength = Math.max(
    1,
    Math.round((samples.length * outputSampleRate) / inputSampleRate),
  );
  const bytes = new Uint8Array(44 + outputLength * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + outputLength * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, outputLength * 2, true);

  const ratio = inputSampleRate / outputSampleRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    const interpolated = left + (right - left) * fraction;
    const clamped = Math.max(-1, Math.min(1, interpolated));
    const pcm =
      clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
    view.setInt16(44 + index * 2, pcm, true);
  }

  return {
    bytes,
    durationMs: (outputLength / outputSampleRate) * 1_000,
    sampleRate: outputSampleRate,
  };
}
