import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createGuidanceAudioPlayback } from './guidance-audio-playback';

function audioHarness() {
  const listeners = new Map<string, () => void>();
  return {
    audio: {
      addEventListener: vi.fn((type: string, listener: () => void) =>
        listeners.set(type, listener),
      ),
      load: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
      src: '',
    },
    emit(type: string) {
      listeners.get(type)?.();
    },
  };
}

function utteranceHarness() {
  const utterance = {
    lang: '',
    onend: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onstart: null as (() => void) | null,
    rate: 1,
  };
  const synthesis = {
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    speak: vi.fn(() => utterance.onstart?.()),
  };
  return { synthesis, utterance };
}

describe('guidance audio playback', () => {
  it('reports progressive media playback and terminal completion', () => {
    const id = randomUUID();
    const media = audioHarness();
    const voice = utteranceHarness();
    const report = vi.fn();
    const playback = createGuidanceAudioPlayback({
      audioFactory: () => media.audio,
      clearTimer: vi.fn(),
      message: 'Choose the first result',
      onStatus: vi.fn(),
      paused: false,
      report,
      setTimer: vi.fn(() => 1),
      speech: {
        id,
        mediaUrl: `trocode-audio://speech/${id}`,
        mimeType: 'audio/mpeg',
        source: 'elevenlabs',
      },
      speechSynthesis: voice.synthesis,
      utteranceFactory: () => voice.utterance,
    });

    expect(media.audio.src).toBe(`trocode-audio://speech/${id}`);
    media.emit('playing');
    media.emit('ended');
    expect(report).toHaveBeenCalledWith({
      id,
      phase: 'playing',
      source: 'elevenlabs',
    });
    expect(report).toHaveBeenCalledWith({
      id,
      phase: 'ended',
      source: 'elevenlabs',
    });
    expect(voice.synthesis.speak).not.toHaveBeenCalled();
    playback.dispose();
  });

  it('fully stops media before starting one fallback voice', () => {
    const id = randomUUID();
    const media = audioHarness();
    const voice = utteranceHarness();
    const report = vi.fn();
    let timeout: () => void = () => undefined;
    const playback = createGuidanceAudioPlayback({
      audioFactory: () => media.audio,
      clearTimer: vi.fn(),
      message: 'Nhấn vào bộ lọc',
      onStatus: vi.fn(),
      paused: false,
      report,
      setTimer: (callback) => {
        timeout = callback;
        return 1;
      },
      speech: {
        id,
        mediaUrl: `trocode-audio://speech/${id}`,
        mimeType: 'audio/mpeg',
        source: 'elevenlabs',
      },
      speechSynthesis: voice.synthesis,
      utteranceFactory: () => voice.utterance,
    });

    timeout();
    media.emit('error');
    expect(media.audio.pause).toHaveBeenCalled();
    expect(media.audio.load).toHaveBeenCalled();
    expect(voice.synthesis.speak).toHaveBeenCalledOnce();
    expect(voice.utterance.lang).toBe('vi-VN');
    expect(report).toHaveBeenCalledWith({
      id,
      phase: 'fallback_started',
      reason: 'startup_timeout',
      source: 'elevenlabs',
    });
    voice.utterance.onend?.();
    expect(report).toHaveBeenLastCalledWith({
      id,
      phase: 'ended',
      source: 'system',
    });
    playback.dispose();
  });

  it('pauses and resumes the currently active source and ignores events after disposal', () => {
    const id = randomUUID();
    const media = audioHarness();
    const report = vi.fn();
    const playback = createGuidanceAudioPlayback({
      audioFactory: () => media.audio,
      clearTimer: vi.fn(),
      message: 'Continue',
      onStatus: vi.fn(),
      paused: false,
      report,
      setTimer: vi.fn(() => 1),
      speech: {
        id,
        mediaUrl: `trocode-audio://speech/${id}`,
        mimeType: 'audio/mpeg',
        source: 'elevenlabs',
      },
      speechSynthesis: utteranceHarness().synthesis,
      utteranceFactory: () => utteranceHarness().utterance,
    });

    playback.setPaused(true);
    playback.setPaused(false);
    expect(media.audio.pause).toHaveBeenCalled();
    expect(media.audio.play).toHaveBeenCalledTimes(2);
    playback.dispose();
    media.emit('ended');
    expect(report).not.toHaveBeenCalled();
  });
});
