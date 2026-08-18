import { randomUUID } from 'node:crypto';

import {
  CompanionSpeechPlaybackReportSchema,
  CompanionSpeechSchema,
  TROCODE_AUDIO_SCHEME,
  type CompanionSpeech,
  type CompanionSpeechPlaybackReport,
} from '../../shared/contracts';

import type {
  ElevenLabsTtsService,
  SynthesizedSpeechStream,
} from './elevenlabs-tts-service';

const DEFAULT_TICKET_TTL_MS = 10_000;
const DEFAULT_COMPLETION_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_ACTIVE_TICKETS = 16;

export interface NarrationOutcome {
  phase: 'ended' | 'failed';
  reason?: CompanionSpeechPlaybackReport['reason'] | 'cancelled' | 'timeout';
  source: CompanionSpeechPlaybackReport['source'];
}

export interface NarrationHandle {
  cancel(): void;
  completion: Promise<NarrationOutcome>;
  descriptor: CompanionSpeech;
  id: string;
}

interface Ticket {
  consumed: boolean;
  createdAt: number;
  expiresAt: number;
  text: string;
}

interface ActiveNarration {
  characterCount: number;
  controller: AbortController;
  createdAt: number;
  descriptor: CompanionSpeech;
  providers: Set<AbortController>;
  resolve(outcome: NarrationOutcome): void;
  settled: boolean;
  taskId?: string;
  watchdog: ReturnType<typeof setTimeout>;
}

interface CompanionNarrationServiceOptions {
  completionTimeoutMs?: number;
  logger?: Pick<Console, 'info' | 'warn'>;
  maxActiveTickets?: number;
  now?: () => number;
  publish(speech: CompanionSpeech | null): void;
  ticketTtlMs?: number;
  ttsService: Pick<ElevenLabsTtsService, 'isConfigured' | 'stream'>;
  uuid?: () => string;
}

export class CompanionNarrationService {
  private readonly active = new Map<string, ActiveNarration>();

  private currentId: string | null = null;

  private readonly completionTimeoutMs: number;

  private readonly logger: Pick<Console, 'info' | 'warn'>;

  private readonly maxActiveTickets: number;

  private readonly now: () => number;

  private readonly publish: (speech: CompanionSpeech | null) => void;

  private readonly ticketTtlMs: number;

  private readonly tickets = new Map<string, Ticket>();

  private readonly ttsService: Pick<
    ElevenLabsTtsService,
    'isConfigured' | 'stream'
  >;

  private readonly uuid: () => string;

  constructor({
    completionTimeoutMs = DEFAULT_COMPLETION_TIMEOUT_MS,
    logger = console,
    maxActiveTickets = DEFAULT_MAX_ACTIVE_TICKETS,
    now = Date.now,
    publish,
    ticketTtlMs = DEFAULT_TICKET_TTL_MS,
    ttsService,
    uuid = randomUUID,
  }: CompanionNarrationServiceOptions) {
    this.completionTimeoutMs = completionTimeoutMs;
    this.logger = logger;
    this.maxActiveTickets = maxActiveTickets;
    this.now = now;
    this.publish = publish;
    this.ticketTtlMs = ticketTtlMs;
    this.ttsService = ttsService;
    this.uuid = uuid;
  }

  begin(
    rawText: string,
    taskSignal?: AbortSignal,
    taskId?: string,
  ): NarrationHandle {
    const text = rawText.trim();
    if (!text || text.length > 240) {
      throw new Error('Narration text must contain 1 to 240 characters.');
    }
    if (taskSignal?.aborted) throw abortError();

    if (this.currentId) this.cancel(this.currentId);
    this.evictExpiredTickets();
    while (this.tickets.size >= this.maxActiveTickets) {
      const oldest = this.tickets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cancel(oldest);
    }

    const id = this.uuid();
    const configured = this.ttsService.isConfigured();
    const descriptor = CompanionSpeechSchema.parse(
      configured
        ? {
            id,
            mediaUrl: `${TROCODE_AUDIO_SCHEME}://speech/${id}`,
            mimeType: 'audio/mpeg',
            source: 'elevenlabs',
            text,
          }
        : { id, source: 'system', text },
    );
    let resolveCompletion: (outcome: NarrationOutcome) => void = () => undefined;
    const completion = new Promise<NarrationOutcome>((resolve) => {
      resolveCompletion = resolve;
    });
    const controller = new AbortController();
    const startedAt = this.now();
    const active: ActiveNarration = {
      characterCount: text.length,
      controller,
      createdAt: startedAt,
      descriptor,
      providers: new Set(),
      resolve: resolveCompletion,
      settled: false,
      taskId,
      watchdog: setTimeout(() => {
        this.settle(id, {
          phase: 'failed',
          reason: 'timeout',
          source: descriptor.source,
        });
      }, this.completionTimeoutMs),
    };
    this.active.set(id, active);
    this.currentId = id;
    if (configured) {
      this.tickets.set(id, {
        consumed: false,
        createdAt: startedAt,
        expiresAt: startedAt + this.ticketTtlMs,
        text,
      });
    }

    const handleTaskAbort = (): void => this.cancel(id);
    taskSignal?.addEventListener('abort', handleTaskAbort, { once: true });
    void completion.finally(() =>
      taskSignal?.removeEventListener('abort', handleTaskAbort),
    );

    this.logger.info('[voice:tts] stream.requested', {
      characterCount: text.length,
      mode: configured ? 'elevenlabs' : 'system',
      speechId: id,
      ...(taskId ? { taskId } : {}),
    });
    this.publish(descriptor);

    return {
      cancel: () => this.cancel(id),
      completion,
      descriptor,
      id,
    };
  }

