import type {
  DesktopCommand,
  DesktopCoordinateSpace,
  DesktopObservation,
} from './execution-contracts';

export const TARGET_REGION_MIN_WIDTH = 160;
export const TARGET_REGION_MAX_WIDTH = 320;
export const TARGET_REGION_MIN_HEIGHT = 120;
export const TARGET_REGION_MAX_HEIGHT = 240;
export const TARGET_SIGNATURE_SIZE = { width: 64, height: 64 } as const;
export const GLOBAL_SIGNATURE_SIZE = { width: 96, height: 54 } as const;
export const MATERIAL_LUMA_DELTA = 24;
export const MAX_CHANGED_CELL_RATIO = 0.025;
export const MAX_MEAN_LUMA_DELTA = 6;

export interface DesktopStateThresholds {
  materialLumaDelta: number;
  maxChangedCellRatio: number;
  maxMeanLumaDelta: number;
}

export const DEFAULT_DESKTOP_STATE_THRESHOLDS: DesktopStateThresholds = {
  materialLumaDelta: MATERIAL_LUMA_DELTA,
  maxChangedCellRatio: MAX_CHANGED_CELL_RATIO,
  maxMeanLumaDelta: MAX_MEAN_LUMA_DELTA,
};

interface ImageRectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface ImageSize {
  height: number;
  width: number;
}

export interface DesktopImage {
  crop(rectangle: ImageRectangle): DesktopImage;
  getSize(): { height: number; width: number };
  resize(options: { height: number; width: number }): DesktopImage;
  toBitmap(): Buffer;
}

export interface DesktopImageAdapter {
  create(data: Buffer): DesktopImage;
}

type RegionKind = 'target' | 'drag_path' | 'global';

export type DesktopStateValidation =
  | {
      status: 'stable';
      reason: 'exact_fingerprint' | 'within_tolerance';
      regionKind: RegionKind;
      changedCellRatio: number;
      meanLumaDelta: number;
    }
  | {
      status: 'changed';
      reason: 'material_visual_change' | 'dimension_mismatch';
      regionKind: RegionKind;
      changedCellRatio: number;
      meanLumaDelta: number;
    }
  | {
      status: 'unavailable';
      reason:
        | 'missing_evidence'
        | 'degraded_evidence'
        | 'unsupported_command'
        | 'decode_failed'
        | 'invalid_bitmap';
      regionKind?: RegionKind;
    };

export interface DesktopStateValidator {
  validate(input: {
    command: DesktopCommand;
    current: DesktopObservation;
    reference: DesktopObservation;
  }): DesktopStateValidation;
}

