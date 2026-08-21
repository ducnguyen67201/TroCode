import { z } from 'zod';

import type { DesktopObservation } from '../agent/execution-contracts';

const MAX_OVERVIEW_WIDTH = 1_536;
const MAX_OVERVIEW_PIXELS = 2_500_000;
const MAX_CROP_EDGE = 2_048;
const MAX_ORIGINAL_BYTES = 40_000_000;
const MAX_ORIGINAL_PIXELS = 24_000_000;
const MAX_CROP_PIXELS_PER_TASK = 16_000_000;

export const NormalizedImageRegionSchema = z.object({
  x: z.number().int().min(0).max(999),
  y: z.number().int().min(0).max(999),
  width: z.number().int().min(1).max(1_000),
  height: z.number().int().min(1).max(1_000),
}).strict().superRefine((region, context) => {
  if (region.x + region.width > 1_000 || region.y + region.height > 1_000) {
    context.addIssue({ code: 'custom', message: 'The crop must stay inside the current observation.' });
  }
});

export interface EvidenceImage {
  crop(rectangle: { height: number; width: number; x: number; y: number }): EvidenceImage;
  getSize(): { height: number; width: number };
  resize(options: { height?: number; width?: number }): EvidenceImage;
  toJPEG(quality: number): Buffer;
}

export interface ImageEvidencePolicyAdapter {
  create(data: Buffer): EvidenceImage;
}

interface RetainedImage {
  buffer: Buffer;
  mimeType: string;
  observationId: string;
}

export class ImageEvidencePolicy {
  private readonly originals = new Map<string, RetainedImage>();
  private readonly cropPixels = new Map<string, number>();

  constructor(private readonly adapter: ImageEvidencePolicyAdapter) {}

  prepare(taskId: string, observation: DesktopObservation): DesktopObservation {
    if (!observation.screenshot) {
      this.originals.delete(taskId);
      return observation;
    }
    try {
      const buffer = Buffer.from(observation.screenshot.dataBase64, 'base64');
      const image = this.adapter.create(buffer);
      const size = image.getSize();
      if (
        buffer.byteLength <= MAX_ORIGINAL_BYTES &&
        size.width * size.height <= MAX_ORIGINAL_PIXELS
      ) {
        this.originals.set(taskId, {
          buffer,
          mimeType: observation.screenshot.mimeType,
          observationId: observation.observationId,
        });
      } else {
        this.originals.delete(taskId);
      }
      const overviewScale = Math.min(
        1,
        MAX_OVERVIEW_WIDTH / size.width,
        Math.sqrt(MAX_OVERVIEW_PIXELS / (size.width * size.height)),
      );
      if (overviewScale >= 1) return observation;
      const overview = image.resize({
        height: Math.max(1, Math.floor(size.height * overviewScale)),
        width: Math.max(1, Math.floor(size.width * overviewScale)),
      }).toJPEG(72);
      return {
        ...observation,
        screenshot: { dataBase64: overview.toString('base64'), mimeType: 'image/jpeg' },
      };
    } catch {
      this.originals.delete(taskId);
      return {
        ...observation,
        degraded: true,
        screenshot: undefined,
        text: `${observation.text}\nThe screenshot was invalid, so only semantic text is available.`,
      };
    }
  }

  inspect(
    taskId: string,
    observationId: string,
    inputRegion: unknown,
  ): {
    dataUrl: string;
    height: number;
    observationId: string;
    region: z.infer<typeof NormalizedImageRegionSchema>;
    width: number;
  } {
    const retained = this.originals.get(taskId);
    if (!retained || retained.observationId !== observationId) {
      throw new Error('The original image expired; capture a fresh observation before cropping.');
    }
    const region = NormalizedImageRegionSchema.parse(inputRegion);
    const image = this.adapter.create(retained.buffer);
    const size = image.getSize();
    const rectangle = {
      x: Math.floor((region.x / 1_000) * size.width),
      y: Math.floor((region.y / 1_000) * size.height),
      width: Math.max(1, Math.ceil((region.width / 1_000) * size.width)),
      height: Math.max(1, Math.ceil((region.height / 1_000) * size.height)),
    };
    rectangle.width = Math.min(rectangle.width, size.width - rectangle.x);
    rectangle.height = Math.min(rectangle.height, size.height - rectangle.y);
    let crop = image.crop(rectangle);
    const cropSize = crop.getSize();
    if (cropSize.width > MAX_CROP_EDGE || cropSize.height > MAX_CROP_EDGE) {
      const scale = Math.min(
        MAX_CROP_EDGE / cropSize.width,
        MAX_CROP_EDGE / cropSize.height,
      );
      crop = crop.resize({
        width: Math.max(1, Math.floor(cropSize.width * scale)),
        height: Math.max(1, Math.floor(cropSize.height * scale)),
      });
    }
    const encodedSize = crop.getSize();
    const pixels = encodedSize.width * encodedSize.height;
    const consumed = this.cropPixels.get(taskId) ?? 0;
    if (consumed + pixels > MAX_CROP_PIXELS_PER_TASK) {
      throw new Error('The task original-resolution crop budget is exhausted.');
    }
    this.cropPixels.set(taskId, consumed + pixels);
    return {
      dataUrl: `data:image/jpeg;base64,${crop.toJPEG(85).toString('base64')}`,
      height: encodedSize.height,
      observationId,
      region,
      width: encodedSize.width,
    };
  }

  clear(taskId: string): void {
    this.originals.delete(taskId);
    this.cropPixels.delete(taskId);
  }
}
