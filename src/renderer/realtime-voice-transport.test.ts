import { describe, expect, it, vi } from 'vitest';

import type { VoiceSession } from '../shared/contracts';

import {
  closeRealtimeVoiceTransport,
  isRealtimeVoiceTransportReady,
  openRealtimeVoiceTransport,
} from './realtime-voice-transport';

const SESSION: VoiceSession = {
  clientSecret: 'ek_test_secret',
  expiresAt: 2_000_000_000,
  model: 'gpt-4o-mini-transcribe',
};

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

  readonly replaceTrack = vi.fn(async () => undefined);

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

describe('realtime voice transport', () => {
  it('preconnects an audio sender without attaching a microphone track', async () => {
    const connection = new FakePeerConnection();
    const diagnosticLogger = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init).toMatchObject({
        body: 'test-offer-sdp',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ek_test_secret',
          'Content-Type': 'application/sdp',
        },
      });
      return new Response('test-answer-sdp');
    });

    const transport = await openRealtimeVoiceTransport(SESSION, {
      createPeerConnection: () =>
        connection as unknown as RTCPeerConnection,
      diagnosticLogger,
      fetchImpl,
    });

    expect(connection.order).toEqual([
      'create-data-channel',
      'add-transceiver',
      'create-offer',
      'set-local-description',
      'set-remote-description',
    ]);
    expect(connection.replaceTrack).not.toHaveBeenCalled();
    expect(isRealtimeVoiceTransportReady(transport)).toBe(true);
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
        ok: true,
        status: 200,
      },
    );
  });

  it('closes the prepared transport when OpenAI rejects the SDP offer', async () => {
    const connection = new FakePeerConnection();

    await expect(
      openRealtimeVoiceTransport(SESSION, {
        createPeerConnection: () =>
          connection as unknown as RTCPeerConnection,
        fetchImpl: vi.fn<typeof fetch>(async () =>
          new Response('rejected', { status: 401 }),
        ),
      }),
    ).rejects.toThrow('OpenAI rejected the realtime voice connection.');

    expect(connection.connectionState).toBe('closed');
    expect(connection.channel.readyState).toBe('closed');
  });

  it('logs a sanitized renderer fetch failure before closing the transport', async () => {
    const connection = new FakePeerConnection();
    const diagnosticLogger = vi.fn();

    await expect(
      openRealtimeVoiceTransport(SESSION, {
        createPeerConnection: () =>
          connection as unknown as RTCPeerConnection,
        diagnosticLogger,
        fetchImpl: vi.fn<typeof fetch>(async () => {
          throw new TypeError('Failed to fetch');
        }),
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
    const transport = await openRealtimeVoiceTransport(SESSION, {
      createPeerConnection: () =>
        connection as unknown as RTCPeerConnection,
      fetchImpl: vi.fn<typeof fetch>(async () => new Response('answer')),
    });

    closeRealtimeVoiceTransport(transport);

    expect(isRealtimeVoiceTransportReady(transport)).toBe(false);
  });
});
