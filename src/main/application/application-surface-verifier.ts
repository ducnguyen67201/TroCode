import { randomUUID } from 'node:crypto';

import type { OutcomeEvidence } from '../../shared/contracts';
import type {
  VisibleApplicationSurface,
} from '../cua/cua-semantic-contracts';

import type { ApplicationLaunchReceipt } from './desktop-application-launcher';

export interface ApplicationSurfaceVerification {
  status: 'confirmed' | 'unknown';
  summary: string;
  evidence?: OutcomeEvidence;
}

export interface ApplicationSurfaceVerifierOptions {
  intervalMs?: number;
  now?: () => Date;
  queryVisibleApplicationSurfaces(
    application: ApplicationLaunchReceipt['application'],
    signal?: AbortSignal,
  ): Promise<VisibleApplicationSurface[]>;
  timeoutMs?: number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

function abortError(): Error {
  const error = new Error('Application-surface verification was cancelled.');
  error.name = 'AbortError';
  return error;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export class ApplicationSurfaceVerifier {
  private readonly intervalMs: number;
  private readonly now: () => Date;
  private readonly query: ApplicationSurfaceVerifierOptions['queryVisibleApplicationSurfaces'];
  private readonly timeoutMs: number;
  private readonly wait: NonNullable<ApplicationSurfaceVerifierOptions['wait']>;

  constructor(options: ApplicationSurfaceVerifierOptions) {
    this.intervalMs = Math.max(50, Math.min(options.intervalMs ?? 250, 1_000));
    this.now = options.now ?? (() => new Date());
    this.query = options.queryVisibleApplicationSurfaces;
    this.timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 10_000, 10_000));
    this.wait = options.wait ?? defaultWait;
  }

  async verify(
    taskId: string,
    criterionId: string,
    receipt: ApplicationLaunchReceipt,
    signal: AbortSignal,
  ): Promise<ApplicationSurfaceVerification> {
    const deadline = this.now().getTime() + this.timeoutMs;
    let ambiguous = false;
    while (this.now().getTime() <= deadline) {
      if (signal.aborted) throw abortError();
      let surfaces: VisibleApplicationSurface[];
      try {
        surfaces = await this.query(receipt.application, signal);
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw error;
        }
        return {
          status: 'unknown',
          summary: 'The launch was accepted, but trusted application-surface verification was unavailable.',
        };
      }
      if (surfaces.length === 1) {
        const surface = surfaces[0];
        if (!surface) continue;
        return {
          status: 'confirmed',
          summary: 'A fresh trusted observation confirmed one visible Chrome surface.',
          evidence: {
            id: randomUUID(),
            runId: taskId,
            criterionId,
            source: 'fresh_observation',
            status: 'supports',
            observationId: surface.observationId,
            observationFingerprint: surface.observationFingerprint,
            summary: 'Trusted CUA application identity matched one visible Chrome surface.',
            createdAt: surface.observedAt,
          },
        };
      }
      ambiguous ||= surfaces.length > 1;
      if (this.now().getTime() >= deadline) break;
      await this.wait(
        Math.min(this.intervalMs, deadline - this.now().getTime()),
        signal,
      );
    }
    return {
      status: 'unknown',
      summary: ambiguous
        ? 'The launch was accepted, but multiple Chrome surfaces made verification ambiguous.'
        : 'The launch was accepted, but no visible Chrome surface was observed before the verification deadline.',
    };
  }
}
