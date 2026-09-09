import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { LessonDraft } from '../../shared/classroom-lesson-contracts';

import { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { lessonFixture, lessonStateFixture } from './classroom-lesson.fixture';

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
      expect(await store.readConsent('student', draft.draftId)).toBeNull();
      await store.saveConsent('student', draft.draftId, false);
      expect(await restarted.readConsent('student', draft.draftId)).toBe(false);
      expect(await restarted.readConsent('other-owner', draft.draftId)).toBeNull();
      expect(await restarted.readConsent('student', f.context.sessionId)).toBeNull();
      await store.saveConsent('student', draft.draftId, true);
      expect(await restarted.readConsent('student', draft.draftId)).toBe(true);
      const lesson = lessonStateFixture();
      lesson.history = [{ stepId: lesson.envelope.plan.steps[0]!.id, resourceId: lesson.material!.resource.id,
        mode: 'help', question: 'What does input return?', text: 'A string.' }];
      await store.saveLesson(lesson);
      expect((await restarted.readLesson('student', lesson.envelope.lessonId))?.history).toEqual(lesson.history);
      expect(await restarted.readLesson('other-owner', lesson.envelope.lessonId)).toBeNull();
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

it('keeps original paths in a separate encrypted owner-scoped record', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tro-native-record-'));
  const cipher = { isAvailable: async () => true, encrypt: async (s: string) => Buffer.from(s), decrypt: async (b: Buffer) => b.toString() };
  const store = new ClassroomLessonStateStore(dir, cipher);
  const f = lessonFixture();
  try {
    const record = { path: '/private/student/python.pdf', sha256: 'a'.repeat(64), status: 'dispatching' as const };
    await store.saveNativeMaterial('student', f.envelope.lessonId, f.resource.id, record);
    expect(await store.readNativeMaterial('student', f.envelope.lessonId, f.resource.id)).toEqual(record);
    expect(await store.readNativeMaterial('other', f.envelope.lessonId, f.resource.id)).toBeNull();
    expect(await store.readLesson('student', f.envelope.lessonId)).toBeNull();
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
