import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginPushToTalkAttemptIfValid,
  handleVoiceShortcutEvent,
  logVoiceConnectionFailure,
  shouldFinishVoiceOnLocalRelease,
  shouldMuteSystemAudioForVoice,
  usePushToTalk,
  VOICE_TRANSCRIPT_CONFIRMATION_MS,
  voiceConnectionErrorMessage,
} from './use-push-to-talk';

const reactHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}));

const captureHarness = vi.hoisted(() => ({
  onFrame: null as null | ((frame: { samples: Float32Array; sampleRate: number }) => void),
  open: vi.fn(),
  stop: vi.fn(async () => undefined),
}));

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) reactHarness.cleanups.push(cleanup);
  },
  useRef: (initialValue: unknown) => ({ current: initialValue }),
  useState: (initialValue: unknown) => [
    typeof initialValue === 'function'
      ? (initialValue as () => unknown)()
      : initialValue,
    vi.fn(),
  ],
}));

vi.mock('./voice-capture', () => ({
  openVoiceCapture: captureHarness.open,
}));

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

async function finishTranscriptConfirmation(): Promise<void> {
  await vi.advanceTimersByTimeAsync(VOICE_TRANSCRIPT_CONFIRMATION_MS);
  await flushMicrotasks();
}

function frame(amplitude: number): Float32Array {
  const samples = new Float32Array(320);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = index % 2 === 0 ? amplitude : -amplitude;
  }
  return samples;
}

function emitFrames(count: number, amplitude: number): void {
  for (let index = 0; index < count; index += 1) {
    captureHarness.onFrame?.({ sampleRate: 16_000, samples: frame(amplitude) });
  }
}

function pressShortcut(target: EventTarget): void {
  target.dispatchEvent(
    Object.assign(new Event('keydown'), {
      code: 'MetaLeft',
      key: 'Meta',
      repeat: false,
    }),
  );
  target.dispatchEvent(
    Object.assign(new Event('keydown'), {
      code: 'ControlLeft',
      key: 'Control',
      repeat: false,
    }),
  );
}

function releaseShortcut(target: EventTarget): void {
  target.dispatchEvent(
    Object.assign(new Event('keyup'), {
      code: 'ControlLeft',
      key: 'Control',
    }),
  );
}

