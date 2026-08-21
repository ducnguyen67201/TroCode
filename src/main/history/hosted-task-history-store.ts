import {
  TaskHistorySchema,
  type TaskHistory,
  type TaskUpdate,
} from '../../shared/contracts';
import type { HostedTaskClient } from '../application/hosted-task-client';

import type { TaskHistoryStore } from './task-history-store';

export class HostedTaskHistoryStore implements TaskHistoryStore {
  constructor(
    private readonly client: Pick<HostedTaskClient, 'list'>,
    private readonly project: (run: Awaited<ReturnType<HostedTaskClient['list']>>[number]) => TaskHistory['snapshots'][number],
  ) {}

  async initialize(): Promise<void> {}

  async save(ownerId: string, update: TaskUpdate): Promise<void> {
    void ownerId;
    void update;
    // Backend events are already durable. The desktop never writes a second copy.
  }

  async load(ownerId: string): Promise<TaskHistory> {
    void ownerId;
    const snapshots = (await this.client.list()).map(this.project);
    return TaskHistorySchema.parse({
      events: [],
      persistence: {
        mode: 'postgres',
        summary: 'Task history is stored by the authenticated TroCode backend.',
      },
      snapshots,
    });
  }

  async close(): Promise<void> {}
}
