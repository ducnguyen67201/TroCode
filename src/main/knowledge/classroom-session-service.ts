import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  ClassroomSessionProjectionSchema,
  type ClassroomDirective,
  type ClassroomSessionProjection,
  type JoinClassroomSessionRequest,
  type KnowledgeClassroomSession,
} from '../../shared/contracts';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ClassroomSessionService {
  private readonly events = new EventEmitter();
  lessonConsent(): boolean { return this.current?.autoOpenConsent ?? false; }
  private current: ClassroomSessionProjection | null = null;

  constructor(private readonly client: Pick<KnowledgeSpaceClient, 'getCurrentClassroomSession' | 'joinRoom' | 'leaveClassroom'>) {}

  get(): ClassroomSessionProjection | null {
    return this.current ? ClassroomSessionProjectionSchema.parse(this.current) : null;
  }

  activeStudentAttemptId(): string | null {
    const current = this.current;
    if (
      !current ||
      current.leftAt ||
      current.run.state !== 'open' ||
      ['submitted', 'completed', 'withdrawn'].includes(current.attemptState)
    ) return null;
    return current.attemptId;
  }

  latestDirective(): ClassroomDirective | null {
    return this.current?.currentDirective ?? null;
  }

  async join(input: JoinClassroomSessionRequest): Promise<ClassroomSessionProjection> {
    const { autoOpenConsent, ...joinRequest } = input;
    const session = await this.client.joinRoom(joinRequest);
    const consent = autoOpenConsent ?? (
      this.current?.attemptId === session.attemptId
        ? this.current.autoOpenConsent
        : true
    );
    return this.activate(session, consent);
  }

  async restore(): Promise<ClassroomSessionProjection | null> {
    const session = await this.client.getCurrentClassroomSession();
    if (!session) {
      this.clear();
      return null;
    }
    const consent = this.current?.attemptId === session.attemptId
      ? this.current.autoOpenConsent
      : true;
    return this.activate(session, consent);
  }

  activate(session: KnowledgeClassroomSession, autoOpenConsent = true): ClassroomSessionProjection {
    this.current = ClassroomSessionProjectionSchema.parse({ ...session, role: 'student', autoOpenConsent });
    this.emit();
    return this.get()!;
  }

  setAutoOpenConsent(consent: boolean): ClassroomSessionProjection | null {
    if (!this.current) return null;
    this.current = ClassroomSessionProjectionSchema.parse({ ...this.current, autoOpenConsent: consent });
    this.emit();
    return this.get();
  }

  updateRunState(state: 'draft' | 'open' | 'closed' | 'archived'): void {
    if (!this.current || this.current.run.state === state) return;
    this.current = ClassroomSessionProjectionSchema.parse({
      ...this.current,
      run: { ...this.current.run, state, status: state === 'draft' ? 'lobby' : state === 'open' ? 'live' : 'ended' },
    });
    this.emit();
  }

  updateAttemptState(state: KnowledgeClassroomSession['attemptState']): void {
    if (!this.current || this.current.attemptState === state) return;
    this.current = ClassroomSessionProjectionSchema.parse({
      ...this.current,
      attemptState: state,
    });
    this.emit();
  }

  setCurrentDirective(directive: ClassroomDirective): void {
    if (!this.current || directive.sequence < (this.current.currentDirective?.sequence ?? 0)) return;
    this.current = ClassroomSessionProjectionSchema.parse({ ...this.current, currentDirective: directive });
    this.emit();
  }

  async leave(): Promise<void> {
    const current = this.current;
    if (!current) return;
    await this.client.leaveClassroom(current.attemptId, randomUUID());
    if (this.current?.attemptId === current.attemptId) this.clear();
  }

  clear(): void {
    if (!this.current) return;
    this.current = null;
    this.emit();
  }

  onChange(listener: (session: ClassroomSessionProjection | null) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  private emit(): void {
    this.events.emit('change', this.get());
  }
}
