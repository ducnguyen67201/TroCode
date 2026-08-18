import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  TargetAwareDesktopStateValidator,
  type DesktopImage,
  type DesktopImageAdapter,
} from './desktop-state-validator';
import type {
  DesktopCommand,
  DesktopObservation,
} from './execution-contracts';

class RasterImage implements DesktopImage {
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly pixels: Uint8Array,
    private readonly invalidBitmap = false,
  ) {}

  crop(rectangle: { height: number; width: number; x: number; y: number }) {
    const cropped = new Uint8Array(rectangle.width * rectangle.height);
    for (let y = 0; y < rectangle.height; y += 1) {
      for (let x = 0; x < rectangle.width; x += 1) {
        cropped[y * rectangle.width + x] =
          this.pixels[(rectangle.y + y) * this.width + rectangle.x + x] ?? 0;
      }
    }
    return new RasterImage(
      rectangle.width,
      rectangle.height,
      cropped,
      this.invalidBitmap,
    );
  }

  getSize() {
    return { height: this.height, width: this.width };
  }

  resize(options: { height: number; width: number }) {
    const resized = new Uint8Array(options.width * options.height);
    for (let y = 0; y < options.height; y += 1) {
      for (let x = 0; x < options.width; x += 1) {
        const sourceX = Math.min(
          this.width - 1,
          Math.floor((x / options.width) * this.width),
        );
        const sourceY = Math.min(
          this.height - 1,
          Math.floor((y / options.height) * this.height),
        );
        resized[y * options.width + x] =
          this.pixels[sourceY * this.width + sourceX] ?? 0;
      }
    }
    return new RasterImage(
      options.width,
      options.height,
      resized,
      this.invalidBitmap,
    );
  }

  toBitmap(): Buffer {
    if (this.invalidBitmap) return Buffer.from([1, 2, 3, 4, 5]);
    const bitmap = Buffer.alloc(this.width * this.height * 4);
    this.pixels.forEach((value, index) => {
      const offset = index * 4;
      bitmap[offset] = value;
      bitmap[offset + 1] = value;
      bitmap[offset + 2] = value;
      bitmap[offset + 3] = 255;
    });
    return bitmap;
  }
}

class RasterAdapter implements DesktopImageAdapter {
  readonly create = vi.fn((data: Buffer): DesktopImage => {
    const image = this.images.get(data.toString('utf8'));
    if (!image) throw new Error('Fixture decode failed.');
    return image;
  });

  constructor(private readonly images: Map<string, DesktopImage>) {}
}

const WIDTH = 400;
const HEIGHT = 300;

function raster(
  changes: Array<{
    height: number;
    value: number;
    width: number;
    x: number;
    y: number;
  }> = [],
  invalidBitmap = false,
): RasterImage {
  const pixels = new Uint8Array(WIDTH * HEIGHT).fill(80);
  for (const change of changes) {
    for (let y = change.y; y < change.y + change.height; y += 1) {
      for (let x = change.x; x < change.x + change.width; x += 1) {
        pixels[y * WIDTH + x] = change.value;
      }
    }
  }
  return new RasterImage(WIDTH, HEIGHT, pixels, invalidBitmap);
}

function resizedRaster(
  changes: Array<{
    height: number;
    value: number;
    width: number;
    x: number;
    y: number;
  }> = [],
): RasterImage {
  const width = WIDTH / 2;
  const height = HEIGHT / 2;
  const pixels = new Uint8Array(width * height).fill(80);
  for (const change of changes) {
    for (let y = change.y; y < change.y + change.height; y += 1) {
      for (let x = change.x; x < change.x + change.width; x += 1) {
        pixels[y * width + x] = change.value;
      }
    }
  }
  return new RasterImage(width, height, pixels);
}

function observation(
  imageKey: string | undefined,
  fingerprint: string,
  overrides: Partial<DesktopObservation> = {},
): DesktopObservation {
  return {
    observationId: randomUUID(),
    taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    capturedAt: '2026-08-18T00:00:00.000Z',
    text: 'A target is visible.',
    degraded: false,
    fingerprint,
    coordinateSpace: {
      screenHeight: HEIGHT,
      screenWidth: WIDTH,
      screenshotHeight: HEIGHT,
      screenshotWidth: WIDTH,
    },
    ...(imageKey
      ? {
          screenshot: {
            mimeType: 'image/png',
            dataBase64: Buffer.from(imageKey).toString('base64'),
          },
        }
      : {}),
    ...overrides,
  };
}

const click: DesktopCommand = {
  kind: 'click',
  x: 200,
  y: 150,
  button: 'left',
  count: 1,
};

