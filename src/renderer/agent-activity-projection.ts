import type { AgentActivityUpdate } from '../shared/contracts';

/** Accepts only monotonic activity for the active task; provider events never pick a task. */
export function acceptAgentActivity(
  activity: AgentActivityUpdate,
  activeTaskId: string | null,
  sequences: Map<string, number>,
): boolean {
  if (!activeTaskId || activeTaskId !== activity.taskId) return false;
  const previousSequence = sequences.get(activity.taskId) ?? -1;
  if (activity.sequence <= previousSequence) return false;
  sequences.set(activity.taskId, activity.sequence);
  return true;
}
