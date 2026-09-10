import {
  LessonExecutionContextSchema,
  LessonResourceExcerptSchema,
  type LessonMaterial,
  type LessonExecutionContext,
  type LessonLocalState,
} from '../../shared/contracts';

/** Independent of screen state: the agent needs its goal even when opening fails. */
export function lessonExecutionContext(
  state: LessonLocalState,
  mode: LessonExecutionContext['mode'],
): LessonExecutionContext {
  const step = state.envelope.plan.steps[state.stepIndex];
  if (!step) throw new Error('Lesson step is unavailable.');
  const resource = state.envelope.plan.resources.find((item) => item.id === step.resourceId);
  if (!resource) throw new Error('Lesson resource is unavailable.');
  const material = state.material;
  if (material && (material.resource.id !== resource.id || material.resource.kind !== resource.kind ||
      (resource.kind === 'source_text' && material.resource.kind === 'source_text' && material.resource.sourceVersionId !== resource.sourceVersionId)))
    throw new Error('Lesson material does not match the current step.');
  const content = [material?.text, ...(material?.chunks.map((chunk) => chunk.body) ?? [])]
    .filter(Boolean).join('\n');
  return LessonExecutionContextSchema.parse({
    version: 1,
    lessonId: state.envelope.lessonId,
    step,
    mode,
    language: state.envelope.plan.language,
    resource: {
      handle: resource.id,
      title: resource.title,
      kind: resource.kind,
      content: content.slice(0, 16000),
      contentTrust: 'untrusted',
      truncated: content.length > 16000 || material?.nextOrdinal != null,
      nextOrdinal: material?.nextOrdinal ?? null,
      nextOffset: content.length > 16000 ? 16000 : null,
    },
    history: state.history.slice(-4).map((entry) => ({ ...entry, text: entry.text.slice(0, 1500) })),
    controlConsent: state.desktopControlConsent,
    maxModelTurns: state.childModelLimit,
  });
}

/** Offsets page within a response; ordinals request the next backend chunk page. */
export function lessonResourceExcerpt(material: LessonMaterial, handle: string, ordinal: number | null, offset: number) {
  if (material.resource.id !== handle) throw new Error('Lesson material does not match the current step.');
  const content = [material.text, ...material.chunks.map((chunk) => chunk.body)].filter(Boolean).join('\n');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length)
    throw new Error('Resource offset is outside this page.');
  return LessonResourceExcerptSchema.parse({
    handle, ordinal, content: content.slice(offset, offset + 16000), contentTrust: 'untrusted',
    nextOffset: offset + 16000 < content.length ? offset + 16000 : null,
    nextOrdinal: material.nextOrdinal,
  });
}
