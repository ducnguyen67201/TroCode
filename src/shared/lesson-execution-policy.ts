import type { ClassroomLessonPlan, LessonMode } from './classroom-lesson-contracts';

/** Select execution without rewriting reviewed plans or expanding their grants. */
type ExecutionPlan = Pick<ClassroomLessonPlan, 'schemaVersion'> & Partial<Pick<ClassroomLessonPlan, 'resources' | 'steps'>>;

export function lessonUsesExternalMaterial(plan: ExecutionPlan, stepIndex = 0) {
  const step = plan.steps?.[stepIndex];
  return plan.schemaVersion === 3 || plan.resources?.some((resource) => resource.id === step?.resourceId && resource.kind === 'web') === true;
}

/** A requested capability still requires fresh local desktopControlConsent. */
export function lessonRequestsNavigation(plan: ExecutionPlan, stepIndex = 0) {
  const step = plan.steps?.[stepIndex];
  return step?.surface?.navigation === 'tro' ||
    (plan.schemaVersion < 3 && step?.mode === 'demonstrate' && lessonUsesExternalMaterial(plan, stepIndex));
}

export function lessonExecutionRoute(plan: ExecutionPlan, mode: LessonMode | 'help', stepIndex = 0) {
  if (mode === 'check') return 'coach' as const;
  if (lessonUsesExternalMaterial(plan, stepIndex)) return 'shared_agent' as const;
  if (mode === 'demonstrate') throw new Error('Demonstration requires external material.');
  if (mode === 'open' || mode === 'practice') return 'material_viewer' as const;
  return 'coach' as const;
}
