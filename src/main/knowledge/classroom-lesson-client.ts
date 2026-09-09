import { z } from 'zod';

import {
  ClassroomLessonPlanSchema,
  LessonBindingSchema,
  LessonClaimSchema,
  LessonContextSchema,
  LessonEnvelopeSchema,
  LessonFeedSchema,
  LessonMaterialSchema,
  LessonFileSchema,
  LessonProgressSchema,
  LessonReceiptSchema,
  LessonReportSchema,
  LessonStepClaimSchema,
  type ClassroomLessonPlan,
  type LessonReport,
} from '../../shared/classroom-lesson-contracts';

import type { KnowledgeHttpClient } from './knowledge-http-client';

const ok = z.object({ ok: z.literal(true) }).strict();
export class ClassroomLessonClient {
  private maxPlanVersion = 1;
  constructor(private readonly http: KnowledgeHttpClient) {}
  private base(space: string, session: string) {
    LessonBindingSchema.parse({ spaceId: space, sessionId: session });
    return `/v1/spaces/${space}/sessions/${session}`;
  }
  private anchor(anchor: string, lesson?: string) {
    z.uuid().parse(anchor);
    if (lesson) z.uuid().parse(lesson);
    return `/v1/attempts/${anchor}/session-lessons${lesson ? `/${lesson}` : ''}`;
  }
  private execution(execution: string) {
    return `/v1/lesson-executions/${z.uuid().parse(execution)}`;
  }
  private post(value: unknown): RequestInit {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
  }
  context(space: string, session: string, runId: string) {
    return this.http.request(
      `${this.base(space, session)}/lesson-context?runId=${z.uuid().parse(runId)}&maxPlanVersion=3`,
      {},
      LessonContextSchema,
    );
  }
  commit(space: string, session: string, clientId: string, plan: ClassroomLessonPlan) {
    return this.http.request(
      `${this.base(space, session)}/lessons`,
      this.post({ clientId: z.uuid().parse(clientId), plan: ClassroomLessonPlanSchema.parse(plan) }),
      LessonReceiptSchema,
    );
  }
  lookup(space: string, session: string, clientId: string) {
    return this.http.request(
      `${this.base(space, session)}/lessons/by-client/${z.uuid().parse(clientId)}`,
      {},
      z.object({ receipt: LessonReceiptSchema.nullable() }).strict(),
    );
  }
  stop(space: string, session: string, lesson: string) {
    return this.http.request(
      `${this.base(space, session)}/lessons/${z.uuid().parse(lesson)}/stop`,
      this.post({}),
      LessonEnvelopeSchema,
    );
  }
  progress(space: string, session: string, lesson: string, cursor?: string) {
    return this.http.request(
      `${this.base(space, session)}/lessons/${z.uuid().parse(lesson)}/progress${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      {},
      LessonProgressSchema,
    );
  }
  async feed(anchor: string, after?: number, signal?: AbortSignal) {
    const feed = await this.http.request(
      `${this.anchor(anchor)}?maxPlanVersion=3${after === undefined ? '' : `&afterSequence=${after}`}`,
      { signal },
      LessonFeedSchema,
    );
    this.maxPlanVersion = Math.min(3, feed.maxPlanVersion ?? 1);
    return feed;
  }
  file(anchor: string, lesson: string, resource: string, signal?: AbortSignal) {
    return this.http.request(`${this.anchor(anchor, lesson)}/resources/${z.uuid().parse(resource)}/file`, { signal }, LessonFileSchema);
  }
  device(anchor: string, clientInstanceId: string, build: string, ready: boolean) {
    return this.http.request(
      `/v1/attempts/${z.uuid().parse(anchor)}/lesson-device`,
      this.post({ clientInstanceId, build, ready, lessonsVersion: this.maxPlanVersion }),
      ok,
    );
  }
  receipt(anchor: string, lesson: string, report: LessonReport) {
    return this.http.request(`${this.anchor(anchor, lesson)}/receipt`, this.post(LessonReportSchema.parse(report)), ok);
  }
  start(anchor: string, lesson: string, clientStartId: string, clientInstanceId: string) {
    return this.http.request(
      `${this.anchor(anchor, lesson)}/starts`,
      this.post({ clientStartId, clientInstanceId }),
      LessonClaimSchema,
    );
  }
  lookupStart(anchor: string, lesson: string) {
    return this.http.request(
      `${this.anchor(anchor, lesson)}/start`,
      {},
      z.object({ claim: LessonClaimSchema.nullable() }).strict(),
    );
  }
  startStep(
    execution: string,
    step: string,
    input: { taskId: string; attemptNumber: number; purpose: 'work' | 'help' | 'check'; clientInstanceId: string },
  ) {
    return this.http.request(
      `${this.execution(execution)}/steps/${z.uuid().parse(step)}/starts`,
      this.post(input),
      LessonStepClaimSchema,
    );
  }
  lookupStep(execution: string, step: string, attemptNumber: number) {
    return this.http.request(
      `${this.execution(execution)}/steps/${z.uuid().parse(step)}/start?attemptNumber=${attemptNumber}`,
      {},
      z.object({ claim: LessonStepClaimSchema.nullable() }).strict(),
    );
  }
  report(execution: string, report: LessonReport) {
    return this.http.request(`${this.execution(execution)}/progress`, this.post(LessonReportSchema.parse(report)), ok);
  }
  status(execution: string) {
    return this.http.request(
      `${this.execution(execution)}/status`,
      {},
      z.object({ active: z.boolean(), serverTime: z.string(), planDigest: z.string() }).strict(),
    );
  }
  material(anchor: string, lesson: string, resource: string, ordinal = 0) {
    return this.http.request(
      `${this.anchor(anchor, lesson)}/resources/${z.uuid().parse(resource)}?ordinal=${ordinal}`,
      {},
      LessonMaterialSchema,
  LessonFileSchema,
    );
  }
}
