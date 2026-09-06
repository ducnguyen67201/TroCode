import type { BroadcastNotice, ClassroomBroadcast, CuaStatus, GuidanceState } from '../../shared/contracts';

export function defaultClassroomGuidanceConsent(notice: BroadcastNotice | null): GuidanceState['consent'] {
  if (!notice?.sessionId || notice.offline) return null;
  return { sessionId: notice.sessionId, enabled: true, contextMode: 'screen_if_permitted' };
}

export function canObserveClassroomExplanation(status: CuaStatus): boolean {
  if (status.state === 'error' || status.state === 'permission_required')
    return false;
  if (status.platform === 'darwin')
    return Boolean(
      status.permissions?.screenRecording && status.permissions.accessibility,
    );
  return (
    (status.platform === 'win32' || status.platform === 'linux') &&
    status.state === 'ready'
  );
}

export function canAutomaticallyExplain(input: {
  broadcast: ClassroomBroadcast;
  provenance: 'initial_snapshot' | 'live_delta';
  consentSessionId: string | null;
  consentEnabledAt: number;
  consentSequence: number;
  busy: boolean;
  now: number;
}): boolean {
  const { broadcast } = input;
  return (
    broadcast.payload.kind === 'assignment' &&
    broadcast.payload.studentAction === 'explain' &&
    input.provenance === 'live_delta' &&
    input.consentSessionId === broadcast.sessionId &&
    broadcast.sequence > input.consentSequence &&
    Date.parse(broadcast.createdAt) > input.consentEnabledAt &&
    !input.busy &&
    input.now < Date.parse(broadcast.createdAt) + 600_000
  );
}
export function pendingClassroomExplanations(
  current: ClassroomBroadcast[],
  next: ClassroomBroadcast,
): ClassroomBroadcast[] {
  if (
    next.payload.kind !== 'assignment' ||
    next.payload.studentAction !== 'explain'
  )
    return current;
  const runId = next.payload.targetRunId;
  return [
    ...current.filter(
      (b) => b.payload.kind !== 'assignment' || b.payload.targetRunId !== runId,
    ),
    next,
  ].slice(-5);
}

export function classroomExplanationQueue(
  current: ClassroomBroadcast[],
  next: ClassroomBroadcast,
  activeBroadcastId: string | null,
): { pending: ClassroomBroadcast[]; releaseIds: string[] } {
  const pending = pendingClassroomExplanations(current, next);
  const releaseIds = current
    .filter((broadcast) => broadcast.id !== activeBroadcastId &&
      !pending.some((item) => item.id === broadcast.id))
    .map((broadcast) => broadcast.id);
  return { pending, releaseIds };
}
