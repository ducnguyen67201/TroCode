import { app } from 'electron';
import { createHash } from 'node:crypto';
import {
  chmod, mkdir, open, readdir, readFile, stat, truncate, writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { ZodType } from 'zod';

import {
  LocalGuidanceStartJournalSchema,
  TaskHistorySchema,
  TaskUpdateSchema,
  type CoachProgress,
  type LocalGuidanceStartJournal,
  type TaskHistory,
  type TaskSnapshot,
  type TaskUpdate,
} from '../../shared/contracts';
import type { TaskHistoryStore } from '../history/task-history-store';

import {
  atomicWrite,
  operatingSystemCipher,
  type AgentStateCipher,
} from './agent-state-cipher';
import {
  LocalEventFrameSchema,
  LocalInvocationJournalSchema,
  LocalInvocationSchema,
  LocalThreadIndexSchema,
  LocalThreadStateSchema,
  type LocalCheckpoint,
  type LocalInvocation,
  type LocalInvocationJournal,
  type LocalThreadIndex,
  type LocalThreadState,
} from './local-agent-state';
import { exists, stableJson } from './state-store-values';

export type { AgentStateCipher } from './agent-state-cipher';








const EMPTY_INDEX = { schemaVersion: 1 as const, threads: [] };
const EMPTY_JOURNAL = { schemaVersion: 1 as const, records: [] };
const EVENT_COMPACTION_COUNT = 1_000;
const EVENT_COMPACTION_BYTES = 8 * 1024 * 1024;
const RETAINED_EVENT_COUNT = 500;

export interface EncryptedAgentStateStoreOptions {
  baseDirectory?: string;
  cipher?: AgentStateCipher;
  maxEventBytes?: number;
  maxEventCount?: number;
  now?: () => Date;
  retainedEventCount?: number;
}

/** Electron-main owner of encrypted local thread, SDK session, and effect state. */
export class EncryptedAgentStateStore implements TaskHistoryStore {
  private readonly baseDirectory: string;
  private readonly cipher: AgentStateCipher;
  private readonly maxEventBytes: number;
  private readonly maxEventCount: number;
  private readonly now: () => Date;
  private readonly retainedEventCount: number;
  private readonly eventCounts = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: EncryptedAgentStateStoreOptions = {}) {
    this.baseDirectory = options.baseDirectory ?? path.join(app.getPath('userData'), 'agent-state');
    this.cipher = options.cipher ?? operatingSystemCipher;
    this.maxEventBytes = options.maxEventBytes ?? EVENT_COMPACTION_BYTES;
    this.maxEventCount = options.maxEventCount ?? EVENT_COMPACTION_COUNT;
    this.now = options.now ?? (() => new Date());
    this.retainedEventCount = options.retainedEventCount ?? RETAINED_EVENT_COUNT;
  }

  async initialize(): Promise<void> {
    if (!(await this.cipher.isAvailable())) {
      throw new Error('Operating-system credential encryption is unavailable for local agent state.');
    }
    await mkdir(this.threadsDirectory(), { recursive: true, mode: 0o700 });
    await chmod(this.baseDirectory, 0o700);
    await chmod(this.threadsDirectory(), 0o700);
    if (!(await exists(this.indexPath()))) await this.writeIndex(EMPTY_INDEX);
  }

  async close(): Promise<void> { await this.queue; }

  async assertSettledInvocations(ownerId: string, threadId: string): Promise<void> {
    await this.queue;
    await this.readOwnedThread(ownerId, threadId);
    if (!(await exists(this.invocationsPath(threadId))))
      throw new Error('The task invocation journal is missing; its action outcomes cannot be verified.');
    const journal = await this.readJournal(threadId);
    if (journal.records.some((record) => record.status === 'executing' || record.status === 'unknown'))
      throw new Error('The task has an unresolved tool outcome and cannot start another turn.');
  }

  async findOwnedThread(ownerId: string, threadId: string): Promise<LocalThreadState | null> {
    await this.queue;
    const index = await this.readIndex();
    const entry = index.threads.find((item) => item.threadId === threadId);
    if (!entry) return null;
    if (entry.ownerId !== ownerId) throw new Error('Local thread owner mismatch.');
    return this.readOwnedThread(ownerId, threadId);
  }

  async create(ownerId: string, snapshot: TaskSnapshot, classroomLessonId: string | null = null): Promise<void> {
    await this.serial(async () => {
      const index = await this.readIndex();
      const existing = index.threads.find((entry) => entry.threadId === snapshot.taskId);
      if (existing) {
        if (existing.ownerId !== ownerId) throw new Error('Local thread owner mismatch.');
        const state = await this.readThread(snapshot.taskId);
        if (state.ownerId !== ownerId) throw new Error('Local thread owner mismatch.');
        return;
      }
      const state = LocalThreadStateSchema.parse({
        schemaVersion: 1,
        ownerId,
        snapshot,
        classroomLessonId,
        session: { revision: 0, items: [], appliedOperations: {} },
        checkpoint: null,
      });
      await this.ensureThreadDirectory(snapshot.taskId);
      await this.writeEncrypted(this.snapshotPath(snapshot.taskId), state, LocalThreadStateSchema);
      await this.writeEncrypted(this.invocationsPath(snapshot.taskId), EMPTY_JOURNAL, LocalInvocationJournalSchema);
      const timestamp = this.now().toISOString();
      await this.writeIndex({
        schemaVersion: 1,
        threads: [...index.threads, {
          threadId: snapshot.taskId,
          ownerId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }],
      });
    });
  }

  async save(ownerId: string, input: TaskUpdate): Promise<void> {
    const update = TaskUpdateSchema.parse(input);
    await this.serial(async () => {
      if (!(await exists(this.snapshotPath(update.snapshot.taskId)))) {
        const index = await this.readIndex();
        const existing = index.threads.find(
          (entry) => entry.threadId === update.snapshot.taskId,
        );
        if (existing) {
          if (existing.ownerId !== ownerId) throw new Error('Local thread owner mismatch.');
          throw new Error('Local thread snapshot is missing.');
        }
        await this.ensureThreadDirectory(update.snapshot.taskId);
        const initial = LocalThreadStateSchema.parse({
          schemaVersion: 1,
          ownerId,
          snapshot: update.snapshot,
          session: { revision: 0, items: [], appliedOperations: {} },
          checkpoint: null,
        });
        await this.writeEncrypted(this.snapshotPath(update.snapshot.taskId), initial, LocalThreadStateSchema);
        await this.writeEncrypted(this.invocationsPath(update.snapshot.taskId), EMPTY_JOURNAL, LocalInvocationJournalSchema);
        await this.writeIndex({
          schemaVersion: 1,
          threads: [...index.threads, {
            threadId: update.snapshot.taskId,
            ownerId,
            createdAt: update.snapshot.createdAt,
            updatedAt: update.snapshot.updatedAt,
          }],
        });
      }
      const state = await this.readThread(update.snapshot.taskId);
      if (state.ownerId !== ownerId) throw new Error('Local thread owner mismatch.');
      await this.writeEncrypted(
        this.snapshotPath(update.snapshot.taskId),
        { ...state, snapshot: update.snapshot },
        LocalThreadStateSchema,
      );
      await this.appendEvent(update.snapshot.taskId, update);
      await this.touchIndex(update.snapshot.taskId, ownerId, update.snapshot.updatedAt);
    });
  }

  async load(ownerId: string): Promise<TaskHistory> {
    await this.queue;
    const index = await this.readIndex();
    const states = await Promise.all(
      index.threads.filter((entry) => entry.ownerId === ownerId).map((entry) => this.readThread(entry.threadId)),
    );
    const updates = (await Promise.all(states.map((state) => this.readEvents(state.snapshot.taskId)))).flat();
    return TaskHistorySchema.parse({
      events: updates.map((update) => update.event),
      persistence: { mode: 'local_encrypted', summary: 'Tasks are encrypted on this device.' },
      snapshots: states.map((state) => state.snapshot).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    });
  }

  async listActive(ownerId: string): Promise<LocalThreadState[]> {
    await this.queue;
    const index = await this.readIndex();
    const states = await Promise.all(index.threads.filter((entry) => entry.ownerId === ownerId).map((entry) => this.readThread(entry.threadId)));
    return states.filter((state) => !['completed', 'failed', 'cancelled', 'blocked'].includes(state.snapshot.phase));
  }

  async findLatestCoachProgress(
    ownerId: string,
    attemptId: string,
    activityVersionId: string,
  ): Promise<CoachProgress | null> {
    await this.queue;
    const index = await this.readIndex();
    const entries = index.threads
      .filter((entry) => entry.ownerId === ownerId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const entry of entries) {
      const state = await this.readThread(entry.threadId);
      const goal = state.snapshot.goal;
      if (
        goal?.schemaVersion === 11 &&
        goal.route === 'coach' &&
        goal.coachProgress?.attemptId === attemptId &&
        goal.coachProgress.activityVersionId === activityVersionId
      ) return goal.coachProgress;
    }
    return null;
  }

  async readOwnedThread(
    ownerId: string,
    threadId: string,
  ): Promise<LocalThreadState> {
    await this.queue;
    const state = await this.readThread(threadId);
    if (state.ownerId !== ownerId)
      throw new Error('Local thread owner mismatch.');
    return state;
  }

  async updateClassroomState(
    ownerId: string,
    threadId: string,
    mutate: (state: LocalThreadState) => LocalThreadState,
  ): Promise<LocalThreadState> {
    return this.serialValue(async () => {
      const state = await this.readThread(threadId);
      if (state.ownerId !== ownerId)
        throw new Error('Local thread owner mismatch.');
      const next = LocalThreadStateSchema.parse(mutate(state));
      if (
        JSON.stringify(next.broadcastDrafts) !==
        JSON.stringify(state.broadcastDrafts)
      )
        next.broadcastRevision = state.broadcastRevision + 1;
      if (next.ownerId !== ownerId || next.snapshot.taskId !== threadId)
        throw new Error('Local thread owner mismatch.');
      await this.writeEncrypted(
        this.snapshotPath(threadId),
        next,
        LocalThreadStateSchema,
      );
      return next;
    });
  }

  async writeGuidanceJournal(input: LocalGuidanceStartJournal): Promise<void> {
    const value = LocalGuidanceStartJournalSchema.parse(input);
    await this.serial(async () => {
      await this.writeEncrypted(
        this.guidancePath(value.ownerId, value.broadcastId),
        value,
        LocalGuidanceStartJournalSchema,
      );
    });
  }
  async readGuidanceJournal(
    ownerId: string,
    broadcastId: string,
  ): Promise<LocalGuidanceStartJournal | null> {
    await this.queue;
    const file = this.guidancePath(ownerId, broadcastId);
    if (!(await exists(file))) return null;
    const value = await this.readEncrypted(
      file,
      LocalGuidanceStartJournalSchema,
    );
    if (value.ownerId !== ownerId || value.broadcastId !== broadcastId)
      throw new Error('Guidance owner mismatch.');
    return value;
  }
  async listGuidanceJournals(
    ownerId: string,
  ): Promise<LocalGuidanceStartJournal[]> {
    await this.queue;
    const prefix = `guidance-${createHash('sha256').update(ownerId).digest('hex')}-`;
    const files = (await readdir(this.baseDirectory)).filter(
      (file) => file.startsWith(prefix) && file.endsWith('.enc'),
    );
    const journals = await Promise.all(
      files.map((file) =>
        this.readEncrypted(
          path.join(this.baseDirectory, file),
          LocalGuidanceStartJournalSchema,
        ),
      ),
    );
    if (journals.some((journal) => journal.ownerId !== ownerId))
      throw new Error('Guidance journal owner mismatch.');
    return journals;
  }
  private guidancePath(ownerId: string, broadcastId: string): string {
    const digest = createHash('sha256').update(ownerId).digest('hex');
    const id =
      LocalGuidanceStartJournalSchema.shape.broadcastId.parse(broadcastId);
    return path.join(this.baseDirectory, `guidance-${digest}-${id}.enc`);
  }

  async readThread(threadId: string): Promise<LocalThreadState> {
    return this.readEncrypted(this.snapshotPath(threadId), LocalThreadStateSchema);
  }

  async readSession(threadId: string, limit: number | null): Promise<LocalThreadState['session']> {
    const session = (await this.readThread(threadId)).session;
    return limit === null ? session : { ...session, items: session.items.slice(-limit) };
  }

  async appendSession(
    threadId: string,
    expectedRevision: number,
    operationId: string,
    operationDigest: string,
    items: Record<string, unknown>[],
  ): Promise<{ replayed: boolean; revision: number }> {
    return this.mutateSession(threadId, expectedRevision, operationId, operationDigest, (current) => [...current, ...items]);
  }

  async replaceSession(
    threadId: string,
    expectedRevision: number,
    operationId: string,
    operationDigest: string,
    expectedSuffix: Record<string, unknown>[],
    replacement: Record<string, unknown>[],
  ): Promise<{ replayed: boolean; revision: number }> {
    return this.mutateSession(threadId, expectedRevision, operationId, operationDigest, (current) => {
      const suffix = current.slice(current.length - expectedSuffix.length);
      if (stableJson(suffix) !== stableJson(expectedSuffix)) throw new Error('session_conflict');
      return [...current.slice(0, current.length - expectedSuffix.length), ...replacement];
    });
  }

  async commitCheckpoint(
    threadId: string,
    expectedRevision: number,
    checkpoint: Omit<LocalCheckpoint, 'revision'>,
  ): Promise<{ replayed: boolean; revision: number }> {
    return this.serialValue(async () => {
      const state = await this.readThread(threadId);
      const currentRevision = state.checkpoint?.revision ?? 0;
      if (currentRevision === expectedRevision + 1 && state.checkpoint?.state === checkpoint.state) {
        return { replayed: true, revision: currentRevision };
      }
      if (currentRevision !== expectedRevision) throw new Error('checkpoint_conflict');
      const next = { ...checkpoint, revision: expectedRevision + 1 };
      await this.writeEncrypted(this.snapshotPath(threadId), { ...state, checkpoint: next }, LocalThreadStateSchema);
      return { replayed: false, revision: next.revision };
    });
  }

  async invocation(threadId: string, callId: string): Promise<LocalInvocation | null> {
    const journal = await this.readJournal(threadId);
    return journal.records.find((record) => record.callId === callId) ?? null;
  }

  async transitionInvocation(
    threadId: string,
    callId: string,
    expected: LocalInvocation['status'],
    status: LocalInvocation['status'],
    result: LocalInvocation['result'] = null,
  ): Promise<LocalInvocation> {
    return this.serialValue(async () => {
      const journal = await this.readJournal(threadId);
      const index = journal.records.findIndex((record) => record.callId === callId);
      const current = journal.records[index];
      if (!current) throw new Error('invocation_missing');
      if (current.status !== expected) return current;
      const next = LocalInvocationSchema.parse({ ...current, status, result, updatedAt: this.now().toISOString() });
      const records = [...journal.records];
      records[index] = next;
      await this.writeEncrypted(this.invocationsPath(threadId), { schemaVersion: 1, records }, LocalInvocationJournalSchema);
      return next;
    });
  }

  async addInvocation(threadId: string, input: Omit<LocalInvocation, 'status' | 'result' | 'updatedAt'>): Promise<LocalInvocation> {
    return this.serialValue(async () => {
      const journal = await this.readJournal(threadId);
      const existing = journal.records.find((record) => record.callId === input.callId);
      if (existing) {
        if (existing.idempotencyDigest !== input.idempotencyDigest) throw new Error('invocation_idempotency_conflict');
        return existing;
      }
      const next = LocalInvocationSchema.parse({ ...input, status: 'checkpointed', result: null, updatedAt: this.now().toISOString() });
      await this.writeEncrypted(this.invocationsPath(threadId), { schemaVersion: 1, records: [...journal.records, next] }, LocalInvocationJournalSchema);
      return next;
    });
  }

  private async mutateSession(
    threadId: string,
    expectedRevision: number,
    operationId: string,
    operationDigest: string,
    mutate: (items: Record<string, unknown>[]) => Record<string, unknown>[],
  ): Promise<{ replayed: boolean; revision: number }> {
    return this.serialValue(async () => {
      const state = await this.readThread(threadId);
      const applied = state.session.appliedOperations[operationId];
      if (applied) {
        if (applied !== operationDigest) throw new Error('session_operation_conflict');
        return { replayed: true, revision: state.session.revision };
      }
      if (state.session.revision !== expectedRevision) throw new Error('session_conflict');
      const session = {
        revision: expectedRevision + 1,
        items: mutate(state.session.items),
        appliedOperations: { ...state.session.appliedOperations, [operationId]: operationDigest },
      };
      await this.writeEncrypted(this.snapshotPath(threadId), { ...state, session }, LocalThreadStateSchema);
      return { replayed: false, revision: session.revision };
    });
  }

  private async readJournal(threadId: string): Promise<LocalInvocationJournal> {
    if (!(await exists(this.invocationsPath(threadId)))) return EMPTY_JOURNAL;
    return this.readEncrypted(this.invocationsPath(threadId), LocalInvocationJournalSchema);
  }

  private async appendEvent(threadId: string, update: TaskUpdate): Promise<void> {
    const existingCount = this.eventCounts.get(threadId)
      ?? (await this.readEvents(threadId)).length;
    const frame = await this.encodeEvent(update);
    const handle = await open(this.eventsPath(threadId), 'a', 0o600);
    try { await handle.write(frame); await handle.sync(); } finally { await handle.close(); }
    const nextCount = existingCount + 1;
    this.eventCounts.set(threadId, nextCount);
    const eventFile = await stat(this.eventsPath(threadId));
    if (
      nextCount <= this.maxEventCount &&
      eventFile.size <= this.maxEventBytes
    ) return;
    const retained = (await this.readEvents(threadId)).slice(-this.retainedEventCount);
    const compacted = Buffer.concat(await Promise.all(retained.map((item) => this.encodeEvent(item))));
    await atomicWrite(this.eventsPath(threadId), compacted);
    this.eventCounts.set(threadId, retained.length);
  }

  private async encodeEvent(update: TaskUpdate): Promise<Buffer> {
    const plaintext = JSON.stringify(LocalEventFrameSchema.parse({ schemaVersion: 1, update }));
    const encrypted = await this.cipher.encrypt(plaintext);
    const payload = Buffer.from(JSON.stringify({
      checksum: createHash('sha256').update(encrypted).digest('hex'),
      ciphertext: encrypted.toString('base64'),
    }), 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(payload.length);
    return Buffer.concat([length, payload]);
  }

  private async readEvents(threadId: string): Promise<TaskUpdate[]> {
    const target = this.eventsPath(threadId);
    if (!(await exists(target))) return [];
    const bytes = await readFile(target);
    const updates: TaskUpdate[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      const frameStart = offset;
      if (offset + 4 > bytes.length) { await this.quarantineTail(target, bytes, frameStart); break; }
      const length = bytes.readUInt32BE(offset); offset += 4;
      if (length > 50_000_000 || offset + length > bytes.length) { await this.quarantineTail(target, bytes, frameStart); break; }
      const envelope = JSON.parse(bytes.subarray(offset, offset + length).toString('utf8')) as { checksum?: unknown; ciphertext?: unknown };
      offset += length;
      if (typeof envelope.checksum !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('Corrupt local event frame.');
      const encrypted = Buffer.from(envelope.ciphertext, 'base64');
      if (createHash('sha256').update(encrypted).digest('hex') !== envelope.checksum) throw new Error('Corrupt local event frame checksum.');
      const frame = LocalEventFrameSchema.parse(JSON.parse(await this.cipher.decrypt(encrypted)));
      updates.push(frame.update);
    }
    this.eventCounts.set(threadId, updates.length);
    return updates;
  }

  private async quarantineTail(target: string, bytes: Buffer, offset: number): Promise<void> {
    if (offset >= bytes.length) return;
    await writeFile(`${target}.quarantine-${this.now().getTime()}`, bytes.subarray(offset), { mode: 0o600 });
    await truncate(target, offset);
  }

  private async readEncrypted<T>(target: string, schema: ZodType<T>): Promise<T> {
    const encoded = await readFile(target, 'utf8');
    const plaintext = await this.cipher.decrypt(Buffer.from(encoded, 'base64'));
    return schema.parse(JSON.parse(plaintext));
  }

  private async writeEncrypted<T>(target: string, value: T, schema: ZodType<T>): Promise<void> {
    const validated = schema.parse(value);
    const encrypted = await this.cipher.encrypt(JSON.stringify(validated));
    await atomicWrite(target, encrypted.toString('base64'));
  }

  private async ensureThreadDirectory(threadId: string): Promise<void> {
    await mkdir(this.threadDirectory(threadId), { recursive: true, mode: 0o700 });
    await chmod(this.threadDirectory(threadId), 0o700);
  }

  private async readIndex() { return this.readEncrypted(this.indexPath(), LocalThreadIndexSchema); }
  private async writeIndex(value: LocalThreadIndex): Promise<void> { await this.writeEncrypted(this.indexPath(), value, LocalThreadIndexSchema); }
  private async touchIndex(threadId: string, ownerId: string, updatedAt: string): Promise<void> {
    const index = await this.readIndex();
    const threads = index.threads.map((entry) => entry.threadId === threadId ? { ...entry, ownerId, updatedAt } : entry);
    await this.writeIndex({ schemaVersion: 1, threads });
  }
  private serial(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private serialValue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private threadsDirectory(): string { return path.join(this.baseDirectory, 'threads'); }
  private threadDirectory(threadId: string): string { return path.join(this.threadsDirectory(), threadId); }
  private indexPath(): string { return path.join(this.threadsDirectory(), 'index.enc'); }
  private snapshotPath(threadId: string): string { return path.join(this.threadDirectory(threadId), 'snapshot.enc'); }
  private eventsPath(threadId: string): string { return path.join(this.threadDirectory(threadId), 'events.enc'); }
  private invocationsPath(threadId: string): string { return path.join(this.threadDirectory(threadId), 'invocations.enc'); }
}
