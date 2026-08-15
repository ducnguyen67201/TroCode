import { useEffect, useState } from 'react';

import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';
import type { CompanionPosition, CompanionState } from '../shared/contracts';

const usesOverlayTracking =
  new URLSearchParams(window.location.search).get('tracking') === 'overlay';

export function CursorCompanion() {
  const [position, setPosition] = useState<CompanionPosition>({ x: 0, y: 0 });
  const [state, setState] = useState<CompanionState>('idle');

  useEffect(() => {
    if (!usesOverlayTracking) return undefined;

    return window.troCompanion.onPositionChange(setPosition);
  }, []);
  useEffect(() => window.troCompanion.onStateChange(setState), []);

  return (
    <div
      aria-label={`TroCode companion: ${state}`}
      className={`cursor-companion cursor-companion--${state}${
        usesOverlayTracking ? ' cursor-companion--overlay' : ''
      }`}
      role="img"
      style={
        usesOverlayTracking
          ? { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }
          : undefined
      }
    >
      <div className="cursor-companion__visual">
        <span className="cursor-companion__ring" aria-hidden="true" />
        <img alt="" draggable={false} src={cursorBuddyUrl} />
        <span className="cursor-companion__listening" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cursor-companion__error" aria-hidden="true">
          !
        </span>
      </div>
    </div>
  );
}
