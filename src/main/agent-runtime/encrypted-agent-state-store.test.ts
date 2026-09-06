import { randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentTaskContractV10, AgentTaskContractV11 } from '../../shared/contracts';
import { TaskRuntime } from '../agent/task-runtime';
import { workCheckFixture } from '../knowledge/work-check.fixture';

import {
  type AgentStateCipher,
  EncryptedAgentStateStore,
  type EncryptedAgentStateStoreOptions,
} from './encrypted-agent-state-store';

const cipher: AgentStateCipher = {
  decrypt: async (value) => Buffer.from(value.toString('utf8'), 'base64').toString('utf8'),
  encrypt: async (value) => Buffer.from(Buffer.from(value, 'utf8').toString('base64'), 'utf8'),
  isAvailable: async () => true,
};

const createdDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(createdDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true }),
  ));
});

async function fixture(options: Pick<
  EncryptedAgentStateStoreOptions,
  'maxEventBytes' | 'maxEventCount' | 'retainedEventCount'
> = {}) {
  const baseDirectory = await mkdtemp(path.join(tmpdir(), 'tro-agent-state-'));
  createdDirectories.push(baseDirectory);
  const store = new EncryptedAgentStateStore({ baseDirectory, cipher, ...options });
  await store.initialize();
  const request = 'Inspect the current application.';
  const authority: AgentTaskContractV10 = {
    schemaVersion: 10,
    id: randomUUID(),
    originalRequest: request,
    runtimeKind: 'openai_agents_sdk',
    executionProfile: 'everyday',
    workspace: null,
    activity: null,
    limits: {
      maxImages: 20,
      maxMicroUsd: 5_000_000,
      maxMinutes: 30,
      maxModelSamples: 40,
      maxToolCalls: 30,
    },
  };
  const snapshot = new TaskRuntime().submit(
    { text: request },
    { authority, taskId: randomUUID() },
  );
  await store.create('owner-1', snapshot);
  return { baseDirectory, snapshot, store };
}

describe('EncryptedAgentStateStore', () => {
  it('reuses Coach progress only for the exact owner, Attempt, and Activity version', async () => {
    const { store } = await fixture();
    const attemptId = randomUUID();
    const activityVersionId = randomUUID();
    const request = 'Show me how to use Variables.';
    const authority: AgentTaskContractV11 = {
      schemaVersion: 11,
      id: randomUUID(),
      originalRequest: request,
      runtimeKind: 'coach',
      route: 'coach',
      executionProfile: 'everyday',
      workspace: null,
      activity: null,
      coachProgress: {
        attemptId,
        activityVersionId,
        stepNumber: 3,
        expectedOutcome: 'The Score variable exists.',
        recap: null,
      },
      limits: { maxImages: 20, maxMicroUsd: 5_000_000, maxMinutes: 30, maxModelSamples: 40, maxToolCalls: 30 },
    };
    const snapshot = new TaskRuntime().submit(
      { text: request },
      { authority, taskId: randomUUID() },
    );
    await store.create('owner-1', snapshot);

    await expect(store.findLatestCoachProgress(
      'owner-1', attemptId, activityVersionId,
    )).resolves.toMatchObject({ stepNumber: 3 });
    await expect(store.findLatestCoachProgress(
      'owner-2', attemptId, activityVersionId,
    )).resolves.toBeNull();
    await expect(store.findLatestCoachProgress(
      'owner-1', randomUUID(), activityVersionId,
    )).resolves.toBeNull();
    await expect(store.findLatestCoachProgress(
      'owner-1', attemptId, randomUUID(),
    )).resolves.toBeNull();
  });

  it('round-trips local history without plaintext state on disk', async () => {
    const { baseDirectory, snapshot, store } = await fixture();
    if (!snapshot.lastEvent) throw new Error('missing initial task event');
    await store.save('owner-1', { event: snapshot.lastEvent, snapshot });

    const history = await store.load('owner-1');
    const encoded = await readFile(
      path.join(baseDirectory, 'threads', snapshot.taskId, 'snapshot.enc'),
      'utf8',
    );

    expect(history.persistence.mode).toBe('local_encrypted');
    expect(history.snapshots).toHaveLength(1);
    expect(encoded).not.toContain(snapshot.request);
    if (process.platform !== 'win32') {
      expect((await stat(path.join(baseDirectory, 'threads'))).mode & 0o777).toBe(0o700);
    }
  });

  it('applies session operations and checkpoints with optimistic revisions', async () => {
    const { snapshot, store } = await fixture();
    const operationDigest = 'a'.repeat(64);
    const requiredInitialTool = {
      modelName: 'observe_context',
      arguments: { operation: 'observe', scope: 'auto' },
    };
    const walkthroughState = {
      completedSteps: 1,
      enabled: true,
      phase: 'needs_observation' as const,
    };

    await expect(store.appendSession(
      snapshot.taskId,
      0,
      'append-1',
      operationDigest,
      [{ role: 'user', content: 'hello' }],
    )).resolves.toEqual({ replayed: false, revision: 1 });
    await expect(store.appendSession(
      snapshot.taskId,
      0,
      'append-1',
      operationDigest,
      [{ role: 'user', content: 'hello' }],
    )).resolves.toEqual({ replayed: true, revision: 1 });
    await expect(store.appendSession(
      snapshot.taskId,
      0,
      'append-2',
      'b'.repeat(64),
      [],
    )).rejects.toThrow('session_conflict');

    await expect(store.commitCheckpoint(snapshot.taskId, 0, {
      agentTurnId: randomUUID(),
      graphVersion: 'c'.repeat(64),
      model: 'gpt-test',
      pendingCallId: 'call-1',
      protocolDigest: 'd'.repeat(64),
      requiredInitialTool,
      sdkVersion: '0.17.0',
      state: '{"state":true}',
      toolCatalogDigest: 'e'.repeat(64),
      walkthroughState,
    })).resolves.toEqual({ replayed: false, revision: 1 });

    await expect(store.readThread(snapshot.taskId)).resolves.toMatchObject({
      checkpoint: { requiredInitialTool, walkthroughState },
    });
  });

  it('keeps an existing thread intact and rejects a different owner', async () => {
    const { snapshot, store } = await fixture();
    await store.appendSession(
      snapshot.taskId,
      0,
      'append-before-create-replay',
      'a'.repeat(64),
      [{ role: 'user', content: 'preserve me' }],
    );

    await expect(store.create('owner-1', snapshot)).resolves.toBeUndefined();
    await expect(store.readSession(snapshot.taskId, null)).resolves.toMatchObject({
      revision: 1,
      items: [{ role: 'user', content: 'preserve me' }],
    });
    await expect(store.create('owner-2', snapshot)).rejects.toThrow(
      'Local thread owner mismatch.',
    );
    await expect(store.readThread(snapshot.taskId)).resolves.toMatchObject({
      ownerId: 'owner-1',
    });
  });

  it('makes executing-without-result terminal unknown instead of replayable', async () => {
    const { snapshot, store } = await fixture();
    await store.addInvocation(snapshot.taskId, {
      callId: 'call-unknown',
      idempotencyDigest: 'f'.repeat(64),
      operation: 'send',
      toolId: 'message.send',
    });
    await store.transitionInvocation(
      snapshot.taskId,
      'call-unknown',
      'checkpointed',
      'executing',
    );
    const unknown = await store.transitionInvocation(
      snapshot.taskId,
      'call-unknown',
      'executing',
      'unknown',
      {
        status: 'unknown',
        summary: 'Completion could not be confirmed.',
        data: null,
        imageDataUrl: null,
      },
    );

    expect(unknown.status).toBe('unknown');
    expect(unknown.result?.status).toBe('unknown');
  });

  it('quarantines a torn final event frame while preserving earlier history', async () => {
    const { baseDirectory, snapshot, store } = await fixture();
    if (!snapshot.lastEvent) throw new Error('missing initial task event');
    await store.save('owner-1', { event: snapshot.lastEvent, snapshot });
    const eventsPath = path.join(baseDirectory, 'threads', snapshot.taskId, 'events.enc');
    await appendFile(eventsPath, Buffer.from([0, 0]));

    const history = await store.load('owner-1');

    expect(history.events).toHaveLength(1);
  });

  it('compacts encrypted event history to a bounded retained tail', async () => {
    const { snapshot, store } = await fixture({
      maxEventCount: 3,
      retainedEventCount: 2,
    });
    if (!snapshot.lastEvent) throw new Error('missing initial task event');

    for (let count = 0; count < 4; count += 1) {
      await store.save('owner-1', { event: snapshot.lastEvent, snapshot });
    }

    await expect(store.load('owner-1')).resolves.toMatchObject({
      events: [{}, {}],
    });
  });
});

