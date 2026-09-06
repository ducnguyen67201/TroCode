import type { AppLanguage, TaskEvent } from '../../../shared/contracts';
import { translate } from '../../app-language';

import { formatLabel } from './task-presentation';

export function ActivityList({
  appLanguage,
  events,
}: {
  appLanguage: AppLanguage;
  events: TaskEvent[];
}) {
  if (events.length === 0) {
    return (
      <p className="empty-activity">
        {translate(appLanguage, 'Task events will appear here.')}
      </p>
    );
  }

  return (
    <ol className="activity-list">
      {events.map((event) => (
        <li key={event.eventId}>
          <span
            className={`activity-marker activity-marker--${event.status}`}
          />
          <div>
            <strong>{formatLabel(event.phase, appLanguage)}</strong>
            <p>{event.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
