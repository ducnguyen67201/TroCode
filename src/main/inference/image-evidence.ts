import type { DesktopObservation } from '../agent/execution-contracts';

const MAX_MODEL_IMAGE_WIDTH = 1_536;
const JPEG_QUALITY = 72;

export interface ImageEvidenceAdapter {
  create(data: Buffer): {
    getSize(): { height: number; width: number };
    resize(options: { width: number }): {
      toJPEG(quality: number): Buffer;
    };
  };
}

export function resizeObservationForModel(
  observation: DesktopObservation,
  adapter: ImageEvidenceAdapter,
): DesktopObservation {
  if (!observation.screenshot) return observation;
  try {
    const image = adapter.create(
      Buffer.from(observation.screenshot.dataBase64, 'base64'),
    );
    const size = image.getSize();
    if (size.width <= MAX_MODEL_IMAGE_WIDTH) return observation;
    const resized = image.resize({ width: MAX_MODEL_IMAGE_WIDTH });
    return {
      ...observation,
      screenshot: {
        dataBase64: resized.toJPEG(JPEG_QUALITY).toString('base64'),
        mimeType: 'image/jpeg',
      },
    };
  } catch {
    return {
      ...observation,
      degraded: true,
      screenshot: undefined,
      text:
        observation.text +
        '\nThe screenshot could not be safely resized, so only text state is available.',
    };
  }
}
