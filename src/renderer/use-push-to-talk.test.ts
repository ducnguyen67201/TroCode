import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginPushToTalkAttemptIfValid,
  handleVoiceShortcutEvent,
  canCommitInputAudioBuffer,
  hasNewOutboundAudio,
  logVoiceConnectionFailure,
  shouldFinishVoiceOnLocalRelease,
  shouldMuteSystemAudioForVoice,
  usePushToTalk,
  voiceConnectionErrorMessage,
} from './use-push-to-talk';

const reactHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}));

const transportHarness = vi.hoisted(() => ({
  openTransport: vi.fn(),
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

vi.mock('./realtime-voice-transport', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    openRealtimeVoiceTransport: transportHarness.openTransport,
  };
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of reactHarness.cleanups.splice(0).reverse()) cleanup();
  transportHarness.openTransport.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('push-to-talk attempt lifecycle', () => {
  it('clears stale UI state when a valid attempt begins', () => {
    const onAttemptStart = vi.fn();

    expect(
      beginPushToTalkAttemptIfValid(
        {
          disabled: false,
          enabled: true,
          hasActiveTurn: false,
          isChordHeld: false,
          platform: 'macos',
        },
        onAttemptStart,
      ),
    ).toBe(true);
    expect(onAttemptStart).toHaveBeenCalledOnce();
  });

  it('uses a microphone-free warm transport and replenishes it after transcription', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const audioTrack = {
      enabled: true,
      muted: false,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;
    let statsReadCount = 0;
    const replaceTrack = vi.fn(async () => undefined);
    const sender = {
      getStats: vi.fn(async () => ({
        forEach: (
          callback: (stats: RTCOutboundRtpStreamStats) => void,
        ): void => {
          callback({
            bytesSent: statsReadCount === 0 ? 0 : 256,
            id: 'audio-outbound',
            kind: 'audio',
            packetsSent: statsReadCount === 0 ? 0 : 2,
            ssrc: 1,
            timestamp: 1_000,
            type: 'outbound-rtp',
          } as RTCOutboundRtpStreamStats);
          statsReadCount += 1;
        },
      })),
      replaceTrack,
    } as unknown as RTCRtpSender;
    const sendVoiceEvent = vi.fn();
    const channel = Object.assign(new EventTarget(), {
      close: vi.fn(),
      readyState: 'open' as RTCDataChannelState,
      send: sendVoiceEvent,
    }) as unknown as RTCDataChannel;
    const connection = Object.assign(new EventTarget(), {
      close: vi.fn(),
      connectionState: 'connected' as RTCPeerConnectionState,
    }) as unknown as RTCPeerConnection;
    const releasePlaceholderAudio = vi.fn();
    const transport = {
      channel,
      connection,
      releasePlaceholderAudio,
      sender,
    };
    const getUserMedia = vi.fn(async () => stream);
    const onTranscriptSubmit = vi.fn();
    const fakeWindow = Object.assign(new EventTarget(), {
      tro: {
        onVoiceShortcut: vi.fn(() => vi.fn()),
        reportVoiceDiagnostic: vi.fn(async () => undefined),
      },
    });

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    });
    vi.stubGlobal('window', fakeWindow);
    transportHarness.openTransport.mockResolvedValue(transport);

    usePushToTalk({
      onAttemptStart: vi.fn(),
      onError: vi.fn(),
      onTranscriptChange: vi.fn(),
      onTranscriptSubmit,
    });
    await flushMicrotasks();

    expect(transportHarness.openTransport).toHaveBeenCalledOnce();
    expect(transportHarness.openTransport).toHaveBeenCalledWith();
    expect(getUserMedia).not.toHaveBeenCalled();

    fakeWindow.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'MetaLeft',
        key: 'Meta',
        repeat: false,
      }),
    );
    fakeWindow.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'ControlLeft',
        key: 'Control',
        repeat: false,
      }),
    );
    await flushMicrotasks();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(transportHarness.openTransport).toHaveBeenCalledOnce();
    expect(sendVoiceEvent).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input_audio_buffer.clear' }),
    );
    expect(
      sendVoiceEvent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      replaceTrack.mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY,
    );
    expect(replaceTrack).toHaveBeenCalledWith(audioTrack);
    expect(releasePlaceholderAudio).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(300);
    fakeWindow.dispatchEvent(
      Object.assign(new Event('keyup'), {
        code: 'ControlLeft',
        key: 'Control',
      }),
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(channel.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input_audio_buffer.commit' }),
    );
    channel.dispatchEvent(
      Object.assign(new Event('message'), {
        data: JSON.stringify({
          transcript: 'send the transcript',
          type: 'conversation.item.input_audio_transcription.completed',
        }),
      }),
    );

    expect(onTranscriptSubmit).toHaveBeenCalledWith('send the transcript');
    await flushMicrotasks();
    expect(transportHarness.openTransport).toHaveBeenCalledTimes(2);
    expect(channel.close).toHaveBeenCalledOnce();
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('queues release while the realtime transport is still connecting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const consoleInfo = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const audioTrack = {
      enabled: true,
      muted: false,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;
    const channel = Object.assign(new EventTarget(), {
      close: vi.fn(),
      readyState: 'open' as RTCDataChannelState,
      send: vi.fn(),
    }) as unknown as RTCDataChannel;
    const connection = Object.assign(new EventTarget(), {
      close: vi.fn(),
      connectionState: 'connected' as RTCPeerConnectionState,
    }) as unknown as RTCPeerConnection;
    const sender = {
      getStats: vi.fn(async () => ({
        forEach: (
          callback: (stats: RTCOutboundRtpStreamStats) => void,
        ): void => {
          callback({
            bytesSent: 256,
            id: 'audio-outbound',
            kind: 'audio',
            packetsSent: 2,
            ssrc: 1,
            timestamp: 1_600,
            type: 'outbound-rtp',
          } as RTCOutboundRtpStreamStats);
        },
      })),
      replaceTrack: vi.fn(async () => undefined),
    } as unknown as RTCRtpSender;
    const transport = { channel, connection, sender };
    let resolveTransport: (value: typeof transport) => void = () => undefined;
    transportHarness.openTransport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTransport = resolve;
        }),
    );
    const fakeWindow = Object.assign(new EventTarget(), {
      tro: {
        onVoiceShortcut: vi.fn(() => vi.fn()),
        reportVoiceDiagnostic: vi.fn(async () => undefined),
      },
    });

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    });
    vi.stubGlobal('window', fakeWindow);

    const onError = vi.fn();
    usePushToTalk({
      onAttemptStart: vi.fn(),
      onError,
      onTranscriptChange: vi.fn(),
      onTranscriptSubmit: vi.fn(),
    });
    fakeWindow.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'MetaLeft',
        key: 'Meta',
        repeat: false,
      }),
    );
    fakeWindow.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'ControlLeft',
        key: 'Control',
        repeat: false,
      }),
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(600);

    fakeWindow.dispatchEvent(
      Object.assign(new Event('keyup'), {
        code: 'ControlLeft',
        key: 'Control',
      }),
    );

    expect(consoleInfo).toHaveBeenCalledWith(
      '[voice:renderer] turn.release-queued {"attempt":1,"heldMs":600,"phase":"realtime_call"}',
    );
    expect(onError).not.toHaveBeenCalled();

    resolveTransport(transport);
    await flushMicrotasks();

    expect(channel.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    await flushMicrotasks();

    expect(channel.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input_audio_buffer.commit' }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not clear UI state when the attempt is invalid', () => {
    const onAttemptStart = vi.fn();

    expect(
      beginPushToTalkAttemptIfValid(
        {
          disabled: true,
          enabled: true,
          hasActiveTurn: false,
          isChordHeld: false,
          platform: 'macos',
        },
        onAttemptStart,
      ),
    ).toBe(false);
    expect(onAttemptStart).not.toHaveBeenCalled();
  });

  it('rejects audio commits before capture has started', () => {
    expect(canCommitInputAudioBuffer(null, 1_000)).toBe(false);
  });

  it('rejects audio commits shorter than the safe capture threshold', () => {
    expect(canCommitInputAudioBuffer(1_000, 1_249)).toBe(false);
    expect(canCommitInputAudioBuffer(1_000, 1_250)).toBe(true);
  });

  it('requires newly transmitted RTP audio before committing', () => {
    expect(
      hasNewOutboundAudio(
        { bytesSent: 1_000, packetsSent: 10 },
        { bytesSent: 1_000, packetsSent: 10 },
      ),
    ).toBe(false);
    expect(
      hasNewOutboundAudio(
        { bytesSent: 1_000, packetsSent: 10 },
        { bytesSent: 1_256, packetsSent: 12 },
      ),
    ).toBe(true);
  });
});

