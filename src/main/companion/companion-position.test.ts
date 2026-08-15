import { describe, expect, it } from 'vitest';

import {
  getVirtualDisplayBounds,
  placeCompanionInOverlay,
  placeCompanionNearCursor,
  shouldUseCompanionOverlay,
} from './companion-position';

const DISPLAY = { height: 800, width: 1200, x: 0, y: 0 };
const COMPANION = { height: 44, width: 44 };

describe('cursor companion placement', () => {
  it('follows below and to the right of the cursor by default', () => {
    expect(
      placeCompanionNearCursor({ x: 400, y: 300 }, DISPLAY, COMPANION),
    ).toEqual({ x: 408, y: 308 });
  });

  it('flips beside the cursor near the lower-right display edge', () => {
    expect(
      placeCompanionNearCursor({ x: 1190, y: 790 }, DISPLAY, COMPANION),
    ).toEqual({ x: 1138, y: 738 });
  });

  it('stays inside displays with negative coordinates', () => {
    const secondaryDisplay = { height: 900, width: 1440, x: -1440, y: -100 };

    expect(
      placeCompanionNearCursor(
        { x: -1438, y: -98 },
        secondaryDisplay,
        COMPANION,
      ),
    ).toEqual({ x: -1430, y: -90 });
  });

  it('builds one overlay covering every display', () => {
    expect(
      getVirtualDisplayBounds([
        { height: 900, width: 1440, x: -1440, y: -100 },
        DISPLAY,
      ]),
    ).toEqual({ height: 900, width: 2640, x: -1440, y: -100 });
  });

  it('places the companion in overlay-local coordinates', () => {
    const overlay = { height: 900, width: 2640, x: -1440, y: -100 };

    expect(
      placeCompanionInOverlay(
        { x: -1438, y: -98 },
        overlay,
        COMPANION,
      ),
    ).toEqual({ x: 10, y: 10 });
  });

  it('uses the overlay companion only on Windows', () => {
    expect(shouldUseCompanionOverlay('win32')).toBe(true);
    expect(shouldUseCompanionOverlay('darwin')).toBe(false);
    expect(shouldUseCompanionOverlay('linux')).toBe(false);
  });
});
