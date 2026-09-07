import { z } from 'zod';

import { objectSchema } from '../../shared/agent-tool-contracts';
import { ClassroomLessonPlanSchema } from '../../shared/classroom-lesson-contracts';
import type { RuntimeToolExecutionAdapter } from '../agent/runtime-tool-dispatcher';
import type { RuntimeToolDefinition } from '../agent/runtime-tool-registry';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import type { ClassroomLessonDraftService } from './classroom-lesson-draft-service';
import type { ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';

const completed = z
  .object({
    observationId: z.uuid(),
    observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    summary: z.string().min(1).max(500),
  })
  .strict();
export function lessonToolDefinitions(): RuntimeToolDefinition[] {
  return [
    {
      id: 'classroom.lesson-context',
      modelName: 'get_classroom_lesson_context',
      operations: ['read'],
      description:
        'Get published criteria, allowed material origins, pinned source IDs and lesson plan schema for an assignment in the bound session. List session assignments first. Never invent a material URL.',
      available: (context) => Boolean(context?.teacherClassroom) && !context?.activity,
      parameters: objectSchema({ runId: { type: 'string', format: 'uuid' } }, ['runId']),
      parse: (json) => z.object({ runId: z.uuid() }).strict().parse(JSON.parse(json)),
      normalize: (input, call, context) => ({
        callId: call.callId,
        input: { parameters: input, binding: context.teacherClassroom },
        kind: 'direct',
        modelName: call.name,
        operation: 'read',
        toolId: 'classroom.lesson-context',
      }),
    },
    {
      id: 'classroom.lesson-step',
      modelName: 'complete_lesson_step',
      operations: ['complete'],
      description:
        'Report the demonstrated example complete only after observing its expected result. This never submits student work or assigns a grade.',
      available: (context) => Boolean(context?.lesson),
      parameters: objectSchema(
        {
          observationId: { type: 'string' },
          observationFingerprint: { type: 'string' },
          summary: { type: 'string', maxLength: 500 },
        },
        ['observationId', 'observationFingerprint', 'summary'],
      ),
      parse: (json) => completed.parse(JSON.parse(json)),
      normalize: (input, call) => ({
        callId: call.callId,
        input,
        kind: 'direct',
        modelName: call.name,
        operation: 'complete',
        toolId: 'classroom.lesson-step',
      }),
    },
    {
      id: 'classroom.lesson-prepare',
      modelName: 'prepare_classroom_lesson',
      operations: ['prepare'],
      description:
        'Prepare a teacher-reviewed lesson preview. List session assignments and obtain lesson context first. planJson is a strict ClassroomLessonPlan v1 semantic plan with resources and explain/demonstrate/practice/check steps; no tool commands. This cannot broadcast. The teacher must review and confirm in the lesson panel.',
      available: (context) => Boolean(context?.teacherClassroom) && !context?.activity,
      parameters: objectSchema({ planJson: { type: 'string', maxLength: 65_536 } }, ['planJson']),
      parse: (json) =>
        ClassroomLessonPlanSchema.parse(
          JSON.parse(
            z
              .object({ planJson: z.string().max(65_536) })
              .strict()
              .parse(JSON.parse(json)).planJson,
          ),
        ),
      normalize: (input, call, context) => ({
        callId: call.callId,
        input: { plan: input, binding: context.teacherClassroom },
        kind: 'direct',
        modelName: call.name,
        operation: 'prepare',
        toolId: 'classroom.lesson-prepare',
      }),
    },
  ];
}
export function lessonToolAdapters(
  policy: ClassroomLessonToolPolicy,
  drafts: ClassroomLessonDraftService,
  client: ClassroomLessonClient,
  prepared: (draftId: string) => void,
): RuntimeToolExecutionAdapter[] {
  return [
    {
      id: 'classroom.lesson-context',
      async execute(invocation, context) {
        const input = invocation.input as {
          parameters: { runId: string };
          binding: { spaceId: string; sessionId: string };
        };
        context.signal.throwIfAborted();
        const catalogue = await client.context(input.binding.spaceId, input.binding.sessionId, input.parameters.runId);
        return {
          status: 'confirmed',
          summary: 'Loaded lesson materials and modes.',
          data: { catalogue, planSchema: z.toJSONSchema(ClassroomLessonPlanSchema, { unrepresentable: 'any' }) },
        };
      },
    },
    {
      id: 'classroom.lesson-step',
      async execute(invocation, context) {
        const input = completed.parse(invocation.input);
        context.signal.throwIfAborted();
        policy.complete(context.taskId, input.observationId, input.observationFingerprint);
        return { status: 'confirmed', summary: input.summary };
      },
    },
    {
      id: 'classroom.lesson-prepare',
      async execute(invocation, context) {
        const input = invocation.input as { plan: unknown; binding: { spaceId: string; sessionId: string } };
        context.signal.throwIfAborted();
        const draft = await drafts.prepare(
          { spaceId: input.binding.spaceId, sessionId: input.binding.sessionId },
          input.plan,
        );
        context.signal.throwIfAborted();
        prepared(draft.draftId);
        return {
          status: 'confirmed',
          summary: 'Lesson preview ready for teacher review.',
          data: { draftId: draft.draftId },
        };
      },
    },
  ];
}