describe('voice connection diagnostics', () => {
  it('turns renderer fetch failures into an actionable voice message', () => {
    expect(voiceConnectionErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'TroCode could not reach OpenAI voice. Check network access to api.openai.com and try again.',
    );
  });

  it('logs the failed voice connection step without exposing secrets', () => {
    const error = new TypeError('Failed to fetch');
    const logger = {
      error: vi.fn(),
    };

    logVoiceConnectionFailure('realtime_call', error, logger);

    expect(logger.error).toHaveBeenCalledWith(
      '[voice] OpenAI Realtime connection failed.',
      {
        error: {
          message: 'Failed to fetch',
          name: 'TypeError',
        },
        step: 'realtime_call',
      },
    );
  });
});

describe('global voice shortcut events', () => {
  it('lets only the matching local hold release finish a local turn', () => {
    expect(
      shouldFinishVoiceOnLocalRelease({
        activationMode: 'global-hold',
        isListening: true,
        isLocalChordHeld: false,
      }),
    ).toBe(false);
    expect(
      shouldFinishVoiceOnLocalRelease({
        activationMode: 'local-hold',
        isListening: true,
        isLocalChordHeld: false,
      }),
    ).toBe(true);
  });

  it('starts listening when the global press arrives while inactive', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'pressed', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: false,
      },
    );

    expect(beginListening).toHaveBeenCalledOnce();
    expect(finishListening).not.toHaveBeenCalled();
  });

  it('ignores a repeated global press while already listening', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'pressed', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: true,
      },
    );

    expect(beginListening).not.toHaveBeenCalled();
    expect(finishListening).not.toHaveBeenCalled();
  });

  it('finishes listening when the global release arrives while active', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'released', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: true,
      },
    );

    expect(finishListening).toHaveBeenCalledOnce();
    expect(beginListening).not.toHaveBeenCalled();
  });

  it('ignores global release while inactive', () => {
    const beginListening = vi.fn();
    const finishListening = vi.fn();

    handleVoiceShortcutEvent(
      { action: 'released', source: 'global' },
      {
        beginListening,
        finishListening,
        isListening: false,
      },
    );

    expect(beginListening).not.toHaveBeenCalled();
    expect(finishListening).not.toHaveBeenCalled();
  });
});

describe('system audio ducking lifecycle', () => {
  it('mutes only while the preference is enabled and the shortcut is held', () => {
    expect(shouldMuteSystemAudioForVoice(true, true)).toBe(true);
    expect(shouldMuteSystemAudioForVoice(true, false)).toBe(false);
    expect(shouldMuteSystemAudioForVoice(false, true)).toBe(false);
  });
});
