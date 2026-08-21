import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { ApplicationSurfaceVerifier } from './application-surface-verifier';

function surface() {
  return {
    application: 'chrome' as const,
    observationId: randomUUID(),
    observationFingerprint: 'a'.repeat(64),
    observedAt: '2026-08-20T00:00:00.000Z',
  };
}

function receipt() {
  return {
    application: 'chrome' as const,
    acceptedAt: '2026-08-20T00:00:00.000Z',
    receipt: randomUUID(),
  };
}

function timedVerifier(query: () => Promise<ReturnType<typeof surface>[]>) {
  let time = 0;
  return new ApplicationSurfaceVerifier({
    intervalMs: 50,
    timeoutMs: 250,
    now: () => new Date(time),
    queryVisibleApplicationSurfaces: query,
    wait: async (milliseconds, signal) => {
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      time += milliseconds;
    },
  });
}

describe('ApplicationSurfaceVerifier', () => {
  it('confirms only after one trusted visible surface is observed', async () => {
    const visible = surface();
    const query = vi
      .fn<() => Promise<ReturnType<typeof surface>[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([visible]);
    const result = await timedVerifier(query).verify(
      randomUUID(),
      'chrome-surface-visible',
      receipt(),
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      status: 'confirmed',
      evidence: {
        source: 'fresh_observation',
        observationId: visible.observationId,
      },
    });
  });

  it('returns unknown when no surface appears before the deadline', async () => {
    const result = await timedVerifier(async () => []).verify(
      randomUUID(),
      'chrome-surface-visible',
      receipt(),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ status: 'unknown' });
    expect(result.summary).toContain('no visible Chrome surface');
  });

  it('returns unknown when matching surfaces remain ambiguous', async () => {
    const result = await timedVerifier(async () => [surface(), surface()]).verify(
      randomUUID(),
      'chrome-surface-visible',
      receipt(),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ status: 'unknown' });
    expect(result.summary).toContain('multiple Chrome surfaces');
  });

  it('honors cancellation before polling', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      timedVerifier(async () => []).verify(
        randomUUID(),
        'chrome-surface-visible',
        receipt(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