interface SelectedRegion {
  kind: RegionKind;
  rectangle?: ImageRectangle;
  signatureSize: { height: number; width: number };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function centeredRegion(
  coordinateSpace: DesktopCoordinateSpace,
  x: number,
  y: number,
): ImageRectangle {
  const width = Math.min(
    coordinateSpace.screenshotWidth,
    clamp(
      Math.round(coordinateSpace.screenshotWidth * 0.16),
      TARGET_REGION_MIN_WIDTH,
      TARGET_REGION_MAX_WIDTH,
    ),
  );
  const height = Math.min(
    coordinateSpace.screenshotHeight,
    clamp(
      Math.round(coordinateSpace.screenshotHeight * 0.16),
      TARGET_REGION_MIN_HEIGHT,
      TARGET_REGION_MAX_HEIGHT,
    ),
  );
  return {
    x: clamp(Math.round(x - width / 2), 0, coordinateSpace.screenshotWidth - width),
    y: clamp(
      Math.round(y - height / 2),
      0,
      coordinateSpace.screenshotHeight - height,
    ),
    width,
    height,
  };
}

function dragRegion(
  coordinateSpace: DesktopCoordinateSpace,
  command: Extract<DesktopCommand, { kind: 'drag' }>,
): ImageRectangle {
  const padding = clamp(
    Math.round(
      Math.min(
        coordinateSpace.screenshotWidth,
        coordinateSpace.screenshotHeight,
      ) * 0.04,
    ),
    32,
    96,
  );
  const x = clamp(
    Math.min(command.fromX, command.toX) - padding,
    0,
    coordinateSpace.screenshotWidth - 1,
  );
  const y = clamp(
    Math.min(command.fromY, command.toY) - padding,
    0,
    coordinateSpace.screenshotHeight - 1,
  );
  const right = clamp(
    Math.max(command.fromX, command.toX) + padding,
    x + 1,
    coordinateSpace.screenshotWidth,
  );
  const bottom = clamp(
    Math.max(command.fromY, command.toY) + padding,
    y + 1,
    coordinateSpace.screenshotHeight,
  );
  return { x, y, width: right - x, height: bottom - y };
}

function selectRegion(
  command: DesktopCommand,
  coordinateSpace: DesktopCoordinateSpace,
): SelectedRegion | undefined {
  if (command.kind === 'click' || command.kind === 'scroll') {
    return {
      kind: 'target',
      rectangle: centeredRegion(coordinateSpace, command.x, command.y),
      signatureSize: TARGET_SIGNATURE_SIZE,
    };
  }
  if (command.kind === 'drag') {
    return {
      kind: 'drag_path',
      rectangle: dragRegion(coordinateSpace, command),
      signatureSize: TARGET_SIGNATURE_SIZE,
    };
  }
  if (command.kind === 'type_text' || command.kind === 'keypress') {
    return { kind: 'global', signatureSize: GLOBAL_SIGNATURE_SIZE };
  }
  return undefined;
}

function sameCoordinateSpace(
  reference: DesktopCoordinateSpace,
  current: DesktopCoordinateSpace,
): boolean {
  return (
    reference.screenHeight === current.screenHeight &&
    reference.screenWidth === current.screenWidth &&
    reference.screenshotHeight === current.screenshotHeight &&
    reference.screenshotWidth === current.screenshotWidth
  );
}

function sameImageSize(reference: ImageSize, current: ImageSize): boolean {
  return (
    reference.height === current.height && reference.width === current.width
  );
}

function preservesCoordinateSpaceAspectRatio(
  imageSize: ImageSize,
  coordinateSpace: DesktopCoordinateSpace,
): boolean {
  if (imageSize.width <= 0 || imageSize.height <= 0) return false;
  const crossProductDelta = Math.abs(
    imageSize.width * coordinateSpace.screenshotHeight -
      imageSize.height * coordinateSpace.screenshotWidth,
  );
  return (
    crossProductDelta <=
    Math.max(coordinateSpace.screenshotWidth, coordinateSpace.screenshotHeight)
  );
}

function scaleRectangleToImage(
  rectangle: ImageRectangle,
  coordinateSpace: DesktopCoordinateSpace,
  imageSize: ImageSize,
): ImageRectangle {
  const scaleX = imageSize.width / coordinateSpace.screenshotWidth;
  const scaleY = imageSize.height / coordinateSpace.screenshotHeight;
  const x = clamp(Math.floor(rectangle.x * scaleX), 0, imageSize.width - 1);
  const y = clamp(Math.floor(rectangle.y * scaleY), 0, imageSize.height - 1);
  const right = clamp(
    Math.ceil((rectangle.x + rectangle.width) * scaleX),
    x + 1,
    imageSize.width,
  );
  const bottom = clamp(
    Math.ceil((rectangle.y + rectangle.height) * scaleY),
    y + 1,
    imageSize.height,
  );
  return { x, y, width: right - x, height: bottom - y };
}

function imageSignature(
  bitmap: Buffer,
  width: number,
  height: number,
): number[] | undefined {
  const pixelCount = width * height;
  if (pixelCount <= 0 || bitmap.length % pixelCount !== 0) return undefined;
  const bytesPerPixel = bitmap.length / pixelCount;
  if (!Number.isInteger(bytesPerPixel) || bytesPerPixel < 3) return undefined;

  const grayscale = new Array<number>(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * bytesPerPixel;
    grayscale[index] =
      ((bitmap[offset] ?? 0) +
        (bitmap[offset + 1] ?? 0) +
        (bitmap[offset + 2] ?? 0)) /
      3;
  }

  return grayscale.map((luma, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const adjacent: number[] = [];
    if (x > 0) adjacent.push(Math.abs(luma - (grayscale[index - 1] ?? luma)));
    if (y > 0) adjacent.push(Math.abs(luma - (grayscale[index - width] ?? luma)));
    const edge =
      adjacent.reduce((total, value) => total + value, 0) /
      Math.max(1, adjacent.length);
    return luma * 0.75 + edge * 0.25;
  });
}

function selectedBitmap(
  image: DesktopImage,
  region: SelectedRegion,
  coordinateSpace: DesktopCoordinateSpace,
  imageSize: ImageSize,
): Buffer {
  const selected = region.rectangle
    ? image.crop(
        scaleRectangleToImage(region.rectangle, coordinateSpace, imageSize),
      )
    : image;
  return selected.resize(region.signatureSize).toBitmap();
}

export class TargetAwareDesktopStateValidator implements DesktopStateValidator {
  constructor(
    private readonly images: DesktopImageAdapter,
    private readonly thresholds: DesktopStateThresholds =
      DEFAULT_DESKTOP_STATE_THRESHOLDS,
  ) {}

