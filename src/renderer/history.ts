import type {
  Capability,
  InteractionMode,
  TaskEvent,
  TaskPhase,
  TaskSnapshot,
} from '../shared/contracts';

const TERMINAL_PHASES = new Set<TaskPhase>([
  'completed',
  'failed',
  'cancelled',
]);

export interface HistoryEntry {
  capabilities: Capability[];
  events: TaskEvent[];
  interactionMode: InteractionMode | null;
  objective: string;
  phase: 'completed' | 'failed' | 'cancelled';
  progress: TaskSnapshot['progress'];
  snapshot: TaskSnapshot;
  updatedAt: string;
}

export function createHistoryEntries(
  snapshots: readonly TaskSnapshot[],
  events: readonly TaskEvent[],
): HistoryEntry[] {
  const snapshotsByTaskId = new Map<string, TaskSnapshot>();
  for (const snapshot of snapshots) {
    snapshotsByTaskId.set(snapshot.taskId, snapshot);
  }

  const eventsByTaskId = new Map<string, Map<string, TaskEvent>>();
  for (const event of events) {
    const taskEvents = eventsByTaskId.get(event.taskId) ?? new Map();
    taskEvents.set(event.eventId, event);
    eventsByTaskId.set(event.taskId, taskEvents);
  }

  return [...snapshotsByTaskId.values()]
    .filter(
      (
        snapshot,
      ): snapshot is TaskSnapshot & {
        phase: HistoryEntry['phase'];
      } => TERMINAL_PHASES.has(snapshot.phase),
    )
    .map((snapshot) => ({
      capabilities: snapshot.goal?.capabilities ?? [],
      events: [...(eventsByTaskId.get(snapshot.taskId)?.values() ?? [])].sort(
        (left, right) => left.timestamp.localeCompare(right.timestamp),
      ),
      interactionMode: snapshot.goal?.interactionMode ?? null,
      objective: snapshot.goal?.objective ?? snapshot.request,
      phase: snapshot.phase,
      progress: snapshot.progress,
      snapshot,
      updatedAt: snapshot.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
