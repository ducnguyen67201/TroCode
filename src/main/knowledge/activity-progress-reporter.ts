import type { TaskUpdate } from '../../shared/contracts';
import { isTaskPhaseTerminal } from '../../shared/task-lifecycle';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

interface Session {
  workSessionId: string;
  lastSentAt: number;
  lastState: string | null;
  queue: Promise<void>;
  unknown: boolean;
  generation: number;
}
export class ActivityProgressReporter {
  private generation = 0;
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly client: Pick<KnowledgeSpaceClient, 'updateWorkSession'>,
    private readonly now: () => number = Date.now,
    private readonly onSync: (
      taskId: string,
      state: 'pending' | 'synced' | 'unknown',
    ) => void = () => undefined,
  ) {}
  bind(taskId: string, workSessionId: string): void {
    this.sessions.set(taskId, {
      workSessionId,
      lastSentAt: 0,
      lastState: null,
      queue: Promise.resolve(),
      unknown: false,
      generation: this.generation,
    });
  }
  async fail(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    this.sessions.delete(taskId);
    await this.send(taskId, session, 'failed');
  }
  clear(): void {
    this.generation++;
    for (const session of this.sessions.values()) session.unknown = true;
    this.sessions.clear();
  }
  async report(update: TaskUpdate): Promise<void> {
    const taskId = update.snapshot.taskId;
    const session = this.sessions.get(taskId);
    if (!session || session.unknown) return;
    const terminal =
      update.snapshot.lifecycle?.terminal ??
      isTaskPhaseTerminal(update.snapshot.phase);
    const state =
      update.snapshot.phase === 'completed'
        ? 'completed'
        : update.snapshot.phase === 'cancelled'
          ? 'cancelled'
          : update.snapshot.phase === 'failed'
            ? 'failed'
            : update.snapshot.phase === 'blocked'
              ? 'paused'
              : 'active';
    const now = this.now();
    if (
      state === session.lastState ||
      (!terminal && session.lastState && now - session.lastSentAt < 10_000)
    )
      return;
    session.lastSentAt = now;
    session.lastState = state;
    if (terminal) this.sessions.delete(taskId);
    await this.send(taskId, session, state);
  }
  private send(taskId: string, session: Session, state: string): Promise<void> {
    const operation = session.queue.then(async () => {
      if (session.unknown || session.generation !== this.generation) return;
      this.onSync(taskId, 'pending');
      try {
        await this.client.updateWorkSession(session.workSessionId, { state });
        if (session.generation === this.generation)
          this.onSync(taskId, 'synced');
      } catch {
        session.unknown = true;
        if (session.generation === this.generation)
          this.onSync(taskId, 'unknown');
        // A lost mutation response cannot be replayed or followed by stale reports.
      }
    });
    session.queue = operation;
    return operation;
  }
}
