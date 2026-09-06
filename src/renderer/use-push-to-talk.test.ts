import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE_TRANSCRIPTION_MODEL } from '../shared/contracts';

import {
  logVoiceConnectionFailure,
  voiceConnectionErrorMessage,
} from './features/voice/voice-diagnostics';
import {
  beginPushToTalkAttemptIfValid,
  handleVoiceShortcutEvent,
  shouldCancelVoiceTurnForAvailability,
  shouldFinishVoiceOnLocalRelease,
  shouldMuteSystemAudioForVoice,
} from './features/voice/voice-input-policy';
import {
  usePushToTalk,
  type VoiceAttemptDecision,
  type VoiceCommitDisposition,
  type VoiceTurnContext,
} from './use-push-to-talk';

const reactHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}));

const captureHarness = vi.hoisted(() => ({
  onFrame: null as
    null | ((frame: { samples: Float32Array; sampleRate: number }) => void),
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

function pressShortcut(target: EventTarget, activate = true): void {
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
  if (activate) vi.advanceTimersByTime(120);
}

function releaseShortcut(target: EventTarget): void {
  target.dispatchEvent(
    Object.assign(new Event('keyup'), {
      code: 'ControlLeft',
      key: 'Control',
    }),
  );
  target.dispatchEvent(
    Object.assign(new Event('keyup'), {
      code: 'MetaLeft',
      key: 'Meta',
    }),
  );
}

function setup(upload = vi.fn(), selectedMode: 'dictation' | 'task' = 'task') {
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
    onAttemptStart: vi.fn(
      async (context: VoiceTurnContext): Promise<VoiceAttemptDecision> => ({
        accepted: true,
        destination:
          context.mode === 'task'
            ? { kind: 'task', label: 'Tro task' }
            : { kind: 'tro_composer', label: 'Tro composer' },
      }),
    ),
    onError: vi.fn(),
    onTranscriptChange: vi.fn(),
    onTranscriptReady: vi.fn(
      async (): Promise<VoiceCommitDisposition | void> => undefined,
    ),
    onTurnEnd: vi.fn(),
  };
  // The lightweight test harness invokes the hook with mocked React primitives.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const state = usePushToTalk({ ...callbacks, selectedMode });
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

  it('rejects preflight before opening the microphone', async () => {
    const { callbacks, fakeWindow, upload } = setup(vi.fn());
    callbacks.onAttemptStart.mockResolvedValueOnce({
      accepted: false,
      destination: { kind: 'application', label: 'Current application' },
    });

    pressShortcut(fakeWindow);
    await flushMicrotasks();

    expect(captureHarness.open).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'preflight_rejected',
    );
  });

  it('cancels a local Dictation gesture during the settle interval', async () => {
    const { callbacks, fakeWindow } = setup(vi.fn(), 'dictation');
    pressShortcut(fakeWindow, false);
    fakeWindow.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'Escape',
        key: 'Escape',
        repeat: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(120);
    await flushMicrotasks();

    expect(callbacks.onAttemptStart).not.toHaveBeenCalled();
    expect(captureHarness.open).not.toHaveBeenCalled();
  });

  it('commits Dictation immediately', async () => {
    const upload = vi.fn(async (request) => ({
      audioDurationMs: request.durationMs,
      billedSeconds: request.durationMs / 1_000,
      model: VOICE_TRANSCRIPTION_MODEL,
      sequence: request.sequence,
      text: 'dictated words',
      utteranceId: request.utteranceId,
    }));
    const { callbacks, fakeWindow } = setup(upload, 'dictation');

    pressShortcut(fakeWindow);
    await vi.advanceTimersByTimeAsync(120);
    await flushMicrotasks();
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    await flushMicrotasks();
    releaseShortcut(fakeWindow);
    await flushMicrotasks();

    expect(callbacks.onTranscriptReady).toHaveBeenCalledOnce();
    expect(callbacks.onTranscriptReady).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dictation' }),
      'dictated words',
    );
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
  });

  it('cleans a preflight that resolves after physical release exactly once', async () => {
    let resolvePreflight: (decision: {
      accepted: boolean;
      destination: { kind: 'task'; label: string };
    }) => void = () => undefined;
    const { callbacks, fakeWindow } = setup(vi.fn());
    callbacks.onAttemptStart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreflight = resolve;
        }),
    );

    pressShortcut(fakeWindow);
    await flushMicrotasks();
    releaseShortcut(fakeWindow);
    resolvePreflight({
      accepted: true,
      destination: { kind: 'task', label: 'Tro task' },
    });
    await flushMicrotasks();

    expect(captureHarness.open).not.toHaveBeenCalled();
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'cancelled',
    );
  });

  it('shows a completed phrase before release and submits immediately on release', async () => {
    const diagnostic = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const upload = vi.fn(async (request) => ({
      audioDurationMs: request.durationMs,
      billedSeconds: request.durationMs / 1_000,
      model: VOICE_TRANSCRIPTION_MODEL,
      sequence: request.sequence,
      text: 'open YouTube',
      utteranceId: request.utteranceId,
    }));
    const { callbacks, fakeWindow } = setup(upload);
    callbacks.onTranscriptReady.mockResolvedValueOnce('task_submitted');
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    emitFrames(15, 0.1);
    emitFrames(35, 0);
    await flushMicrotasks();

    expect(upload).toHaveBeenCalledOnce();
    expect(callbacks.onTranscriptChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'open YouTube',
    );
    expect(callbacks.onTranscriptReady).not.toHaveBeenCalled();

    releaseShortcut(fakeWindow);
    await flushMicrotasks();
    expect(callbacks.onTranscriptReady).toHaveBeenCalledOnce();
    expect(callbacks.onTranscriptReady).toHaveBeenCalledWith(
      expect.objectContaining({ activation: 'local_hold', mode: 'task' }),
      'open YouTube',
    );
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'completed',
    );
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining('"disposition":"task_submitted"'),
    );
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
      model: VOICE_TRANSCRIPTION_MODEL,
      sequence: 1,
      text: 'and search',
      utteranceId: second?.utteranceId,
    });
    await flushMicrotasks();
    expect(callbacks.onTranscriptReady).not.toHaveBeenCalled();
    resolvers.get(0)?.({
      audioDurationMs: 300,
      billedSeconds: 0.3,
      model: VOICE_TRANSCRIPTION_MODEL,
      sequence: 0,
      text: 'open YouTube',
      utteranceId: first?.utteranceId,
    });
    await flushMicrotasks();
    expect(callbacks.onTranscriptChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'open YouTube and search',
    );
    expect(callbacks.onTranscriptReady).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'open YouTube and search',
    );
    expect(callbacks.onTranscriptReady).toHaveBeenCalledOnce();
  });

  it('prevents submission when any segment fails', async () => {
    const upload = vi.fn(async (request) => {
      if (request.sequence === 1) throw new Error('provider unavailable');
      return {
        audioDurationMs: 300,
        billedSeconds: 0.3,
        model: VOICE_TRANSCRIPTION_MODEL,
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

    expect(callbacks.onTranscriptReady).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(
      'A part of this recording could not be transcribed. Review it or record again.',
    );
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'partial_failure',
    );
  });

  it('ends a no-speech turn exactly once without provider work', async () => {
    const { callbacks, fakeWindow, upload } = setup(vi.fn(), 'dictation');
    pressShortcut(fakeWindow);
    await vi.advanceTimersByTimeAsync(120);
    await flushMicrotasks();

    releaseShortcut(fakeWindow);
    await flushMicrotasks();

    expect(upload).not.toHaveBeenCalled();
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dictation' }),
      'no_speech',
    );
  });

  it('ends a microphone failure exactly once', async () => {
    captureHarness.open.mockRejectedValueOnce(
      new DOMException('Permission denied', 'NotAllowedError'),
    );
    const { callbacks, fakeWindow, upload } = setup(vi.fn());
    pressShortcut(fakeWindow);
    await flushMicrotasks();

    expect(upload).not.toHaveBeenCalled();
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'failed',
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
    const { callbacks, fakeWindow, upload } = setup(vi.fn());
    pressShortcut(fakeWindow);
    await flushMicrotasks();
    releaseShortcut(fakeWindow);
    resolveCapture({ stop: captureHarness.stop });
    await flushMicrotasks();
    expect(captureHarness.stop).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
    expect(callbacks.onTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'task' }),
      'cancelled',
    );
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
      model: VOICE_TRANSCRIPTION_MODEL,
      sequence: 0,
      text: 'late text',
      utteranceId: crypto.randomUUID(),
    });
    await flushMicrotasks();
    expect(callbacks.onTranscriptReady).not.toHaveBeenCalled();
    expect(callbacks.onTurnEnd).toHaveBeenCalledOnce();
  });

  it('stops at 60 seconds but waits for physical release before submitting', async () => {
    const upload = vi.fn(async (request) => ({
      audioDurationMs: request.durationMs,
      billedSeconds: request.durationMs / 1_000,
      model: VOICE_TRANSCRIPTION_MODEL,
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
    expect(callbacks.onTranscriptReady).not.toHaveBeenCalled();

    releaseShortcut(fakeWindow);
    await flushMicrotasks();
    expect(callbacks.onTranscriptReady).toHaveBeenCalledOnce();
  });
});

describe('push-to-talk helpers', () => {
  it('does not cancel a finalizing voice turn during Task submission', () => {
    expect(
      shouldCancelVoiceTurnForAvailability({
        disabled: true,
        enabled: true,
        finalizing: true,
        platform: 'macos',
      }),
    ).toBe(false);
    expect(
      shouldCancelVoiceTurnForAvailability({
        disabled: true,
        enabled: true,
        finalizing: false,
        platform: 'macos',
      }),
    ).toBe(true);
  });

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
      {
        beginListening,
        finishListening,
        isListening: false,
        selectedMode: 'task',
      },
    );
    expect(beginListening).toHaveBeenCalledWith('task');
    expect(
      shouldFinishVoiceOnLocalRelease({
        activationMode: 'global_hold',
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
      '[voice] GPT Transcribe transcription failed.',
      expect.objectContaining({ step: 'segment_upload' }),
    );
  });
});
