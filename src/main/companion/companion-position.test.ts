import { describe, expect, it } from 'vitest';

import {
  getVirtualDisplayBounds,
  interpolateCompanionPosition,
  placeCompanionForBrowserNavigation,
  placeCompanionInOverlay,
  placeCompanionNearCursor,
  placeGuidanceCallout,
  placeGuidanceTargetMarker,
  placeVoiceIsland,
  resolveDesktopCaptureBounds,
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

  it('places browser navigation feedback near the active display toolbar', () => {
    expect(
      placeCompanionForBrowserNavigation(DISPLAY, COMPANION),
    ).toEqual({ x: 608, y: 72 });

    expect(
      placeCompanionForBrowserNavigation(
        { height: 900, width: 1440, x: -1440, y: -100 },
        COMPANION,
      ),
    ).toEqual({ x: -712, y: -20 });
  });

  it('places a teaching callout beside the pointer and flips at display edges', () => {
    const callout = { height: 104, width: 320 };

    expect(
      placeGuidanceCallout(
        { x: 400, y: 300 },
        DISPLAY,
        callout,
        COMPANION,
      ),
    ).toEqual({ x: 456, y: 279 });
    expect(
      placeGuidanceCallout(
        { x: 1190, y: 790 },
        DISPLAY,
        callout,
        COMPANION,
      ),
    ).toEqual({ x: 858, y: 674 });
  });

  it('pads and clamps a highlighted walkthrough region to its display', () => {
    expect(
      placeGuidanceTargetMarker(
        { x: 420, y: 330 },
        { x: 300, y: 250, width: 240, height: 160 },
        DISPLAY,
      ),
    ).toEqual({ x: 282, y: 232, width: 276, height: 196 });

    expect(
      placeGuidanceTargetMarker(
        { x: 1_195, y: 795 },
        { x: 1_160, y: 770, width: 80, height: 60 },
        DISPLAY,
      ),
    ).toEqual({ x: 1_124, y: 724, width: 76, height: 76 });
  });

  it('creates a visible point marker when no region is available', () => {
    expect(
      placeGuidanceTargetMarker({ x: -1_438, y: -98 }, undefined, {
        height: 900,
        width: 1440,
        x: -1440,
        y: -100,
      }),
    ).toEqual({ x: -1440, y: -100, width: 76, height: 76 });
  });

  it('centers the voice island below the active display work area', () => {
    expect(
      placeVoiceIsland(
        { height: 770, width: 1200, x: 0, y: 30 },
        { height: 76, width: 420 },
      ),
    ).toEqual({ x: 390, y: 40 });

    expect(
      placeVoiceIsland(
        { height: 80, width: 300, x: -300, y: -20 },
        { height: 76, width: 420 },
      ),
    ).toEqual({ x: -300, y: -16 });
  });

  it('builds one overlay covering every display', () => {
    expect(
      getVirtualDisplayBounds([
        { height: 900, width: 1440, x: -1440, y: -100 },
        DISPLAY,
      ]),
    ).toEqual({ height: 900, width: 2640, x: -1440, y: -100 });
  });

  it('resolves a full-desktop capture to virtual bounds with a negative origin', () => {
    const secondaryDisplay = { height: 900, width: 1440, x: -1440, y: -100 };

    expect(
      resolveDesktopCaptureBounds(
        { height: 900, width: 2640 },
        [secondaryDisplay, DISPLAY],
        DISPLAY,
      ),
    ).toEqual({ height: 900, width: 2640, x: -1440, y: -100 });
  });

  it('falls back to the matching primary or unique display capture bounds', () => {
    const secondaryDisplay = { height: 900, width: 1440, x: -1440, y: -100 };

    expect(
      resolveDesktopCaptureBounds(
        { height: DISPLAY.height, width: DISPLAY.width },
        [secondaryDisplay, DISPLAY],
        DISPLAY,
      ),
    ).toEqual(DISPLAY);
    expect(
      resolveDesktopCaptureBounds(
        { height: secondaryDisplay.height, width: secondaryDisplay.width },
        [secondaryDisplay, DISPLAY],
        DISPLAY,
      ),
    ).toEqual(secondaryDisplay);
    expect(
      resolveDesktopCaptureBounds(
        { height: 777, width: 999 },
        [secondaryDisplay, DISPLAY],
        DISPLAY,
      ),
    ).toBeUndefined();
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

  it('glides between positions with clamped ease-out movement', () => {
    expect(
      interpolateCompanionPosition({ x: 100, y: 200 }, { x: 500, y: 600 }, 0),
    ).toEqual({ x: 100, y: 200 });
    expect(
      interpolateCompanionPosition(
        { x: 100, y: 200 },
        { x: 500, y: 600 },
        0.5,
      ),
    ).toEqual({ x: 450, y: 550 });
    expect(
      interpolateCompanionPosition({ x: 100, y: 200 }, { x: 500, y: 600 }, 2),
    ).toEqual({ x: 500, y: 600 });
  });
});