describe('TargetAwareDesktopStateValidator', () => {
  it('uses exact fingerprint equality before decoding evidence', () => {
    const adapter = new RasterAdapter(new Map());
    const validator = new TargetAwareDesktopStateValidator(adapter);

    expect(
      validator.validate({
        command: click,
        reference: observation(undefined, 'a'.repeat(64)),
        current: observation(undefined, 'a'.repeat(64)),
      }),
    ).toMatchObject({ status: 'stable', reason: 'exact_fingerprint' });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it('ignores unrelated full-screen change but rejects material target change', () => {
    const adapter = new RasterAdapter(
      new Map([
        ['reference', raster()],
        ['outside', raster([{ x: 0, y: 0, width: 80, height: 60, value: 220 }])],
        ['target', raster([{ x: 140, y: 105, width: 120, height: 90, value: 220 }])],
      ]),
    );
    const validator = new TargetAwareDesktopStateValidator(adapter);
    const reference = observation('reference', 'a'.repeat(64));

    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('outside', 'b'.repeat(64)),
      }),
    ).toMatchObject({ status: 'stable', regionKind: 'target' });
    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('target', 'c'.repeat(64)),
      }),
    ).toMatchObject({
      status: 'changed',
      reason: 'material_visual_change',
    });
  });

  it('tolerates cursor-sized noise within the target threshold', () => {
    const adapter = new RasterAdapter(
      new Map([
        ['reference', raster()],
        ['cursor', raster([{ x: 200, y: 150, width: 2, height: 2, value: 255 }])],
      ]),
    );
    const validator = new TargetAwareDesktopStateValidator(adapter);

    expect(
      validator.validate({
        command: click,
        reference: observation('reference', 'a'.repeat(64)),
        current: observation('cursor', 'b'.repeat(64)),
      }),
    ).toMatchObject({ status: 'stable', reason: 'within_tolerance' });
  });

  it('validates target evidence after model image resizing preserves desktop metadata', () => {
    const adapter = new RasterAdapter(
      new Map([
        ['reference-resized', resizedRaster()],
        ['current-resized', resizedRaster()],
        [
          'target-resized',
          resizedRaster([
            { x: 70, y: 52, width: 60, height: 46, value: 220 },
          ]),
        ],
      ]),
    );
    const validator = new TargetAwareDesktopStateValidator(adapter);
    const reference = observation('reference-resized', 'a'.repeat(64));

    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('current-resized', 'b'.repeat(64)),
      }),
    ).toMatchObject({ status: 'stable', reason: 'within_tolerance' });
    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('target-resized', 'c'.repeat(64)),
      }),
    ).toMatchObject({
      status: 'changed',
      reason: 'material_visual_change',
      regionKind: 'target',
    });
  });

  it('checks drag path evidence and whole-screen typing evidence', () => {
    const adapter = new RasterAdapter(
      new Map([
        ['reference', raster()],
        ['drag', raster([{ x: 80, y: 80, width: 180, height: 120, value: 210 }])],
        ['global', raster([{ x: 0, y: 0, width: WIDTH, height: HEIGHT, value: 160 }])],
      ]),
    );
    const validator = new TargetAwareDesktopStateValidator(adapter);
    const reference = observation('reference', 'a'.repeat(64));

    expect(
      validator.validate({
        command: {
          kind: 'drag',
          fromX: 100,
          fromY: 100,
          toX: 250,
          toY: 180,
          button: 'left',
          durationMs: 500,
        },
        reference,
        current: observation('drag', 'b'.repeat(64)),
      }),
    ).toMatchObject({ status: 'changed', regionKind: 'drag_path' });
    expect(
      validator.validate({
        command: { kind: 'type_text', text: 'Draft' },
        reference,
        current: observation('global', 'c'.repeat(64)),
      }),
    ).toMatchObject({ status: 'changed', regionKind: 'global' });
  });

  it.each([
    {
      name: 'missing screenshot',
      reference: observation(undefined, 'a'.repeat(64)),
      current: observation('current', 'b'.repeat(64)),
      reason: 'missing_evidence',
    },
    {
      name: 'degraded screenshot',
      reference: observation('reference', 'a'.repeat(64), { degraded: true }),
      current: observation('current', 'b'.repeat(64)),
      reason: 'degraded_evidence',
    },
  ])('fails closed for $name', ({ reference, current, reason }) => {
    const validator = new TargetAwareDesktopStateValidator(
      new RasterAdapter(
        new Map([
          ['reference', raster()],
          ['current', raster()],
        ]),
      ),
    );
    expect(validator.validate({ command: click, reference, current })).toMatchObject({
      status: 'unavailable',
      reason,
    });
  });

  it('fails closed for dimension, decoder, bitmap, and command-shape problems', () => {
    const adapter = new RasterAdapter(
      new Map([
        ['reference', raster()],
        ['current', raster()],
        ['invalid', raster([], true)],
      ]),
    );
    const validator = new TargetAwareDesktopStateValidator(adapter);
    const reference = observation('reference', 'a'.repeat(64));

    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('current', 'b'.repeat(64), {
          coordinateSpace: {
            screenHeight: HEIGHT,
            screenWidth: WIDTH,
            screenshotHeight: HEIGHT - 1,
            screenshotWidth: WIDTH,
          },
        }),
      }),
    ).toMatchObject({ status: 'changed', reason: 'dimension_mismatch' });
    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('unknown', 'c'.repeat(64)),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'decode_failed' });
    expect(
      validator.validate({
        command: click,
        reference,
        current: observation('invalid', 'd'.repeat(64)),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'invalid_bitmap' });
    expect(
      validator.validate({
        command: { kind: 'point', x: 10, y: 10 },
        reference,
        current: observation('current', 'e'.repeat(64)),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'unsupported_command' });
  });

  it('uses injected threshold boundaries deterministically', () => {
    const validator = new TargetAwareDesktopStateValidator(
      new RasterAdapter(
        new Map([
          ['reference', raster()],
          ['target', raster([{ x: 140, y: 105, width: 120, height: 90, value: 220 }])],
        ]),
      ),
      {
        materialLumaDelta: 255,
        maxChangedCellRatio: 1,
        maxMeanLumaDelta: 255,
      },
    );

    expect(
      validator.validate({
        command: click,
        reference: observation('reference', 'a'.repeat(64)),
        current: observation('target', 'b'.repeat(64)),
      }),
    ).toMatchObject({ status: 'stable', reason: 'within_tolerance' });
  });
});
