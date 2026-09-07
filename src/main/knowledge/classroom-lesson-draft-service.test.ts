import { describe, expect, it, vi } from 'vitest';

import type { LessonDraft } from '../../shared/classroom-lesson-contracts';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import { ClassroomLessonDraftService } from './classroom-lesson-draft-service';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { lessonFixture } from './classroom-lesson.fixture';

function fixture() {
  const f = lessonFixture();
  const values = new Map<string, LessonDraft>();
  const store = {
    saveDraft: vi.fn(async (draft: LessonDraft) => {
      values.set(draft.draftId, structuredClone(draft));
    }),
    readDraft: vi.fn(async (_owner: string, id: string) => values.get(id)),
  };
  const client = {
    context: vi.fn(async () => f.context),
    commit: vi.fn(async (_space: string, _session: string, clientId: string) => ({
      clientId,
      lesson: f.envelope,
      newlyCreated: true,
    })),
    lookup: vi.fn(async () => ({
      receipt: null as { clientId: string; lesson: typeof f.envelope; newlyCreated: boolean } | null,
    })),
  };
  const drafts = new ClassroomLessonDraftService(
    client as unknown as ClassroomLessonClient,
    store as unknown as ClassroomLessonStateStore,
    async () => 'teacher',
  );
  return { ...f, drafts, client, store };
}
describe('reviewed lesson commit', () => {
  it('prepares without sending and deduplicates concurrent confirmation', async () => {
    const f = fixture();
    const draft = await f.drafts.prepare({ spaceId: f.plan.targetRunId, sessionId: f.context.sessionId }, f.plan);
    expect(f.client.commit).not.toHaveBeenCalled();
    await Promise.all([
      f.drafts.confirm(draft.draftId, draft.revision, draft.digest),
      f.drafts.confirm(draft.draftId, draft.revision, draft.digest),
    ]);
    expect(f.client.commit).toHaveBeenCalledOnce();
    expect((await f.drafts.get(draft.draftId)).state).toBe('sent');
  });
  it('keeps an uncertain send durable and only reconciles by reading', async () => {
    const f = fixture();
    const draft = await f.drafts.prepare({ spaceId: f.plan.targetRunId, sessionId: f.context.sessionId }, f.plan);
    f.client.commit.mockRejectedValueOnce(new Error('Response lost'));
    await expect(f.drafts.confirm(draft.draftId, draft.revision, draft.digest)).rejects.toThrow();
    expect((await f.drafts.get(draft.draftId)).state).toBe('unknown');
    await expect(f.drafts.confirm(draft.draftId, draft.revision, draft.digest)).rejects.toThrow('Reconcile');
    f.client.lookup.mockResolvedValueOnce({
      receipt: { clientId: draft.draftId, lesson: f.envelope, newlyCreated: false },
    });
    expect((await f.drafts.reconcile(draft.draftId)).state).toBe('sent');
    expect(f.client.commit).toHaveBeenCalledOnce();
  });
});

it('invalidates a prepared preview before an old confirmation can dispatch', async () => {
  const f = fixture();
  const draft = await f.drafts.prepare({ spaceId: f.plan.targetRunId, sessionId: f.context.sessionId }, f.plan);
  await f.drafts.cancel(draft.draftId);
  await expect(f.drafts.confirm(draft.draftId, draft.revision, draft.digest)).rejects.toThrow('current lesson');
  expect(f.client.commit).not.toHaveBeenCalled();
});
