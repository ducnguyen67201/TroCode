import type { TaskEvent, TaskSnapshot } from '../../../shared/contracts';

export function appendUniqueEvent(
  currentEvents: TaskEvent[],
  event: TaskEvent,
): TaskEvent[] {
  return currentEvents.some(
    (currentEvent) => currentEvent.eventId === event.eventId,
  )
    ? currentEvents
    : [...currentEvents, event];
}

export function mergeTaskSnapshots(
  currentSnapshots: Record<string, TaskSnapshot>,
  incomingSnapshots: readonly TaskSnapshot[],
): Record<string, TaskSnapshot> {
  const mergedSnapshots = { ...currentSnapshots };
  for (const snapshot of incomingSnapshots) {
    const current = mergedSnapshots[snapshot.taskId];
    if (!current || current.updatedAt < snapshot.updatedAt) {
      mergedSnapshots[snapshot.taskId] = snapshot;
    }
  }
  return mergedSnapshots;
}

export function mergeTaskEvents(
  currentEvents: readonly TaskEvent[],
  incomingEvents: readonly TaskEvent[],
): TaskEvent[] {
  const eventIds = new Set(currentEvents.map((event) => event.eventId));
  const mergedEvents = [...currentEvents];
  for (const event of incomingEvents) {
    if (eventIds.has(event.eventId)) continue;
    eventIds.add(event.eventId);
    mergedEvents.push(event);
  }
  return mergedEvents.sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}
