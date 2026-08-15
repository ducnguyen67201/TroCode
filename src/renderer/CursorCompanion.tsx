import { useEffect, useState } from 'react';

import cursorBuddyUrl from '../assets/tro-cursor-buddy.png';
import type { CompanionState } from '../shared/contracts';

export function CursorCompanion() {
  const [state, setState] = useState<CompanionState>('idle');

  useEffect(() => window.troCompanion.onStateChange(setState), []);

  return (
    <div
      aria-label={`TroCode companion: ${state}`}
      className={`cursor-companion cursor-companion--${state}`}
      role="img"
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
