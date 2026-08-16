import { describe, expect, it, vi } from 'vitest';

import type { RealtimeVoiceTransport } from './realtime-voice-transport';
import { WarmRealtimeVoiceTransport } from './warm-realtime-voice-transport';

function createTransport(): RealtimeVoiceTransport {
  return {
    channel: Object.assign(new EventTarget(), {
      readyState: 'open' as RTCDataChannelState,
    }) as RTCDataChannel,
    connection: Object.assign(new EventTarget(), {
      connectionState: 'connected' as RTCPeerConnectionState,
    }) as RTCPeerConnection,
    sender: {} as RTCRtpSender,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('warm realtime voice transport', () => {
  it('opens before the first take and hands off the prepared transport', async () => {
    const transport = createTransport();
    const openTransport = vi.fn(async () => transport);
    const manager = new WarmRealtimeVoiceTransport({ openTransport });

    manager.start();
    await flushMicrotasks();

    expect(openTransport).toHaveBeenCalledOnce();
    await expect(manager.take()).resolves.toBe(transport);
    expect(openTransport).toHaveBeenCalledOnce();
  });

  it('prepares the next transport after the current one is consumed', async () => {
    const first = createTransport();
    const second = createTransport();
    const openTransport = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const manager = new WarmRealtimeVoiceTransport({ openTransport });

    manager.start();
    await flushMicrotasks();
    await expect(manager.take()).resolves.toBe(first);

    manager.replenish();
    await flushMicrotasks();

    expect(openTransport).toHaveBeenCalledTimes(2);
    await expect(manager.take()).resolves.toBe(second);
  });

  it('replaces a prepared transport that fails while idle', async () => {
    const first = createTransport();
    const second = createTransport();
    const closeTransport = vi.fn();
    const openTransport = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const manager = new WarmRealtimeVoiceTransport({
      closeTransport,
      openTransport,
    });

    manager.start();
    await flushMicrotasks();
    Object.assign(first.connection, { connectionState: 'failed' });
    first.connection.dispatchEvent(new Event('connectionstatechange'));
    await flushMicrotasks();

    expect(closeTransport).toHaveBeenCalledWith(first);
    expect(openTransport).toHaveBeenCalledTimes(2);
    await expect(manager.take()).resolves.toBe(second);
  });

  it('retries on take after a background warm-up failure', async () => {
    const transport = createTransport();
    const warmFailure = new Error('temporary network failure');
    const onWarmFailure = vi.fn();
    const openTransport = vi
      .fn()
      .mockRejectedValueOnce(warmFailure)
      .mockResolvedValueOnce(transport);
    const manager = new WarmRealtimeVoiceTransport({
      onWarmFailure,
      openTransport,
    });

    manager.start();
    await flushMicrotasks();

    expect(onWarmFailure).toHaveBeenCalledWith(warmFailure);
    await expect(manager.take()).resolves.toBe(transport);
    expect(openTransport).toHaveBeenCalledTimes(2);
  });

  it('closes a prepared transport and any late connection after stop', async () => {
    const prepared = createTransport();
    const late = createTransport();
    const closeTransport = vi.fn();
    let resolveLate: (transport: RealtimeVoiceTransport) => void = () => undefined;
    const openTransport = vi
      .fn()
      .mockResolvedValueOnce(prepared)
      .mockImplementationOnce(
        () =>
          new Promise<RealtimeVoiceTransport>((resolve) => {
            resolveLate = resolve;
          }),
      );
    const manager = new WarmRealtimeVoiceTransport({
      closeTransport,
      openTransport,
    });

    manager.start();
    await flushMicrotasks();
    await manager.take();
    manager.replenish();
    manager.stop();
    resolveLate(late);
    await flushMicrotasks();

    expect(closeTransport).toHaveBeenCalledWith(late);
  });
});
