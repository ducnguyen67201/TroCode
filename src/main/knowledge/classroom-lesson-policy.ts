import { createHash } from 'node:crypto';

import {
  ClassroomLessonPlanSchema,
  type ClassroomLessonPlan,
  type LessonContext,
  type LessonLocalState,
  type LessonMode,
  type LessonStatus,
} from '../../shared/classroom-lesson-contracts';

export function rememberLessonResult(state: LessonLocalState, mode: LessonMode | 'help', question?: string): void {
  const step = state.envelope.plan.steps[state.stepIndex];
  if (!step) return;
  state.history = [...state.history, {
    stepId: step.id, resourceId: step.resourceId, mode,
    question: question?.slice(0, 2000) ?? null, text: state.text.slice(0, 4000),
  }].slice(-12);
}

export function finishMaterialStep(state: LessonLocalState, mode: 'open' | 'practice'): void {
  state.text = mode === 'open'
    ? (state.envelope.plan.language === 'vi' ? 'Tài liệu đã mở.' : 'Material opened.')
    : state.envelope.plan.steps[state.stepIndex]!.instruction;
  state.phase = mode === 'open' ? 'Material opened' : 'Your turn';
  state.child = null;
  rememberLessonResult(state, mode);
}

export function lessonRunningPhase(mode: LessonMode | 'help'): string {
  return {
    open: 'Opening material', explain: 'Explaining', demonstrate: 'Demonstrating',
    practice: 'Your turn', check: 'Checking your work', help: 'Helping',
  }[mode];
}

export function lessonDigest(value: ClassroomLessonPlan): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item !== null && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return createHash('sha256')
    .update(canonical(ClassroomLessonPlanSchema.parse(value)))
    .digest('hex');
}
export function validateLessonContext(plan: ClassroomLessonPlan, context: LessonContext): void {
  if (plan.schemaVersion > (context.maxPlanVersion ?? 1))
    throw new Error('The class server needs the material-opening update before this lesson can be sent.');
  if (
    plan.targetRunId !== context.targetRunId ||
    plan.activityVersionId !== context.activityVersionId ||
    context.launchTarget === 'workspace'
  )
    throw new Error('Select a supported published assignment.');
  for (const resource of plan.resources) {
    if (resource.kind === 'web' && !context.allowedOrigins.includes(resource.origin))
      throw new Error('Publish this material origin in the Activity first.');
    if (resource.kind === 'source_text' && !context.sources.some((s) => s.sourceVersionId === resource.sourceVersionId))
      throw new Error('Material is not pinned to this assignment.');
  }
  for (const step of plan.steps) {
    if (step.mode === 'demonstrate' && context.answerReveal !== 'allowed')
      throw new Error('This assignment restricts demonstration answers. Choose Explain.');
    if (step.criterionIds.some((id) => !context.criteria.some((c) => c.id === id)))
      throw new Error('Assignment criteria changed.');
  }
}
const transitions: Record<LessonStatus, readonly LessonStatus[]> = {
  received: ['preparing', 'blocked', 'paused', 'stopped', 'expired'],
  preparing: ['running', 'waiting_for_student', 'blocked', 'paused', 'failed', 'unknown', 'stopped', 'expired'],
  running: ['waiting_for_student', 'paused', 'blocked', 'failed', 'unknown', 'stopped', 'expired'],
  waiting_for_student: ['preparing', 'paused', 'stopped', 'expired', 'finished', 'blocked'],
  paused: ['preparing', 'stopped', 'expired', 'unknown', 'blocked'],
  blocked: ['preparing', 'stopped', 'expired', 'paused', 'unknown'],
  failed: ['stopped'],
  unknown: ['stopped'],
  stopped: [],
  expired: [],
  finished: [],
};
export function assertLessonTransition(from: LessonStatus, to: LessonStatus): void {
  if (from !== to && !transitions[from].includes(to)) throw new Error(`Lesson cannot move from ${from} to ${to}.`);
}
export function canAutoStartLesson(input: {
  live: boolean;
  consent: boolean;
  busy: boolean;
  active: boolean;
  serverTime: string;
  expiresAt: string;
}): boolean {
  return (
    input.live &&
    input.consent &&
    !input.busy &&
    input.active &&
    Date.parse(input.serverTime) < Date.parse(input.expiresAt)
  );
}

export function lessonReportSnapshot(state: LessonLocalState, reportId: string) {
  return {
    reportId,
    criterionOutcomes: state.feedback.map(({ criterionId, outcome }) => ({ criterionId, outcome })),
    revision: state.revision,
    stepId: state.envelope.plan.steps[state.stepIndex]?.id ?? null,
    status: state.status,
    reasonCode: state.reasonCode,
    actionCount: state.actionCount,
    modelRequestCount: state.modelRequestCount,
  };
}
