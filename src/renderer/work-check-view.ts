import type { TaskSnapshot } from '../shared/contracts';

export function latestCheckForAttempt(
  snapshots: readonly TaskSnapshot[],
  attemptId: string,
  activityVersionId: string,
): TaskSnapshot | null {
  return (
    snapshots
      .filter((snapshot) => {
        const activity = snapshot.goal?.activity;
        return (
          activity?.purpose === 'check' &&
          activity.attemptId === attemptId &&
          activity.activityVersionId === activityVersionId
        );
      })
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          b.taskId.localeCompare(a.taskId),
      )[0] ?? null
  );
}
