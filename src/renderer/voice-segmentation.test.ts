import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_VOICE_SEGMENTATION_POLICY,
  encodePcm16Wav,
  joinTranscriptSegments,
  OrderedTranscriptAssembler,
  SegmentUploadQueue,
  VoiceSegmenter,
  type VoiceSegmentationPolicy,
} from './voice-segmentation';

function pcm(ms: number, sampleRate: number, amplitude: number): Float32Array {
  const samples = new Float32Array(Math.round((ms / 1_000) * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? amplitude : -amplitude;
  }
  return samples;
}

function pushMs(
  segmenter: VoiceSegmenter,
  ms: number,
  amplitude: number,
  sampleRate = 16_000,
) {
  const segments = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 20) {
    const update = segmenter.push({
      sampleRate,
      samples: pcm(Math.min(20, ms - elapsed), sampleRate, amplitude),
    });
    segments.push(...update.segments);
  }
  return segments;
}

describe('VoiceSegmenter', () => {
  it('does not emit silence or speech shorter than the minimum', () => {
    const silence = new VoiceSegmenter();
    pushMs(silence, 1_000, 0);
    expect(silence.finish().segments).toEqual([]);

    const shortSpeech = new VoiceSegmenter();
    pushMs(shortSpeech, 280, 0.1);
    expect(shortSpeech.finish().segments).toEqual([]);
  });

  it('retains bounded pre-roll and only 200 ms of trailing silence', () => {
    const segmenter = new VoiceSegmenter();
    pushMs(segmenter, 500, 0);
    pushMs(segmenter, 300, 0.1);
    const segments = pushMs(segmenter, 700, 0);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      boundary: 'silence',
      overlapWithPrevious: false,
      sequence: 0,
    });
    expect(segments[0]?.durationMs).toBeGreaterThanOrEqual(700);
    expect(segments[0]?.durationMs).toBeLessThanOrEqual(820);
  });

  it('adapts to background noise while retaining hysteresis', () => {
    const policy: VoiceSegmentationPolicy = {
      ...DEFAULT_VOICE_SEGMENTATION_POLICY,
      maximumUtteranceMs: 5_000,
    };
    const segmenter = new VoiceSegmenter(policy);
    pushMs(segmenter, 1_000, 0.008);
    pushMs(segmenter, 300, 0.06);
    expect(segmenter.finish().segments).toHaveLength(1);
  });

  it('hard-splits continuous speech and carries exactly 300 ms overlap', () => {
    const segmenter = new VoiceSegmenter();
    const segments = pushMs(segmenter, 24_100, 0.1);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]?.boundary).toBe('hard');
    expect(segments[0]?.overlapWithPrevious).toBe(false);
    expect(segments[1]?.overlapWithPrevious).toBe(true);
    expect(segments[1]?.durationMs).toBeCloseTo(12_300, -1);
  });

  it('does not emit an overlap-only segment when release lands on a hard cut', () => {
    const segmenter = new VoiceSegmenter();
    const segments = pushMs(segmenter, 12_000, 0.1);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.boundary).toBe('hard');
    expect(segmenter.finish().segments).toEqual([]);
  });

  it('resets after a sub-minimum burst followed by a natural pause', () => {
    const segmenter = new VoiceSegmenter();
    pushMs(segmenter, 200, 0.1);
    expect(pushMs(segmenter, 700, 0)).toEqual([]);
    pushMs(segmenter, 300, 0.1);
    expect(segmenter.finish().segments).toHaveLength(1);
  });

  it('finalizes on release, never mutates frames, and caps the utterance', () => {
    const segmenter = new VoiceSegmenter();
    const frame = pcm(20, 16_000, 0.1);
    const original = frame.slice();
    for (let index = 0; index < 15; index += 1) {
      segmenter.push({ sampleRate: 16_000, samples: frame });
    }
    expect(frame).toEqual(original);
    expect(segmenter.finish().segments[0]?.boundary).toBe('release');

    const capped = new VoiceSegmenter();
    pushMs(capped, 61_000, 0.1);
    expect(capped.limitReached).toBe(true);
    expect(capped.capturedDurationMs).toBeCloseTo(60_000, 0);
  });
});

describe('encodePcm16Wav', () => {
  it('resamples and writes canonical mono 16 kHz PCM16 headers', () => {
    const encoded = encodePcm16Wav(
      new Float32Array([-2, -1, 0, 0.5, 1, 2]),
      48_000,
    );
    const view = new DataView(
      encoded.bytes.buffer,
      encoded.bytes.byteOffset,
      encoded.bytes.byteLength,
    );
    const ascii = (start: number, length: number) =>
      String.fromCharCode(...encoded.bytes.slice(start, start + length));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(4, true)).toBe(encoded.bytes.length - 8);
    expect(view.getUint32(40, true)).toBe(encoded.bytes.length - 44);
  });

  it('rejects empty and over-limit input', () => {
    expect(() => encodePcm16Wav(new Float32Array(), 16_000)).toThrow();
    expect(() => encodePcm16Wav(pcm(15_020, 16_000, 0.1), 16_000)).toThrow();
  });
});

describe('transcript assembly and upload queue', () => {
  it('holds out-of-order results until the prefix is contiguous', () => {
    const assembler = new OrderedTranscriptAssembler();
    assembler.addSuccess({
      overlapWithPrevious: false,
      sequence: 1,
      text: 'and search',
    });
    expect(assembler.provisionalTranscript()).toBe('');
    assembler.addSuccess({
      overlapWithPrevious: false,
      sequence: 0,
      text: 'open YouTube',
    });
    expect(assembler.provisionalTranscript()).toBe('open YouTube and search');
  });

  it('removes only exact normalized hard-boundary overlap', () => {
    expect(
      joinTranscriptSegments(
        'Open YouTube, and search',
        'AND SEARCH for cats.',
        true,
      ),
    ).toBe('Open YouTube, and search for cats.');
    expect(joinTranscriptSegments('delete file', 'file now', true)).toBe(
      'delete file file now',
    );
    expect(joinTranscriptSegments('mở YouTube', 'MỞ YOUTUBE rồi tìm', true)).toBe(
      'mở YouTube rồi tìm',
    );
  });

  it('never runs more than two uploads concurrently', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const worker = vi.fn(
      (value: number) =>
        new Promise<number>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve(value);
          });
        }),
    );
    const queue = new SegmentUploadQueue(worker, 2);
    const results = [0, 1, 2, 3].map((value) => queue.enqueue(value));
    expect(worker).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(worker).toHaveBeenCalledTimes(3);
    while (releases.length > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3]);
    expect(maximumActive).toBe(2);
  });

  it('cancels work that has not crossed the dispatch boundary', async () => {
    let release: (() => void) | undefined;
    const queue = new SegmentUploadQueue(
      (value: number) =>
        new Promise<number>((resolve) => {
          release = () => resolve(value);
        }),
      1,
    );
    const active = queue.enqueue(1);
    const pending = queue.enqueue(2);
    queue.cancelPending();
    await expect(pending).rejects.toThrow('cancelled');
    release?.();
    await expect(active).resolves.toBe(1);
  });
});
