import { describe, expect, it, vi } from 'vitest';

import {
  closeRealtimeVoiceTransport,
  isRealtimeVoiceTransportReady,
  openRealtimeVoiceTransport,
  readOutboundAudioStats,
} from './realtime-voice-transport';

class FakeDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting';

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }

  open(): void {
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }
}

class FakePeerConnection extends EventTarget {
  readonly channel = new FakeDataChannel();

  connectionState: RTCPeerConnectionState = 'new';

  readonly order: string[] = [];

  senderTrack: MediaStreamTrack | null = null;

  senderStreams: MediaStream[] = [];

  readonly replaceTrack = vi.fn(async () => undefined);

  addTrack(
    track: MediaStreamTrack,
    ...streams: MediaStream[]
  ): RTCRtpSender {
    this.order.push('add-track');
    this.senderTrack = track;
    this.senderStreams = streams;
    return { replaceTrack: this.replaceTrack } as unknown as RTCRtpSender;
  }

  addTransceiver(): RTCRtpTransceiver {
    this.order.push('add-transceiver');
    return {
      sender: { replaceTrack: this.replaceTrack },
    } as unknown as RTCRtpTransceiver;
  }

  close(): void {
    this.order.push('close');
    this.connectionState = 'closed';
  }

  createDataChannel(): RTCDataChannel {
    this.order.push('create-data-channel');
    return this.channel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.order.push('create-offer');
    return { type: 'offer', sdp: 'test-offer-sdp' };
  }

  async setLocalDescription(): Promise<void> {
    this.order.push('set-local-description');
  }

  async setRemoteDescription(): Promise<void> {
    this.order.push('set-remote-description');
    this.connectionState = 'connected';
    this.channel.open();
  }
}

function createPlaceholderAudio() {
  const track = { kind: 'audio' } as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return {
    release: vi.fn(),
    stream,
    track,
  };
}