  validate(input: {
    command: DesktopCommand;
    current: DesktopObservation;
    reference: DesktopObservation;
  }): DesktopStateValidation {
    const coordinateSpace = input.reference.coordinateSpace;
    const currentCoordinateSpace = input.current.coordinateSpace;
    const region = coordinateSpace
      ? selectRegion(input.command, coordinateSpace)
      : undefined;
    const regionKind = region?.kind ?? 'global';

    if (input.reference.fingerprint === input.current.fingerprint) {
      return {
        status: 'stable',
        reason: 'exact_fingerprint',
        regionKind,
        changedCellRatio: 0,
        meanLumaDelta: 0,
      };
    }
    if (!region) {
      return { status: 'unavailable', reason: 'unsupported_command' };
    }
    if (
      !input.reference.screenshot ||
      !input.current.screenshot ||
      !coordinateSpace ||
      !currentCoordinateSpace
    ) {
      return {
        status: 'unavailable',
        reason: 'missing_evidence',
        regionKind,
      };
    }
    if (input.reference.degraded || input.current.degraded) {
      return {
        status: 'unavailable',
        reason: 'degraded_evidence',
        regionKind,
      };
    }
    if (!sameCoordinateSpace(coordinateSpace, currentCoordinateSpace)) {
      return {
        status: 'changed',
        reason: 'dimension_mismatch',
        regionKind,
        changedCellRatio: 1,
        meanLumaDelta: 255,
      };
    }

    try {
      const referenceImage = this.images.create(
        Buffer.from(input.reference.screenshot.dataBase64, 'base64'),
      );
      const currentImage = this.images.create(
        Buffer.from(input.current.screenshot.dataBase64, 'base64'),
      );
      const referenceSize = referenceImage.getSize();
      const currentSize = currentImage.getSize();
      if (
        !sameImageSize(referenceSize, currentSize) ||
        !preservesCoordinateSpaceAspectRatio(referenceSize, coordinateSpace) ||
        !preservesCoordinateSpaceAspectRatio(
          currentSize,
          currentCoordinateSpace,
        )
      ) {
        return {
          status: 'changed',
          reason: 'dimension_mismatch',
          regionKind,
          changedCellRatio: 1,
          meanLumaDelta: 255,
        };
      }

      const referenceSignature = imageSignature(
        selectedBitmap(referenceImage, region, coordinateSpace, referenceSize),
        region.signatureSize.width,
        region.signatureSize.height,
      );
      const currentSignature = imageSignature(
        selectedBitmap(
          currentImage,
          region,
          currentCoordinateSpace,
          currentSize,
        ),
        region.signatureSize.width,
        region.signatureSize.height,
      );
      if (
        !referenceSignature ||
        !currentSignature ||
        referenceSignature.length !== currentSignature.length
      ) {
        return { status: 'unavailable', reason: 'invalid_bitmap', regionKind };
      }

      let changedCells = 0;
      let totalDelta = 0;
      referenceSignature.forEach((value, index) => {
        const delta = Math.abs(value - (currentSignature[index] ?? value));
        totalDelta += delta;
        if (delta > this.thresholds.materialLumaDelta) changedCells += 1;
      });
      const changedCellRatio = changedCells / referenceSignature.length;
      const meanLumaDelta = totalDelta / referenceSignature.length;
      const changed =
        changedCellRatio > this.thresholds.maxChangedCellRatio ||
        meanLumaDelta > this.thresholds.maxMeanLumaDelta;
      if (changed) {
        return {
          status: 'changed',
          reason: 'material_visual_change',
          regionKind,
          changedCellRatio,
          meanLumaDelta,
        };
      }
      return {
        status: 'stable',
        reason: 'within_tolerance',
        regionKind,
        changedCellRatio,
        meanLumaDelta,
      };
    } catch {
      return { status: 'unavailable', reason: 'decode_failed', regionKind };
    }
  }
}
