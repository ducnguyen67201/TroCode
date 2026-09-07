import { randomUUID } from 'node:crypto';

import {
  ClassroomLessonPlanSchema,
  LessonBindingSchema,
  type LessonDraft,
} from '../../shared/classroom-lesson-contracts';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import { lessonDigest, validateLessonContext } from './classroom-lesson-policy';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { KnowledgeSpaceRequestError } from './knowledge-http-client';

export class ClassroomLessonDraftService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const work = (this.locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn);
    this.locks.set(id, work);
    void work
      .finally(() => {
        if (this.locks.get(id) === work) this.locks.delete(id);
      })
      .catch(() => undefined);
    return work;
  }
  private readonly sends = new Map<string, Promise<LessonDraft>>();
  constructor(
    private readonly client: ClassroomLessonClient,
    private readonly store: ClassroomLessonStateStore,
    private readonly owner: () => Promise<string>,
  ) {}
  async prepare(bindingInput: unknown, planInput: unknown): Promise<LessonDraft> {
    const binding = LessonBindingSchema.parse(bindingInput);
    const plan = ClassroomLessonPlanSchema.parse(planInput);
    const ownerId = await this.owner();
    const context = await this.client.context(binding.spaceId, binding.sessionId, plan.targetRunId);
    validateLessonContext(plan, context);
    if (ownerId !== (await this.owner())) throw new Error('Account changed.');
    const draft: LessonDraft = {
      draftId: randomUUID(),
      ownerId,
      binding,
      plan,
      revision: 1,
      digest: lessonDigest(plan),
      state: 'prepared',
      receipt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    await this.store.saveDraft(draft);
    return draft;
  }
  async get(id: string): Promise<LessonDraft> {
    const owner = await this.owner();
    const draft = await this.store.readDraft(owner, id);
    if (!draft || draft.ownerId !== owner || lessonDigest(draft.plan) !== draft.digest)
      throw new Error('Lesson preview is unavailable.');
    return draft;
  }
  cancel(id: string): Promise<LessonDraft> {
    return this.serial(id, () => this.invalidate(id));
  }
  private async invalidate(id: string): Promise<LessonDraft> {
    const draft = await this.get(id);
    if (draft.state !== 'prepared') return draft;
    draft.state = 'stale';
    draft.revision++;
    await this.store.saveDraft(draft);
    return draft;
  }
  async recover() {
    return this.store.latestDraft(await this.owner());
  }
  confirm(id: string, revision: number, digest: string): Promise<LessonDraft> {
    const key = `${id}:${revision}:${digest}`;
    const existing = this.sends.get(key);
    if (existing) return existing;
    const work = this.serial(id, () => this.send(id, revision, digest)).finally(() => this.sends.delete(key));
    this.sends.set(key, work);
    return work;
  }
  private async send(id: string, revision: number, digest: string): Promise<LessonDraft> {
    const draft = await this.get(id);
    if (draft.revision !== revision || draft.digest !== digest) throw new Error('Review the current lesson preview.');
    if (draft.state === 'sent') return draft;
    if (draft.state !== 'prepared') throw new Error('Reconcile this lesson before sending another request.');
    if (Date.parse(draft.expiresAt) <= Date.now()) {
      draft.state = 'expired';
      await this.store.saveDraft(draft);
      throw new Error('Prepare a fresh lesson preview.');
    }
    validateLessonContext(
      draft.plan,
      await this.client.context(draft.binding.spaceId, draft.binding.sessionId, draft.plan.targetRunId),
    );
    const current = await this.get(id);
    if (current.state !== 'prepared' || current.revision !== revision) throw new Error('Lesson preview changed.');
    draft.state = 'sending';
    await this.store.saveDraft(draft);
    try {
      if ((await this.owner()) !== draft.ownerId) throw new Error('Account changed.');
      draft.receipt = await this.client.commit(draft.binding.spaceId, draft.binding.sessionId, id, draft.plan);
      draft.state = 'sent';
    } catch (error) {
      draft.state = error instanceof KnowledgeSpaceRequestError && error.status < 500 ? 'failed' : 'unknown';
      await this.store.saveDraft(draft);
      throw error;
    }
    await this.store.saveDraft(draft);
    return draft;
  }
  async reconcile(id: string): Promise<LessonDraft> {
    const draft = await this.get(id);
    if (!['unknown', 'sending'].includes(draft.state)) return draft;
    const result = await this.client.lookup(draft.binding.spaceId, draft.binding.sessionId, id);
    if (result.receipt) {
      if (result.receipt.lesson.planDigest !== draft.digest) throw new Error('Lesson receipt content mismatch.');
      draft.receipt = result.receipt;
      draft.state = 'sent';
    } else draft.state = 'unknown';
    await this.store.saveDraft(draft);
    return draft;
  }
}
