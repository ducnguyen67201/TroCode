import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VoiceSession } from '../shared/contracts';

import {
  beginPushToTalkAttemptIfValid,
  canCommitInputAudioBuffer,
  hasNewOutboundAudio,
  usePushToTalk,
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

const SESSION: VoiceSession = {
  clientSecret: 'ek_test_secret',
  expiresAt: 2_000_000_000,
  model: 'gpt-4o-mini-transcribe',
};

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

afterEach(() => {
  for (const cleanup of reactHarness.cleanups.splice(0).reverse()) cleanup();
  transportHarness.openTransport.mockReset();
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

  it('prepares one reusable transport before the shortcut is held', async () => {
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
      replaceTrack: vi.fn(async () => undefined),
    } as unknown as RTCRtpSender;
    const channel = Object.assign(new EventTarget(), {
      close: vi.fn(),
      readyState: 'open' as RTCDataChannelState,
      send: vi.fn(),
    }) as unknown as RTCDataChannel;
    const connection = Object.assign(new EventTarget(), {
      close: vi.fn(),
      connectionState: 'connected' as RTCPeerConnectionState,
    }) as unknown as RTCPeerConnection;
    const transport = { channel, connection, sender };
    const createVoiceSession = vi.fn(async () => SESSION);
    const getUserMedia = vi.fn(async () => stream);
    const onTranscriptSubmit = vi.fn();
    const fakeWindow = Object.assign(new EventTarget(), {
      tro: { createVoiceSession },
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

    expect(createVoiceSession).toHaveBeenCalledOnce();
    expect(transportHarness.openTransport).toHaveBeenCalledOnce();
    expect(transportHarness.openTransport).toHaveBeenCalledWith(SESSION);
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
    expect(sender.replaceTrack).toHaveBeenCalledWith(audioTrack);

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
    expect(transportHarness.openTransport).toHaveBeenCalledOnce();
    expect(channel.close).not.toHaveBeenCalled();
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