  async handleRequest(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return responseWithStatus(405);
    }
    const id = speechIdFromUrl(request.url);
    if (!id) return responseWithStatus(404);
    const ticket = this.tickets.get(id);
    const active = this.active.get(id);
    if (!ticket || !active || ticket.expiresAt <= this.now()) {
      if (ticket?.expiresAt && ticket.expiresAt <= this.now()) {
        this.tickets.delete(id);
      }
      return responseWithStatus(404);
    }
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: audioHeaders() });
    }
    if (ticket.consumed) return responseWithStatus(410);
    ticket.consumed = true;

    const providerController = new AbortController();
    active.providers.add(providerController);
    const unlink = linkAbortSignals(
      [active.controller.signal, request.signal],
      providerController,
    );
    try {
      const startedAt = this.now();
      const stream = await this.ttsService.stream(
        ticket.text,
        providerController.signal,
      );
      this.tickets.delete(id);
      if (!stream) return responseWithStatus(503);
      this.logger.info('[voice:tts] stream.headers', {
        durationMs: this.now() - startedAt,
        providerStatus: stream.providerStatus,
        speechId: id,
        ...(stream.region ? { region: stream.region } : {}),
        ...(active.taskId ? { taskId: active.taskId } : {}),
      });
      return new Response(
        finalizeProviderStream(stream, () => {
          unlink();
          active.providers.delete(providerController);
        }),
        { status: 200, headers: audioHeaders() },
      );
    } catch (error) {
      unlink();
      active.providers.delete(providerController);
      this.tickets.delete(id);
      if (!active.controller.signal.aborted) {
        this.logger.warn('[voice:tts] stream unavailable', {
          reason: fixedProviderReason(error),
          speechId: id,
          ...(active.taskId ? { taskId: active.taskId } : {}),
        });
      }
      return responseWithStatus(502);
    }
  }

  report(rawReport: CompanionSpeechPlaybackReport): void {
    const report = CompanionSpeechPlaybackReportSchema.parse(rawReport);
    const active = this.active.get(report.id);
    if (!active || active.settled || this.currentId !== report.id) return;
    const timing = {
      durationMs: this.now() - active.createdAt,
      source: report.source,
      speechId: report.id,
      ...(active.taskId ? { taskId: active.taskId } : {}),
    };
    if (report.phase === 'playing') {
      this.logger.info('[voice:tts] playback.started', timing);
      return;
    }
    if (report.phase === 'fallback_started') {
      for (const provider of active.providers) provider.abort('fallback-started');
      this.logger.info('[voice:tts] fallback.started', {
        ...timing,
        reason: report.reason ?? 'provider_error',
      });
      return;
    }
    this.logger.info(
      report.phase === 'ended'
        ? '[voice:tts] playback.ended'
        : '[voice:tts] playback.failed',
      { ...timing, ...(report.reason ? { reason: report.reason } : {}) },
    );
    this.settle(report.id, {
      phase: report.phase,
      ...(report.reason ? { reason: report.reason } : {}),
      source: report.source,
    });
  }

  cancel(id: string): void {
    const active = this.active.get(id);
    if (!active || active.settled) return;
    this.logger.info('[voice:tts] playback.cancelled', {
      durationMs: this.now() - active.createdAt,
      speechId: id,
      ...(active.taskId ? { taskId: active.taskId } : {}),
    });
    this.settle(id, {
      phase: 'failed',
      reason: 'cancelled',
      source: active.descriptor.source,
    });
  }

  cancelCurrent(): void {
    if (this.currentId) this.cancel(this.currentId);
  }

  shutdown(): void {
    for (const id of [...this.active.keys()]) this.cancel(id);
    this.tickets.clear();
    this.currentId = null;
    this.publish(null);
  }

  private evictExpiredTickets(): void {
    const now = this.now();
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(id);
    }
  }

  private settle(id: string, outcome: NarrationOutcome): void {
    const active = this.active.get(id);
    if (!active || active.settled) return;
    active.settled = true;
    clearTimeout(active.watchdog);
    active.controller.abort(outcome.reason);
    for (const provider of active.providers) provider.abort(outcome.reason);
    active.providers.clear();
    this.tickets.delete(id);
    this.active.delete(id);
    if (this.currentId === id) {
      this.currentId = null;
      this.publish(null);
    }
    active.resolve(outcome);
  }
}

function abortError(): Error {
  const error = new Error('Narration was cancelled.');
  error.name = 'AbortError';
  return error;
}

function speechIdFromUrl(rawUrl: string): string | null {
  try {
    const descriptor = CompanionSpeechSchema.parse({
      id: new URL(rawUrl).pathname.slice(1),
      mediaUrl: rawUrl,
      mimeType: 'audio/mpeg',
      source: 'elevenlabs',
      text: 'private speech ticket',
    });
    return descriptor.id;
  } catch {
    return null;
  }
}

function audioHeaders(): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'audio/mpeg',
    'X-Content-Type-Options': 'nosniff',
  };
}

function responseWithStatus(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

function linkAbortSignals(
  signals: AbortSignal[],
  controller: AbortController,
): () => void {
  const listeners = signals.map((signal) => {
    const listener = (): void => controller.abort(signal.reason);
    if (signal.aborted) listener();
    else signal.addEventListener('abort', listener, { once: true });
    return { listener, signal };
  });
  return () => {
    for (const { listener, signal } of listeners) {
      signal.removeEventListener('abort', listener);
    }
  };
}

function finalizeProviderStream(
  stream: SynthesizedSpeechStream,
  finalize: () => void,
): ReadableStream<Uint8Array> {
  const reader = stream.body.getReader();
  let finalized = false;
  const finish = (): void => {
    if (finalized) return;
    finalized = true;
    finalize();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
}

function fixedProviderReason(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return 'provider_error';
}
