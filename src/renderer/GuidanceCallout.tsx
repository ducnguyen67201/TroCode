import { useEffect, useState } from 'react';

import type { CompanionGuidance } from '../shared/contracts';

export function GuidanceCallout() {
  const [guidance, setGuidance] = useState<CompanionGuidance | null>(null);

  useEffect(() => window.troCompanion.onGuidanceChange(setGuidance), []);

  if (!guidance) return null;

  return (
    <aside
      aria-live="polite"
      className={`guidance-callout guidance-callout--${guidance.side}`}
      role="status"
    >
      <div className="guidance-callout__header" aria-hidden="true">
        <span className="guidance-callout__avatar">T</span>
        <span className="guidance-callout__name">TroCode</span>
        <span className="guidance-callout__status">Guiding</span>
      </div>
      <p>{guidance.message}</p>
      <span className="guidance-callout__target">
        {guidance.target ?? 'Look here'}
      </span>
    </aside>
  );
}