it('isolates durable guidance intents before a task exists and retains counters', async () => {
  const { store } = await fixture();
  const journal = {
    ownerId: 'owner-1',
    anchorAttemptId: randomUUID(),
    broadcastId: randomUUID(),
    request: {
      clientStartId: randomUUID(),
      taskId: randomUUID(),
      clientInstanceId: randomUUID(),
      contextMode: 'text_only' as const,
    },
    claim: null,
    phase: 'claiming' as const,
    modelRequests: 0,
    observations: 0,
    startedAt: new Date().toISOString(),
    report: null,
  };
  await store.writeGuidanceJournal(journal);
  expect(
    await store.readGuidanceJournal('owner-1', journal.broadcastId),
  ).toEqual(journal);
  expect(
    await store.readGuidanceJournal('owner-2', journal.broadcastId),
  ).toBeNull();
  expect(await store.listGuidanceJournals('owner-2')).toEqual([]);
  await store.writeGuidanceJournal({
    ...journal,
    phase: 'unknown',
    modelRequests: 2,
    observations: 4,
  });
  expect((await store.listGuidanceJournals('owner-1'))[0]).toMatchObject({
    phase: 'unknown',
    modelRequests: 2,
    observations: 4,
  });
});

it('keeps check feedback in owner-scoped encrypted history without work contents',async()=>{
 const {baseDirectory,snapshot,store}=await fixture(); const f=workCheckFixture();
 const updated={...snapshot,taskId:f.packet.taskId,messages:[],lastEvent:null,goal:{...snapshot.goal!,activity:f.activity},workCheck:{phase:'checked' as const,report:f.report,message:null}};
 await store.create('owner-1',updated);
 const history=await store.load('owner-1'); expect(history.snapshots.find(s=>s.taskId===f.packet.taskId)?.workCheck?.report).toEqual(f.report);
 expect((await store.load('owner-2')).snapshots).toEqual([]);
 const encoded=await readFile(path.join(baseDirectory,'threads',f.packet.taskId,'snapshot.enc'),'utf8');
 expect(encoded).not.toContain(f.report.summary); expect(JSON.stringify(history.snapshots)).not.toContain('for i in range');
});
