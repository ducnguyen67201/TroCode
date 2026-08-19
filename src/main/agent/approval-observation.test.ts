import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  approvalObservationMatches,
  type DecodedDesktopImage,
} from './approval-observation';
import type { DesktopCommand, DesktopObservation } from './execution-contracts';

function observation(key: string, fingerprint: string): DesktopObservation {
  return {
    observationId: randomUUID(),
    taskId: randomUUID(),
    capturedAt: '2026-08-18T00:00:00.000Z',
    route: 'desktop_vision',
    text: 'A worksheet is visible.',
    degraded: false,
    fingerprint,
    coordinateSpace: {
      screenHeight: 100,
      screenWidth: 100,
      screenshotHeight: 100,
      screenshotWidth: 100,
    },
    screenshot: {
      mimeType: 'image/png',
      dataBase64: Buffer.from(key).toString('base64'),
    },
  };
}

function image(
  mutate?: (pixels: Uint8Array, width: number, height: number) => void,
): DecodedDesktopImage {
  const width = 100;
  const height = 100;
  const pixels = new Uint8Array(width * height * 4).fill(100);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  mutate?.(pixels, width, height);
  return { width, height, pixels };
}

function paint(
  pixels: Uint8Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 240;
      pixels[offset + 1] = 240;
      pixels[offset + 2] = 240;
    }
  }
}

const click: DesktopCommand = {
  kind: 'click',
  x: 80,
  y: 80,
  button: 'left',
  count: 1,
};

describe('approved desktop observation matching', () => {
  it('accepts an exact fingerprint without decoding screenshots', () => {
    expect(
      approvalObservationMatches(
        observation('before', 'a'.repeat(64)),
        observation('after', 'a'.repeat(64)),
        click,
        () => {
          throw new Error('Exact matches should not decode.');
        },
      ),
    ).toBe(true);
  });

  it('tolerates a small off-target caret or focus change', () => {
    const images = new Map<string, DecodedDesktopImage>([
      ['before', image()],
      [
        'after',
        image((pixels, width) => paint(pixels, width, 4, 4, 6, 14)),
      ],
    ]);

    expect(
      approvalObservationMatches(
        observation('before', 'a'.repeat(64)),
        observation('after', 'b'.repeat(64)),
        click,
        (data) => images.get(data.toString('utf8')),
      ),
    ).toBe(true);
  });

  it('rejects a broad screen change', () => {
    const images = new Map<string, DecodedDesktopImage>([
      ['before', image()],
      [
        'after',
        image((pixels, width) => paint(pixels, width, 0, 0, 100, 60)),
      ],
    ]);

    expect(
      approvalObservationMatches(
        observation('before', 'a'.repeat(64)),
        observation('after', 'b'.repeat(64)),
        click,
        (data) => images.get(data.toString('utf8')),
      ),
    ).toBe(false);
  });

  it('rejects changes that fall between a fixed sampling grid', () => {
    const sampledColumns = new Set(
      Array.from({ length: 80 }, (_, column) =>
        Math.round(((column + 0.5) / 80) * 99),
      ),
    );
    const images = new Map<string, DecodedDesktopImage>([
      ['before', image()],
      [
        'after',
        image((pixels, width, height) => {
          for (let x = 0; x < width; x += 1) {
            if (!sampledColumns.has(x)) {
              paint(pixels, width, x, 0, x + 1, height);
            }
          }
        }),
      ],
    ]);

    expect(
      approvalObservationMatches(
        observation('before', 'a'.repeat(64)),
        observation('after', 'b'.repeat(64)),
        { kind: 'type_text', text: 'Approved text' },
        (data) => images.get(data.toString('utf8')),
      ),
    ).toBe(false);
  });

  it('rejects a localized change at the approved click target', () => {
    const images = new Map<string, DecodedDesktopImage>([
      ['before', image()],
      [
        'after',
        image((pixels, width) => paint(pixels, width, 70, 70, 91, 91)),
      ],
    ]);

    expect(
      approvalObservationMatches(
        observation('before', 'a'.repeat(64)),
        observation('after', 'b'.repeat(64)),
        click,
        (data) => images.get(data.toString('utf8')),
      ),
    ).toBe(false);
  });
});