describe('realtime voice transport', () => {
  it('preconnects a live silent sender without attaching the microphone', async () => {
    const connection = new FakePeerConnection();
    const diagnosticLogger = vi.fn();
    const placeholderAudio = createPlaceholderAudio();
    const createVoiceCall = vi.fn(async (request) => {
      expect(request).toEqual({ offerSdp: 'test-offer-sdp' });
      return { answerSdp: 'test-answer-sdp' };
    });

    const transport = await openRealtimeVoiceTransport({
      createPlaceholderAudio: () => placeholderAudio,
      createVoiceCall,
      createPeerConnection: () =>
        connection as unknown as RTCPeerConnection,
      diagnosticLogger,
    });

    expect(connection.order).toEqual([
      'create-data-channel',
      'add-track',
      'create-offer',
      'set-local-description',
      'set-remote-description',
    ]);
    expect(connection.senderTrack).toBe(placeholderAudio.track);
    expect(connection.senderStreams).toEqual([placeholderAudio.stream]);
    expect(connection.replaceTrack).not.toHaveBeenCalled();
    expect(isRealtimeVoiceTransportReady(transport)).toBe(true);
    expect(diagnosticLogger).toHaveBeenCalledWith('transport.create', {
      audioTrackAttached: false,
      placeholderAudioAttached: true,
    });
    expect(diagnosticLogger.mock.calls.map(([event]) => event)).toEqual([
      'transport.create',
      'transport.offer-created',
      'transport.local-description-set',
      'transport.call-start',
      'transport.call-response',
      'transport.remote-description-set',
      'transport.ready',
    ]);
    expect(diagnosticLogger).toHaveBeenCalledWith(
      'transport.call-response',
      {
        answerLength: 15,
      },
    );
  });

  it('negotiates a supplied microphone track in the initial SDP offer', async () => {
    const connection = new FakePeerConnection();
    const diagnosticLogger = vi.fn();
    const microphoneTrack = { kind: 'audio' } as MediaStreamTrack;

    await openRealtimeVoiceTransport({
      audioTrack: microphoneTrack,
      createVoiceCall: vi.fn(async () => ({ answerSdp: 'answer' })),
      createPeerConnection: () =>
        connection as unknown as RTCPeerConnection,
      diagnosticLogger,
    });

    expect(connection.senderTrack).toBe(microphoneTrack);
    expect(connection.order).toEqual([
      'create-data-channel',
      'add-track',
      'create-offer',
      'set-local-description',
      'set-remote-description',
    ]);
    expect(diagnosticLogger).toHaveBeenCalledWith('transport.create', {
      audioTrackAttached: true,
      placeholderAudioAttached: false,
    });
  });

  it('reports outbound audio packets and bytes for commit diagnostics', async () => {
    const sender = {
      getStats: vi.fn(async () => ({
        forEach: (callback: (stats: RTCStats) => void): void => {
          callback({
            bytesSent: 4_096,
            id: 'audio-outbound',
            kind: 'audio',
            packetsSent: 12,
            ssrc: 1,
            timestamp: 1_000,
            type: 'outbound-rtp',
          } as RTCOutboundRtpStreamStats);
          callback({
            bytesSent: 1_024,
            id: 'legacy-audio-outbound',
            mediaType: 'audio',
            packetsSent: 4,
            ssrc: 3,
            timestamp: 1_000,
            type: 'outbound-rtp',
          } as unknown as RTCStats);
          callback({
            bytesSent: 8_192,
            id: 'video-outbound',
            kind: 'video',
            packetsSent: 24,
            ssrc: 2,
            timestamp: 1_000,
            type: 'outbound-rtp',
          } as RTCOutboundRtpStreamStats);
        },
      })),
    } as unknown as RTCRtpSender;

    await expect(readOutboundAudioStats(sender)).resolves.toEqual({
      bytesSent: 5_120,
      packetsSent: 16,
    });
  });

  it('closes the prepared transport when the main-process call fails', async () => {
    const connection = new FakePeerConnection();
    const placeholderAudio = createPlaceholderAudio();

    await expect(
      openRealtimeVoiceTransport({
        createPlaceholderAudio: () => placeholderAudio,
        createVoiceCall: vi.fn(async () => {
          throw new Error('OpenAI rejected the realtime voice connection.');
        }),
        createPeerConnection: () =>
          connection as unknown as RTCPeerConnection,
      }),
    ).rejects.toThrow('OpenAI rejected the realtime voice connection.');

    expect(connection.connectionState).toBe('closed');
    expect(connection.channel.readyState).toBe('closed');
    expect(placeholderAudio.release).toHaveBeenCalledOnce();
  });

  it('logs a sanitized main-process call failure before closing the transport', async () => {
    const connection = new FakePeerConnection();
    const diagnosticLogger = vi.fn();
    const placeholderAudio = createPlaceholderAudio();

    await expect(
      openRealtimeVoiceTransport({
        createPlaceholderAudio: () => placeholderAudio,
        createVoiceCall: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
        createPeerConnection: () =>
          connection as unknown as RTCPeerConnection,
        diagnosticLogger,
      }),
    ).rejects.toThrow('Failed to fetch');

    expect(diagnosticLogger).toHaveBeenLastCalledWith(
      'transport.failed',
      {
        channelState: 'connecting',
        connectionState: 'new',
        errorMessage: 'Failed to fetch',
        errorName: 'TypeError',
      },
    );
    expect(connection.connectionState).toBe('closed');
  });

  it('closes an established transport explicitly', async () => {
    const connection = new FakePeerConnection();
    const placeholderAudio = createPlaceholderAudio();
    const transport = await openRealtimeVoiceTransport({
      createPlaceholderAudio: () => placeholderAudio,
      createVoiceCall: vi.fn(async () => ({ answerSdp: 'answer' })),
      createPeerConnection: () =>
        connection as unknown as RTCPeerConnection,
    });

    closeRealtimeVoiceTransport(transport);
    closeRealtimeVoiceTransport(transport);

    expect(isRealtimeVoiceTransportReady(transport)).toBe(false);
    expect(placeholderAudio.release).toHaveBeenCalledOnce();
  });
});
