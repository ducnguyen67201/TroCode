import {
  closeRealtimeVoiceTransport,
  isRealtimeVoiceTransportReady,
  openRealtimeVoiceTransport,
  type RealtimeVoiceTransport,
} from './realtime-voice-transport';

interface WarmRealtimeVoiceTransportDependencies {
  closeTransport?(transport: RealtimeVoiceTransport): void;
  isTransportReady?(transport: RealtimeVoiceTransport | null): boolean;
  onWarmFailure?(error: unknown): void;
  openTransport?(): Promise<RealtimeVoiceTransport>;
}

class WarmTransportStoppedError extends Error {
  constructor() {
    super('The warm voice transport was stopped.');
    this.name = 'WarmTransportStoppedError';
  }
}

/**
 * Maintains one microphone-free Realtime transport outside the hotkey path.
 * A transport is consumed by one voice turn and explicitly replenished while
 * that turn is being committed, avoiding cross-turn session state.
 */
export class WarmRealtimeVoiceTransport {
  private readonly closeTransport: (
    transport: RealtimeVoiceTransport,
  ) => void;

  private readonly isTransportReady: (
    transport: RealtimeVoiceTransport | null,
  ) => boolean;

  private readonly onWarmFailure: (error: unknown) => void;

  private readonly openTransport: () => Promise<RealtimeVoiceTransport>;

  private enabled = false;

  private generation = 0;

  private pending: Promise<RealtimeVoiceTransport> | null = null;

  private ready: RealtimeVoiceTransport | null = null;

  constructor({
    closeTransport = closeRealtimeVoiceTransport,
    isTransportReady = isRealtimeVoiceTransportReady,
    onWarmFailure = () => undefined,
    openTransport = () => openRealtimeVoiceTransport(),
  }: WarmRealtimeVoiceTransportDependencies = {}) {
    this.closeTransport = closeTransport;
    this.isTransportReady = isTransportReady;
    this.onWarmFailure = onWarmFailure;
    this.openTransport = openTransport;
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.replenish();
  }

  replenish(): void {
    if (
      !this.enabled ||
      this.pending ||
      this.isTransportReady(this.ready)
    ) {
      return;
    }

    if (this.ready) {
      const staleTransport = this.ready;
      this.ready = null;
      this.closeTransport(staleTransport);
    }

    void this.prepare().catch((error: unknown) => {
      if (error instanceof WarmTransportStoppedError) return;
      this.onWarmFailure(error);
    });
  }

  async take(): Promise<RealtimeVoiceTransport> {
    if (!this.enabled) {
      throw new Error('OpenAI voice is not ready.');
    }

    if (this.ready && this.isTransportReady(this.ready)) {
      const transport = this.ready;
      this.ready = null;
      return transport;
    }

    if (this.ready) {
      const staleTransport = this.ready;
      this.ready = null;
      this.closeTransport(staleTransport);
    }

    const transport = await (this.pending ?? this.prepare());
    if (!this.enabled || !this.isTransportReady(transport)) {
      if (this.ready === transport) this.ready = null;
      this.closeTransport(transport);
      throw new Error('OpenAI voice connection is not available.');
    }

    if (this.ready === transport) this.ready = null;
    return transport;
  }

  stop(): void {
    if (!this.enabled && !this.ready && !this.pending) return;
    this.enabled = false;
    this.generation += 1;
    this.pending = null;

    const transport = this.ready;
    this.ready = null;
    if (transport) this.closeTransport(transport);
  }

  private prepare(): Promise<RealtimeVoiceTransport> {
    if (!this.enabled) return Promise.reject(new WarmTransportStoppedError());
    if (this.pending) return this.pending;

    const generation = this.generation;
    const operation = this.openTransport().then((transport) => {
      if (!this.enabled || generation !== this.generation) {
        this.closeTransport(transport);
        throw new WarmTransportStoppedError();
      }

      if (!this.isTransportReady(transport)) {
        this.closeTransport(transport);
        throw new Error('OpenAI returned an unusable warm voice connection.');
      }

      this.ready = transport;
      this.monitorPreparedTransport(transport);
      return transport;
    });
    this.pending = operation;
    void operation.finally(() => {
      if (this.pending === operation) this.pending = null;
    }).catch(() => undefined);
    return operation;
  }

  private monitorPreparedTransport(transport: RealtimeVoiceTransport): void {
    const discardPreparedTransport = (): void => {
      if (this.ready !== transport) return;
      this.ready = null;
      this.closeTransport(transport);
      this.replenish();
    };
    const handleConnectionStateChange = (): void => {
      if (!this.isTransportReady(transport)) discardPreparedTransport();
    };

    transport.channel.addEventListener('close', discardPreparedTransport);
    transport.channel.addEventListener('error', discardPreparedTransport);
    transport.connection.addEventListener(
      'connectionstatechange',
      handleConnectionStateChange,
    );
  }
}
