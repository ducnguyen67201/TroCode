import type { TaskUpdate } from '../../shared/contracts';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export class ActivityProgressReporter {
  private readonly sessions = new Map<string, { workSessionId: string; lastSentAt: number }>();

  constructor(private readonly client: Pick<KnowledgeSpaceClient, 'updateWorkSession'>, private readonly now: () => number = Date.now) {}

  bind(taskId: string, workSessionId: string): void {
    this.sessions.set(taskId, { workSessionId, lastSentAt: 0 });
  }

  clear(): void { this.sessions.clear(); }

  async report(update: TaskUpdate): Promise<void> {
    const session = this.sessions.get(update.snapshot.taskId);
    if (!session) return;
    const terminal = TERMINAL.has(update.snapshot.phase);
    const now = this.now();
    if (!terminal && now - session.lastSentAt < 10_000) return;
    session.lastSentAt = now;
    const state = update.snapshot.phase === 'completed'
      ? 'completed'
      : update.snapshot.phase === 'cancelled'
        ? 'cancelled'
        : update.snapshot.phase === 'failed' || update.snapshot.phase === 'blocked'
          ? 'failed'
          : 'active';
    try {
      await this.client.updateWorkSession(session.workSessionId, { state });
      if (terminal) this.sessions.delete(update.snapshot.taskId);
    } catch {
      // Local task execution remains authoritative. The renderer can show delayed sync
      // from hosted Attempt state without persisting private task content locally.
    }
  }
}
