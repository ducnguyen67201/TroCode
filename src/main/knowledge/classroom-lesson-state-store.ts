import { app } from 'electron';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  LessonDraftSchema,
  LessonLocalStateSchema,
  type LessonDraft,
  type LessonLocalState,
} from '../../shared/classroom-lesson-contracts';
import { atomicWrite, operatingSystemCipher, type AgentStateCipher } from '../agent-runtime/agent-state-cipher';

export class ClassroomLessonStateStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly base = path.join(app.getPath('userData'), 'classroom-lessons'),
    private readonly cipher: AgentStateCipher = operatingSystemCipher,
  ) {}
  private target(owner: string, kind: string, id: string) {
    z.uuid().parse(id);
    return path.join(this.base, createHash('sha256').update(owner).digest('hex'), kind, `${id}.enc`);
  }
  private async read<T>(owner: string, kind: string, id: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const bytes = await readFile(this.target(owner, kind, id), 'utf8');
      return schema.parse(JSON.parse(await this.cipher.decrypt(Buffer.from(bytes, 'base64'))));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }
  private save(owner: string, kind: string, id: string, value: unknown): Promise<void> {
    const work = this.queue.then(async () => {
      if (!(await this.cipher.isAvailable())) throw new Error('Operating-system encryption is unavailable.');
      const encrypted = await this.cipher.encrypt(JSON.stringify(value));
      await atomicWrite(this.target(owner, kind, id), encrypted.toString('base64'));
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  saveLesson(state: LessonLocalState) {
    return this.save(state.ownerId, 'lessons', state.envelope.lessonId, LessonLocalStateSchema.parse(state));
  }
  async readConsent(owner: string, anchor: string): Promise<boolean | null> {
    const saved = await this.read(owner, 'preferences', anchor, z.object({ enabled: z.boolean() }).strict());
    return saved?.enabled ?? null;
  }
  saveConsent(owner: string, anchor: string, enabled: boolean): Promise<void> {
    return this.save(owner, 'preferences', anchor, { enabled });
  }
  readLesson(owner: string, id: string) {
    return this.read(owner, 'lessons', id, LessonLocalStateSchema);
  }
  saveDraft(draft: LessonDraft) {
    return this.save(draft.ownerId, 'drafts', draft.draftId, LessonDraftSchema.parse(draft));
  }
  readDraft(owner: string, id: string) {
    return this.read(owner, 'drafts', id, LessonDraftSchema);
  }
  async latest(owner: string, anchor: string): Promise<LessonLocalState | null> {
    const folder = path.dirname(this.target(owner, 'lessons', '00000000-0000-4000-8000-000000000000'));
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
    const states: LessonLocalState[] = [];
    for (const name of names.filter((n) => n.endsWith('.enc'))) {
      const state = await this.readLesson(owner, name.slice(0, -4));
      if (
        state?.ownerId === owner &&
        state.anchorAttemptId === anchor &&
        !['finished', 'stopped', 'expired'].includes(state.status)
      )
        states.push(state);
    }
    return states.sort((a, b) => b.envelope.sequence - a.envelope.sequence)[0] ?? null;
  }
  async latestDraft(owner: string): Promise<LessonDraft | null> {
    const folder = path.dirname(this.target(owner, 'drafts', '00000000-0000-4000-8000-000000000000'));
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
    const drafts: LessonDraft[] = [];
    for (const name of names.filter((n) => n.endsWith('.enc'))) {
      const draft = await this.readDraft(owner, name.slice(0, -4));
      if (draft?.ownerId === owner && ['prepared', 'sending', 'unknown', 'sent'].includes(draft.state))
        drafts.push(draft);
    }
    return drafts.sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0] ?? null;
  }
  async close() {
    await this.queue;
  }
}
