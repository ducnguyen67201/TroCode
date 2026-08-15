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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function placeCompanionNearCursor(
  cursor: Point,
  displayBounds: Rectangle,
  companionSize: Size,
  gap = 16,
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
