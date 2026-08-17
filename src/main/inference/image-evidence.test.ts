import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { resizeObservationForModel } from './image-evidence';

describe('resizeObservationForModel', () => {
  it('converts wide evidence to bounded JPEG without changing host coordinates', () => {
    const toJPEG = vi.fn(() => Buffer.from('small'));
    const result = resizeObservationForModel(
      {
        capturedAt: '2026-08-17T00:00:00.000Z',
        coordinateSpace: {
          screenHeight: 1_000,
          screenWidth: 2_000,
          screenshotHeight: 2_000,
          screenshotWidth: 4_000,
        },
        degraded: false,
        fingerprint: 'a'.repeat(64),
        observationId: randomUUID(),
        screenshot: { dataBase64: Buffer.from('large').toString('base64'), mimeType: 'image/png' },
        taskId: randomUUID(),
        text: 'desktop',
      },
      {
        create: () => ({
          getSize: () => ({ height: 2_000, width: 4_000 }),
          resize: ({ width }) => {
            expect(width).toBe(1_536);
            return { toJPEG };
          },
        }),
      },
    );
    expect(result.screenshot?.mimeType).toBe('image/jpeg');
    expect(result.coordinateSpace?.screenshotWidth).toBe(4_000);
    expect(toJPEG).toHaveBeenCalledWith(72);
  });
});
