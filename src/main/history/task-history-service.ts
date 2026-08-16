import {
  TaskHistorySchema,
  TaskUpdateSchema,
  type TaskHistory,
} from '../../shared/contracts';

import type { TaskHistoryStore } from './task-history-store';

const SESSION_ONLY_HISTORY: TaskHistory = TaskHistorySchema.parse({
  events: [],
  persistence: {
    mode: 'session_only',
    summary: 'Set DATABASE_URL to save task history across app restarts.',
  },
  snapshots: [],
});

export interface TaskHistoryServiceOptions {
  onError?(error: unknown): void;
  store: TaskHistoryStore | null;
}

export class TaskHistoryService {
  private available = false;
  private currentOwnerId: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: TaskHistoryServiceOptions) {}

  async start(): Promise<void> {
    if (!this.options.store) return;

    try {
      await this.options.store.initialize();
      this.available = true;
    } catch (error) {
      this.available = false;
      this.options.onError?.(error);
    }
  }

  setCurrentOwner(ownerId: string | null): void {
    this.currentOwnerId = ownerId;
  }

  readonly recordTaskUpdate = (input: unknown): void => {
    const ownerId = this.currentOwnerId;
    const store = this.options.store;
    if (!ownerId || !store || !this.available) return;

    const update = TaskUpdateSchema.safeParse(input);
    if (!update.success) {
      this.options.onError?.(update.error);
      return;
    }

    const write = this.writeQueue.then(() => store.save(ownerId, update.data));
    this.writeQueue = write.catch((error: unknown) => {
      this.options.onError?.(error);
    });
  };

  async load(ownerId: string): Promise<TaskHistory> {
    const store = this.options.store;
    if (!store || !this.available) return SESSION_ONLY_HISTORY;

    await this.writeQueue;
    try {
      return await store.load(ownerId);
    } catch (error) {
      this.options.onError?.(error);
      return TaskHistorySchema.parse({
        ...SESSION_ONLY_HISTORY,
        persistence: {
          mode: 'session_only',
          summary: 'PostgreSQL is unavailable; this session is not durable.',
        },
      });
    }
  }

  async shutdown(): Promise<void> {
    await this.writeQueue;
    if (!this.options.store) return;

    try {
      await this.options.store.close();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.available = false;
    }
  }
}

