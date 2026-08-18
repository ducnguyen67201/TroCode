import type {
  DesktopCommand,
  DesktopObservation,
} from './execution-contracts';

export interface DecodedDesktopImage {
  height: number;
  pixels: Uint8Array;
  width: number;
}

export type DesktopImageDecoder = (
  data: Buffer,
) => DecodedDesktopImage | undefined;

interface DifferenceStats {
  changedFraction: number;
  meanDelta: number;
}

interface NormalizedRegion {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

const TARGET_RADIUS = 0.08;

function validImage(image: DecodedDesktopImage | undefined): image is DecodedDesktopImage {
  return Boolean(
    image &&
      image.width > 0 &&
      image.height > 0 &&
      image.pixels.length >= image.width * image.height * 4,
  );
}

function pixelDelta(
  left: DecodedDesktopImage,
  right: DecodedDesktopImage,
  normalizedX: number,
  normalizedY: number,
): number {
  const leftX = Math.min(
    left.width - 1,
    Math.max(0, Math.round(normalizedX * (left.width - 1))),
  );
  const leftY = Math.min(
    left.height - 1,
    Math.max(0, Math.round(normalizedY * (left.height - 1))),
  );
  const rightX = Math.min(
    right.width - 1,
    Math.max(0, Math.round(normalizedX * (right.width - 1))),
  );
  const rightY = Math.min(
    right.height - 1,
    Math.max(0, Math.round(normalizedY * (right.height - 1))),
  );
  const leftOffset = (leftY * left.width + leftX) * 4;
  const rightOffset = (rightY * right.width + rightX) * 4;
  return (
    (Math.abs(left.pixels[leftOffset]! - right.pixels[rightOffset]!) +
      Math.abs(
        left.pixels[leftOffset + 1]! - right.pixels[rightOffset + 1]!,
      ) +
      Math.abs(
        left.pixels[leftOffset + 2]! - right.pixels[rightOffset + 2]!,
      )) /
    3
  );
}

function differenceStats(
  left: DecodedDesktopImage,
  right: DecodedDesktopImage,
  region: NormalizedRegion,
): DifferenceStats {
  let changed = 0;
  let deltaTotal = 0;
  const grid = {
    columns: Math.max(
      1,
      Math.round(
        Math.min(left.width, right.width) * (region.right - region.left),
      ),
    ),
    rows: Math.max(
      1,
      Math.round(
        Math.min(left.height, right.height) * (region.bottom - region.top),
      ),
    ),
  };
  const sampleCount = grid.columns * grid.rows;
  for (let row = 0; row < grid.rows; row += 1) {
    const y =
      region.top +
      ((row + 0.5) / grid.rows) * (region.bottom - region.top);
    for (let column = 0; column < grid.columns; column += 1) {
      const x =
        region.left +
        ((column + 0.5) / grid.columns) * (region.right - region.left);
      const delta = pixelDelta(left, right, x, y);
      deltaTotal += delta;
      if (delta >= 25) changed += 1;
    }
  }
  return {
    changedFraction: changed / sampleCount,
    meanDelta: deltaTotal / sampleCount,
  };
}

function targetPoints(
  command: DesktopCommand,
  observation: DesktopObservation,
): Array<{ x: number; y: number }> {
  const coordinateSpace = observation.coordinateSpace;
  if (!coordinateSpace) return [];
  const normalize = (point: { x: number; y: number }) => ({
    x: point.x / coordinateSpace.screenshotWidth,
    y: point.y / coordinateSpace.screenshotHeight,
  });
  switch (command.kind) {
    case 'click':
    case 'point':
    case 'scroll':
      return [normalize(command)];
    case 'drag':
      return [
        normalize({ x: command.fromX, y: command.fromY }),
        normalize({ x: command.toX, y: command.toY }),
      ];
    default:
      return [];
  }
}

function regionAround(point: { x: number; y: number }): NormalizedRegion {
  return {
    bottom: Math.min(1, point.y + TARGET_RADIUS),
    left: Math.max(0, point.x - TARGET_RADIUS),
    right: Math.min(1, point.x + TARGET_RADIUS),
    top: Math.max(0, point.y - TARGET_RADIUS),
  };
}

export function approvalObservationMatches(
  approved: DesktopObservation,
  current: DesktopObservation,
  command: DesktopCommand,
  decode: DesktopImageDecoder,
): boolean {
  if (approved.fingerprint === current.fingerprint) return true;
  if (
    approved.degraded ||
    current.degraded ||
    !approved.screenshot ||
    !current.screenshot
  ) {
    return false;
  }

  try {
    const approvedImage = decode(
      Buffer.from(approved.screenshot.dataBase64, 'base64'),
    );
    const currentImage = decode(
      Buffer.from(current.screenshot.dataBase64, 'base64'),
    );
    if (!validImage(approvedImage) || !validImage(currentImage)) return false;
    const approvedAspect = approvedImage.width / approvedImage.height;
    const currentAspect = currentImage.width / currentImage.height;
    if (Math.abs(approvedAspect - currentAspect) / approvedAspect > 0.01) {
      return false;
    }

    const fullScreen = differenceStats(
      approvedImage,
      currentImage,
      { bottom: 1, left: 0, right: 1, top: 0 },
    );
    if (fullScreen.meanDelta > 4.5 || fullScreen.changedFraction > 0.075) {
      return false;
    }

    return targetPoints(command, approved).every((point) => {
      const target = differenceStats(
        approvedImage,
        currentImage,
        regionAround(point),
      );
      return target.meanDelta <= 12 && target.changedFraction <= 0.18;
    });
  } catch {
    return false;
  }
}
