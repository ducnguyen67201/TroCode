import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DesktopCommandSchema,
  DesktopObservationSchema,
  mapNormalizedRegionToScreenshot,
  mapNormalizedPointToScreenshot,
  mapScreenshotRegionToDesktop,
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

  it('maps a normalized target region through screenshot and desktop spaces', () => {
    const screenshotRegion = mapNormalizedRegionToScreenshot(
      { x: 250, y: 100, width: 500, height: 300 },
      coordinateSpace,
    );

    expect(screenshotRegion).toEqual({
      x: 864,
      y: 223,
      width: 1_728,
      height: 670,
    });
    expect(
      mapScreenshotRegionToDesktop(screenshotRegion, coordinateSpace),
    ).toEqual({ x: 432, y: 112, width: 864, height: 335 });
  });

  it('preserves a bounded visible region at the normalized screen edge', () => {
    expect(
      mapNormalizedRegionToScreenshot(
        { x: 999, y: 999, width: 1, height: 1 },
        coordinateSpace,
      ),
    ).toEqual({ x: 3_453, y: 2_232, width: 3, height: 2 });
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
