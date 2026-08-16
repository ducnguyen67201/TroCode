export interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  height: number;
  width: number;
}

export interface Size {
  height: number;
  width: number;
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

export function shouldUseCompanionOverlay(platform: string): boolean {
  return platform === 'win32';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function interpolateCompanionPosition(
  from: Point,
  to: Point,
  progress: number,
): Point {
  const normalizedProgress = clampUnit(progress);
  const easedProgress = 1 - Math.pow(1 - normalizedProgress, 3);

  return {
    x: Math.round(from.x + (to.x - from.x) * easedProgress),
    y: Math.round(from.y + (to.y - from.y) * easedProgress),
  };
}

export function placeCompanionNearCursor(
  cursor: Point,
  displayBounds: Rectangle,
  companionSize: Size,
  gap = 8,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  let x = cursor.x + gap;
  let y = cursor.y + gap;

  if (x + companionSize.width > displayRight) {
    x = cursor.x - companionSize.width - gap;
  }

  if (y + companionSize.height > displayBottom) {
    y = cursor.y - companionSize.height - gap;
  }

  return {
    x: Math.round(
      clamp(x, displayBounds.x, displayRight - companionSize.width),
    ),
    y: Math.round(
      clamp(y, displayBounds.y, displayBottom - companionSize.height),
    ),
  };
}

export function placeCompanionForBrowserNavigation(
  displayBounds: Rectangle,
  companionSize: Size,
  gap = 8,
): Point {
  const toolbarTarget = {
    x: displayBounds.x + Math.round(displayBounds.width / 2),
    y:
      displayBounds.y +
      Math.min(
        88,
        Math.max(48, Math.round(displayBounds.height * 0.08)),
      ),
  };

  return placeCompanionNearCursor(
    toolbarTarget,
    displayBounds,
    companionSize,
    gap,
  );
}

export function placeGuidanceCallout(
  target: Point,
  displayBounds: Rectangle,
  calloutSize: Size,
  companionSize: Size,
  gap = 12,
): Point {
  const displayRight = displayBounds.x + displayBounds.width;
  const displayBottom = displayBounds.y + displayBounds.height;
  let x = target.x + companionSize.width + gap;
  let y = target.y - Math.round(calloutSize.height * 0.2);

  if (x + calloutSize.width > displayRight) {
    x = target.x - calloutSize.width - gap;
  }
  if (y + calloutSize.height > displayBottom) {
    y = target.y - calloutSize.height - gap;
  }

  return {
    x: Math.round(clamp(x, displayBounds.x, displayRight - calloutSize.width)),
    y: Math.round(clamp(y, displayBounds.y, displayBottom - calloutSize.height)),
  };
}

export function getVirtualDisplayBounds(displays: readonly Rectangle[]): Rectangle {
  if (displays.length === 0) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }

  const left = Math.min(...displays.map((display) => display.x));
  const top = Math.min(...displays.map((display) => display.y));
  const right = Math.max(
    ...displays.map((display) => display.x + display.width),
  );
  const bottom = Math.max(
    ...displays.map((display) => display.y + display.height),
  );

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function placeCompanionInOverlay(
  cursor: Point,
  overlayBounds: Rectangle,
  companionSize: Size,
  gap = 8,
  placementBounds = overlayBounds,
): Point {
  const screenPosition = placeCompanionNearCursor(
    cursor,
    placementBounds,
    companionSize,
    gap,
  );

  return {
    x: screenPosition.x - overlayBounds.x,
    y: screenPosition.y - overlayBounds.y,
  };
}