function setup(upload = vi.fn()) {
  const fakeWindow = Object.assign(new EventTarget(), {
    tro: {
      onVoiceShortcut: vi.fn(() => vi.fn()),
      reportVoiceDiagnostic: vi.fn(async () => undefined),
      transcribeVoiceSegment: upload,
    },
  });
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn() },
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh)',
  });
  vi.stubGlobal('window', fakeWindow);
  if (!captureHarness.open.getMockImplementation()) {
    captureHarness.open.mockImplementation(async ({ onFrame }) => {
      captureHarness.onFrame = onFrame;
      return { stop: captureHarness.stop };
    });
  }
  const callbacks = {
    onAttemptStart: vi.fn(),
    onError: vi.fn(),
    onTranscriptChange: vi.fn(),
    onTranscriptSubmit: vi.fn(),
  };
  // The lightweight test harness invokes the hook with mocked React primitives.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const state = usePushToTalk(callbacks);
  return { callbacks, fakeWindow, state, upload };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const cleanup of reactHarness.cleanups.splice(0).reverse()) cleanup();
  captureHarness.onFrame = null;
  captureHarness.open.mockReset();
  captureHarness.stop.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('segmented push-to-talk lifecycle', () => {
  it('does no microphone or provider work while enabled and idle', () => {
    const { upload } = setup(vi.fn());
    expect(captureHarness.open).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('shows a completed phrase before release but submits only after release', async () => {
    const upload = vi.fn(async (request) => ({
      audioDurationMs: request.durationMs,
      billedSeconds: request.durationMs / 1_000,
      model: 'whisper-1',
      sequence: request.sequence,
      text: 'open YouTube',
      utteranceId: request.utteranceId,
    }));
    const { callbacks, fakeWindow } = setup(upload);
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    await flushMicrotasks();

    expect(upload).toHaveBeenCalledOnce();
    expect(callbacks.onTranscriptChange).toHaveBeenCalledWith('open YouTube');
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();

    releaseShortcut(fakeWindow);
    await flushMicrotasks();
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();
    await finishTranscriptConfirmation();
    expect(callbacks.onTranscriptSubmit).toHaveBeenCalledOnce();
    expect(callbacks.onTranscriptSubmit).toHaveBeenCalledWith('open YouTube');
  });

  it('waits for out-of-order segments and submits one ordered transcript', async () => {
    const resolvers = new Map<number, (value: unknown) => void>();
    const requests = new Map<number, Record<string, unknown>>();
    const upload = vi.fn(
      (request: Record<string, unknown>) =>
        new Promise((resolve) => {
          requests.set(request.sequence as number, request);
          resolvers.set(request.sequence as number, resolve);
        }),
    );
    const { callbacks, fakeWindow } = setup(upload);
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    await flushMicrotasks();
    releaseShortcut(fakeWindow);

    const second = requests.get(1);
    const first = requests.get(0);
    resolvers.get(1)?.({
      audioDurationMs: 300,
      billedSeconds: 0.3,
      model: 'whisper-1',
      sequence: 1,
      text: 'and search',
      utteranceId: second?.utteranceId,
    });
    await flushMicrotasks();
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();
    resolvers.get(0)?.({
      audioDurationMs: 300,
      billedSeconds: 0.3,
      model: 'whisper-1',
      sequence: 0,
      text: 'open YouTube',
      utteranceId: first?.utteranceId,
    });
    await flushMicrotasks();
    expect(callbacks.onTranscriptChange).toHaveBeenLastCalledWith(
      'open YouTube and search',
    );
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();
    await finishTranscriptConfirmation();
    expect(callbacks.onTranscriptSubmit).toHaveBeenCalledWith(
      'open YouTube and search',
    );
    expect(callbacks.onTranscriptSubmit).toHaveBeenCalledOnce();
  });

  it('prevents submission when any segment fails', async () => {
    const upload = vi.fn(async (request) => {
      if (request.sequence === 1) throw new Error('provider unavailable');
      return {
        audioDurationMs: 300,
        billedSeconds: 0.3,
        model: 'whisper-1',
        sequence: request.sequence,
        text: 'open YouTube',
        utteranceId: request.utteranceId,
      };
    });
    const { callbacks, fakeWindow } = setup(upload);
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    await flushMicrotasks();
    releaseShortcut(fakeWindow);
    await flushMicrotasks();

    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(
      'A part of this recording could not be transcribed. Review it or record again.',
    );
  });

  it('release during permission acquisition cleans up and never uploads', async () => {
    let resolveCapture: (value: { stop: () => Promise<void> }) => void = () =>
      undefined;
    captureHarness.open.mockImplementation(
      ({ onFrame }) =>
        new Promise((resolve) => {
          captureHarness.onFrame = onFrame;
          resolveCapture = resolve;
        }),
    );
    const { fakeWindow, upload } = setup(vi.fn());
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    releaseShortcut(fakeWindow);
    resolveCapture({ stop: captureHarness.stop });
    await flushMicrotasks();
    expect(captureHarness.stop).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('cancellation ignores late transcription results', async () => {
    let resolveUpload: (value: unknown) => void = () => undefined;
    const upload = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const { callbacks, fakeWindow, state } = setup(upload);
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    await flushMicrotasks();
    state.cancel();
    resolveUpload({
      audioDurationMs: 300,
      billedSeconds: 0.3,
      model: 'whisper-1',
      sequence: 0,
      text: 'late text',
      utteranceId: crypto.randomUUID(),
    });
    await flushMicrotasks();
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();
  });

  it('stops at 60 seconds but waits for physical release before submitting', async () => {
    const upload = vi.fn(async (request) => ({
      audioDurationMs: request.durationMs,
      billedSeconds: request.durationMs / 1_000,
      model: 'whisper-1',
      sequence: request.sequence,
      text: 'continue command',
      utteranceId: request.utteranceId,
    }));
    const { callbacks, fakeWindow } = setup(upload);
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    emitFrames(3_000, 0.1);
    await flushMicrotasks();

    expect(captureHarness.stop).toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(
      'Voice input reached 60 seconds. Release the shortcut to finish.',
    );
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();

    releaseShortcut(fakeWindow);
    await flushMicrotasks();
    expect(callbacks.onTranscriptSubmit).not.toHaveBeenCalled();
    await finishTranscriptConfirmation();
    expect(callbacks.onTranscriptSubmit).toHaveBeenCalledOnce();
  });
});

describe('push-to-talk helpers', () => {
  it('starts only valid attempts', () => {
    const start = vi.fn();
    expect(
      beginPushToTalkAttemptIfValid(
        {
          disabled: false,
          enabled: true,
          hasActiveTurn: false,
          isChordHeld: false,
          platform: 'macos',
        },
        start,
      ),
    ).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });

  it('handles global and local release ownership', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();
    handleVoiceShortcutEvent(
      { action: 'pressed', source: 'global' },
      { beginListening, finishListening, isListening: false },
    );
    expect(beginListening).toHaveBeenCalledOnce();
    expect(
      shouldFinishVoiceOnLocalRelease({
        activationMode: 'global-hold',
        isListening: true,
        isLocalChordHeld: false,
      }),
    ).toBe(false);
  });

  it('mutes system audio only while the configured shortcut is held', () => {
    expect(shouldMuteSystemAudioForVoice(true, true)).toBe(true);
    expect(shouldMuteSystemAudioForVoice(true, false)).toBe(false);
    expect(shouldMuteSystemAudioForVoice(false, true)).toBe(false);
  });

  it('reports microphone and segment diagnostics without Realtime wording', () => {
    expect(
      voiceConnectionErrorMessage(
        new DOMException('Permission denied', 'NotAllowedError'),
      ),
    ).toContain('Microphone access');
    const logger = { error: vi.fn() };
    logVoiceConnectionFailure('segment_upload', new Error('failed'), logger);
    expect(logger.error).toHaveBeenCalledWith(
      '[voice] Whisper transcription failed.',
      expect.objectContaining({ step: 'segment_upload' }),
    );
  });
});
