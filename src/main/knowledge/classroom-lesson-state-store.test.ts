import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { LessonDraft } from '../../shared/classroom-lesson-contracts';

import { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { lessonFixture } from './classroom-lesson.fixture';

vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, safeStorage: {} }));
describe('encrypted lesson journals', () => {
  it('round trips validated owner-scoped drafts with atomic encrypted writes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tro-lesson-'));
    const cipher = {
      isAvailable: async () => true,
      encrypt: async (s: string) => Buffer.from([...s].reverse().join('')),
      decrypt: async (b: Buffer) => [...b.toString()].reverse().join(''),
    };
    const store = new ClassroomLessonStateStore(dir, cipher);
    const f = lessonFixture();
    const draft: LessonDraft = {
      draftId: f.envelope.lessonId,
      ownerId: 'teacher',
      binding: { spaceId: f.plan.targetRunId, sessionId: f.context.sessionId },
      revision: 1,
      plan: f.plan,
      digest: f.envelope.planDigest,
      expiresAt: f.envelope.expiresAt,
      state: 'unknown',
      receipt: null,
    };
    try {
      await store.saveDraft(draft);
      expect(await store.readDraft('teacher', draft.draftId)).toEqual(draft);
      expect(await store.readDraft('other-owner', draft.draftId)).toBeNull();
      const folder = path.join(dir, createHash('sha256').update('teacher').digest('hex'), 'drafts');
      expect(await readdir(folder)).toEqual([`${draft.draftId}.enc`]);
      expect(await readFile(path.join(folder, `${draft.draftId}.enc`), 'utf8')).not.toContain(draft.plan.objective);
      const restarted = new ClassroomLessonStateStore(dir, cipher);
      expect((await restarted.readDraft('teacher', draft.draftId))?.state).toBe('unknown');
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('fails closed when OS encryption is unavailable', async () => {
    const f = lessonFixture();
    const store = new ClassroomLessonStateStore('/unused', {
      isAvailable: async () => false,
      encrypt: vi.fn(),
      decrypt: vi.fn(),
    });
    await expect(
      store.saveDraft({
        draftId: f.envelope.lessonId,
        ownerId: 'teacher',
        binding: { spaceId: f.plan.targetRunId, sessionId: f.context.sessionId },
        revision: 1,
        plan: f.plan,
        digest: f.envelope.planDigest,
        expiresAt: f.envelope.expiresAt,
        state: 'prepared',
        receipt: null,
      }),
    ).rejects.toThrow('encryption');
  });
});
