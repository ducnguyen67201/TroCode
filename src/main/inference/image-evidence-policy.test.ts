import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { EvidenceImage } from './image-evidence-policy';
import { ImageEvidencePolicy } from './image-evidence-policy';

class FakeImage implements EvidenceImage {
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  crop(rectangle: { height: number; width: number }): EvidenceImage {
    return new FakeImage(rectangle.width, rectangle.height);
  }

  getSize(): { height: number; width: number } {
    return { height: this.height, width: this.width };
  }

  resize(options: { height?: number; width?: number }): EvidenceImage {
    return new FakeImage(options.width ?? this.width, options.height ?? this.height);
  }

  toJPEG(): Buffer {
    return Buffer.from('jpeg');
  }
}

function observation(taskId: string, observationId: string) {
  return {
    capturedAt: '2026-08-20T00:00:00.000Z',
    degraded: false,
    fingerprint: 'a'.repeat(64),
    observationId,
    route: 'desktop_vision' as const,
    screenshot: { dataBase64: Buffer.from('original').toString('base64'), mimeType: 'image/png' },
    taskId,
    text: 'screen',
  };
}

describe('ImageEvidencePolicy', () => {
  it('retains one original, returns a bounded overview, and clamps a crop', () => {
    const policy = new ImageEvidencePolicy({ create: () => new FakeImage(4_000, 2_000) });
    const taskId = randomUUID();
    const observationId = randomUUID();
    const prepared = policy.prepare(taskId, observation(taskId, observationId));
    expect(prepared.screenshot?.mimeType).toBe('image/jpeg');
    const crop = policy.inspect(taskId, observationId, {
      x: 750, y: 500, width: 250, height: 500,
    });
    expect(crop.width).toBe(1_000);
    expect(crop.height).toBe(1_000);
    expect(crop.dataUrl).toMatch(/^data:image\/jpeg;base64,/u);
  });

  it('invalidates old crop authority on a new observation and cleanup', () => {
    const policy = new ImageEvidencePolicy({ create: () => new FakeImage(1_000, 1_000) });
    const taskId = randomUUID();
    const first = randomUUID();
    policy.prepare(taskId, observation(taskId, first));
    policy.prepare(taskId, observation(taskId, randomUUID()));
    expect(() => policy.inspect(taskId, first, { x: 0, y: 0, width: 100, height: 100 })).toThrow(/expired/u);
    policy.clear(taskId);
    expect(() => policy.inspect(taskId, randomUUID(), { x: 0, y: 0, width: 100, height: 100 })).toThrow(/expired/u);
  });

  it('bounds unusually tall overview images by total pixels', () => {
    const policy = new ImageEvidencePolicy({ create: () => new FakeImage(1_000, 10_000) });
    const taskId = randomUUID();
    const prepared = policy.prepare(
      taskId,
      observation(taskId, randomUUID()),
    );
    expect(prepared.screenshot?.mimeType).toBe('image/jpeg');
    expect(prepared.screenshot?.dataBase64).toBe(Buffer.from('jpeg').toString('base64'));
  });
});
