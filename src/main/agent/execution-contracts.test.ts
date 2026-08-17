import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DesktopCommandSchema,
  DesktopObservationSchema,
  mapNormalizedPointToScreenshot,
  mapScreenshotPointToDesktop,
} from './execution-contracts';

const coordinateSpace = {
  screenHeight: 1_117,
  screenWidth: 1_728,
  screenshotHeight: 2_234,
  screenshotWidth: 3_456,
};

describe('desktop execution contracts', () => {
  it('maps Retina screenshot pixels only for the Electron overlay', () => {
    expect(
      mapScreenshotPointToDesktop({ x: 1_980, y: 1_428 }, coordinateSpace),
    ).toEqual({ x: 990, y: 714 });
  });

  it('maps model-normalized coordinates into CUA screenshot pixels', () => {
    expect(
      mapNormalizedPointToScreenshot({ x: 580, y: 150 }, coordinateSpace),
    ).toEqual({ x: 2_004, y: 335 });
  });

  it('parses bounded observations without exposing them through task snapshots', () => {
    expect(
      DesktopObservationSchema.parse({
        observationId: randomUUID(),
        taskId: randomUUID(),
        capturedAt: '2026-08-17T00:00:00.000Z',
        text: 'A browser is visible.',
        degraded: false,
        fingerprint: 'a'.repeat(64),
        coordinateSpace,
        screenshot: { mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
      }),
    ).toMatchObject({ text: 'A browser is visible.' });
  });

  it('rejects insecure navigation and oversized coordinates', () => {
    expect(
      DesktopCommandSchema.safeParse({
        kind: 'open_url',
        url: 'http://example.com/',
      }).success,
    ).toBe(false);
    expect(
      DesktopCommandSchema.safeParse({
        kind: 'click',
        x: 100_001,
        y: 4,
      }).success,
    ).toBe(false);
  });
});
