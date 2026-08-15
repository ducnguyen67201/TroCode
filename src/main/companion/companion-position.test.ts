import { describe, expect, it } from 'vitest';

import { placeCompanionNearCursor } from './companion-position';

const DISPLAY = { height: 800, width: 1200, x: 0, y: 0 };
const COMPANION = { height: 58, width: 54 };

describe('cursor companion placement', () => {
  it('follows below and to the right of the cursor by default', () => {
    expect(
      placeCompanionNearCursor({ x: 400, y: 300 }, DISPLAY, COMPANION),
    ).toEqual({ x: 416, y: 316 });
  });

  it('flips beside the cursor near the lower-right display edge', () => {
    expect(
      placeCompanionNearCursor({ x: 1190, y: 790 }, DISPLAY, COMPANION),
    ).toEqual({ x: 1120, y: 716 });
  });

  it('stays inside displays with negative coordinates', () => {
    const secondaryDisplay = { height: 900, width: 1440, x: -1440, y: -100 };

    expect(
      placeCompanionNearCursor(
        { x: -1438, y: -98 },
        secondaryDisplay,
        COMPANION,
      ),
    ).toEqual({ x: -1422, y: -82 });
  });
});
