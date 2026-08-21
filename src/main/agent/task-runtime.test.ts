import { describe, expect, it, vi } from 'vitest';

import { TaskUpdateSchema } from '../../shared/contracts';

import { createCuaSemanticToolDefinitions } from './cua-semantic-agent-tools';
import { compileIntentAuthorization } from './intent-authorization';
import { compileOutcomeContract } from './outcome-contract';
import { createCompletionDecision } from './outcome-verifier';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { TaskRuntime } from './task-runtime';

describe('TaskRuntime', () => {
  it('submits a ready v8 task synchronously', () => {
    const runtime = new TaskRuntime();
    const listener = vi.fn();
    runtime.on('task-update', listener);

    const snapshot = runtime.submit({ text: 'What is 27 × 14?' });

    expect(snapshot.phase).toBe('ready');
    expect(snapshot.goal).toMatchObject({
      schemaVersion: 8,
      activity: null,
      autonomyMode: 'balanced',
      executionProfile: 'everyday',
      runtimeKind: 'openai_agents',
      originalRequest: 'What is 27 × 14?',
    });
    expect(snapshot.progress).toEqual({
      kind: 'tool_calls',
      completed: 0,
      limit: 30,
    });
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', kind: 'request' });
    expect(listener).toHaveBeenCalledOnce();
    expect(TaskUpdateSchema.parse(listener.mock.lastCall?.[0]).snapshot).toEqual(
      snapshot,
    );
  });

  it('completes directly from planning with an assistant response', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Write a chord progression.' });
    runtime.start({ taskId: ready.taskId });

    const started = runtime.getSnapshot(ready.taskId);
    if (!started.goal || started.goal.schemaVersion !== 8 || !started.outcomes) {
      throw new Error('Expected a current outcome contract.');
    }
    const completed = runtime.complete(
      ready.taskId,
      createCompletionDecision(
        started.goal.outcomeContract,
        started.outcomes.evidence,
        'Am7 – D9 – Gmaj7 – Cmaj7',
      ),
    );

    expect(completed.phase).toBe('completed');
    expect(completed.progress).toMatchObject({ completed: 0 });
    expect(completed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      kind: 'answer',
    });
  });

  it('rejects completion while a required effect criterion is pending or unknown', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Open Chrome.' });
    runtime.start({ taskId: ready.taskId });
    const snapshot = runtime.getSnapshot(ready.taskId);
    if (!snapshot.goal || snapshot.goal.schemaVersion !== 8 || !snapshot.outcomes) {
      throw new Error('Expected a current outcome contract.');
    }
    const pending = createCompletionDecision(
      snapshot.goal.outcomeContract,
      snapshot.outcomes.evidence,
      'Chrome is open.',
    );
    expect(() => runtime.complete(ready.taskId, pending)).toThrow(
      'chrome-surface-visible',
    );

    runtime.recordOutcomeEvidence(ready.taskId, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      runId: ready.taskId,
      criterionId: 'chrome-surface-visible',
      source: 'fresh_observation',
      status: 'unknown',
      observationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      observationFingerprint: 'a'.repeat(64),
      summary: 'Chrome surface verification timed out.',
      createdAt: new Date().toISOString(),
    });
    const unknown = runtime.getSnapshot(ready.taskId);
    if (!unknown.goal || unknown.goal.schemaVersion !== 8 || !unknown.outcomes) {
      throw new Error('Expected a current outcome contract.');
    }
    const unknownGoal = unknown.goal;
    const unknownOutcomes = unknown.outcomes;
    expect(() =>
      runtime.complete(
        ready.taskId,
        createCompletionDecision(
          unknownGoal.outcomeContract,
          unknownOutcomes.evidence,
          'Chrome is open.',
        ),
      ),
    ).toThrow('chrome-surface-visible');
  });

  it('pauses for model-requested input and resumes the same task in planning', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Email the update.' });
    runtime.start({ taskId: ready.taskId });
    const waiting = runtime.requestInput({
      taskId: ready.taskId,
      prompt: 'Who should receive it?',
      choices: [{ id: 'alex', label: 'Alex' }],
    });
    const pending = waiting.pendingInteraction;
    if (!pending) throw new Error('Expected pending input.');

    const resumed = runtime.respondToInteraction({
      taskId: ready.taskId,
      interactionId: pending.id,
      kind: 'answer',
      text: 'Alex',
    });

    expect(resumed.phase).toBe('planning');
    expect(resumed.pendingInteraction).toBeNull();
    expect(resumed.messages.at(-1)).toMatchObject({ role: 'user', text: 'Alex' });
  });

  it('binds and consumes approval for one exact concrete action', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Send the displayed email.' });
    runtime.start({ taskId: ready.taskId });
    const action = {
      action: 'send' as const,
      toolId: 'desktop.control',
      operation: 'click',
      description: 'Click Send for the exact displayed email.',
      parameters: {
        observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        observationFingerprint: 'a'.repeat(64),
        account: 'me@example.com',
        recipients: ['alex@example.com'],
        subject: 'Update',
        body: 'Done.',
        command: 'click',
        x: '100',
        y: '200',
      },
    };
    const waiting = runtime.requestApproval({
      taskId: ready.taskId,
      prompt: action.description,
      consequence: 'This sends the exact displayed email.',
      action,
    });
    const pending = waiting.pendingInteraction;
    if (!pending || pending.kind !== 'approval') {
      throw new Error('Expected pending approval.');
    }
    expect(() =>
      runtime.decideApproval({
        taskId: ready.taskId,
        interactionId: pending.id,
        kind: 'approval',
        decision: 'approve',
        actionDigest: '0'.repeat(64),
      }),
    ).toThrow('does not match');

    const approved = runtime.decideApproval({
      taskId: ready.taskId,
      interactionId: pending.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: pending.actionDigest,
    });
    expect(approved.phase).toBe('planning');
    expect(approved.approvalGrant?.actionDigest).toBe(pending.actionDigest);

    expect(() =>
      runtime.consumeApprovalGrant({
        taskId: ready.taskId,
        action: {
          ...action,
          parameters: { ...action.parameters, body: 'Changed.' },
        },
      }),
    ).toThrow('does not match');
    expect(
      runtime.consumeApprovalGrant({ taskId: ready.taskId, action }).phase,
    ).toBe('acting');
  });

  it('increments agent progress only when a tool result is recorded', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Open Gmail.' });
    runtime.start({ taskId: ready.taskId });
    runtime.beginObservation(ready.taskId, 'Capturing the desktop.');
    const verifying = runtime.recordToolResult(
      ready.taskId,
      'Desktop captured.',
      {
        toolId: 'desktop.observe',
        operation: 'observe',
        effectKind: 'none',
        resourceKind: null,
        authorizationSource: 'routine',
        approvalRequired: false,
        consequential: false,
      },
    );

    expect(verifying.phase).toBe('verifying');
    expect(verifying.progress).toEqual({
      kind: 'tool_calls',
      completed: 1,
      limit: 30,
    });
    expect(verifying.lastEvent?.tool).toEqual({
      toolId: 'desktop.observe',
      operation: 'observe',
      effectKind: 'none',
      resourceKind: null,
      authorizationSource: 'routine',
      approvalRequired: false,
      consequential: false,
    });
  });

  it('queues steering for one safe model boundary and cancels pending input', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Open Gmail.' });
    runtime.start({ taskId: ready.taskId });
    const steered = runtime.steer({
      taskId: ready.taskId,
      instruction: 'Use my work account.',
    });
    expect(runtime.takeSteering(ready.taskId)).toEqual(steered.queuedSteering);
    expect(runtime.takeSteering(ready.taskId)).toEqual([]);

    const waiting = runtime.requestInput({
      taskId: ready.taskId,
      prompt: 'Which inbox?',
    });
    expect(runtime.cancel({ taskId: ready.taskId })).toMatchObject({
      phase: 'cancelled',
      pendingInteraction: null,
    });
    expect(waiting.pendingInteraction).not.toBeNull();
  });

  it('recompiles authenticated steering into a new intent revision', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Create a calendar event.' });
    runtime.start({ taskId: ready.taskId });
    const before = runtime.getSnapshot(ready.taskId).goal;
    if (!before || before.schemaVersion !== 8) throw new Error('Expected v8.');

    const steered = runtime.steer({
      taskId: ready.taskId,
      instruction: 'Also create a document.',
    });
    if (!steered.goal || steered.goal.schemaVersion !== 8) {
      throw new Error('Expected revised v8.');
    }
    expect(steered.goal.intentAuthorization.revision).toBe(
      before.intentAuthorization.revision + 1,
    );
    expect(steered.goal.intentAuthorization.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectKind: 'create_resource',
          resourceKinds: expect.arrayContaining(['calendar_event', 'document']),
        }),
      ]),
    );
  });

  it('uses the injected semantic registry for the full approval lifecycle', () => {
    const registry = new RuntimeToolRegistry(
      createCuaSemanticToolDefinitions({
        browserPrepareAvailable: () => true,
        semanticAvailable: () => true,
      }),
    );
    const runtime = new TaskRuntime({ toolRegistry: registry });
    const ready = runtime.submit({ text: 'Send the calendar invitation.' });
    runtime.start({ taskId: ready.taskId });
    const waiting = runtime.requestApproval({
      taskId: ready.taskId,
      prompt: 'Send this invitation?',
      consequence: 'This sends an invitation.',
      action: {
        action: 'click_element',
        toolId: 'computer.control',
        operation: 'click_element',
        description: 'Send the calendar invitation.',
        effect: {
          kind: 'send_communication',
          resourceKind: 'calendar_event',
          reversibility: 'reversible',
          externality: 'external',
          communication: 'invite',
          overwrite: 'none',
          sensitiveDataTransfer: false,
        },
        parameters: { attendees: ['person@example.test'] },
      },
    });
    expect(waiting.phase).toBe('awaiting_approval');
  });

  it('keeps local fallback authority fail-closed across steering', () => {
    const runtime = new TaskRuntime({ intentAuthorizationEnabled: false });
    const ready = runtime.submit({ text: 'Create a calendar event.' });
    runtime.start({ taskId: ready.taskId });
    const before = runtime.getSnapshot(ready.taskId);
    if (!before.goal || before.goal.schemaVersion !== 8) {
      throw new Error('Expected a v8 fallback contract.');
    }
    expect(before.goal.intentAuthorization.grants).toEqual([]);

    const steered = runtime.steer({
      taskId: ready.taskId,
      instruction: 'Also create a document.',
    });
    if (!steered.goal || steered.goal.schemaVersion !== 8) {
      throw new Error('Expected a revised v8 fallback contract.');
    }
    expect(steered.goal.intentAuthorization.grants).toEqual([]);
    expect(steered.goal.intentAuthorization.revision).toBe(2);
  });

  it('synchronizes a newer backend authority revision and rejects rollback', () => {
    const runtime = new TaskRuntime({ intentAuthorizationEnabled: false });
    const ready = runtime.submit({ text: 'Create a calendar event.' });
    runtime.start({ taskId: ready.taskId });
    const outcomeContract = {
      ...compileOutcomeContract('Create a calendar event and a document.'),
      revision: 2,
    };
    const intentAuthorization = compileIntentAuthorization(
      'Create a calendar event and a document.',
      { revision: 2 },
    );
    const synchronized = runtime.synchronizeHostedAuthority(ready.taskId, {
      autonomyMode: 'balanced',
      intentAuthorization,
      outcomeContract,
    });
    expect(synchronized.goal).toMatchObject({
      schemaVersion: 8,
      intentAuthorization: { revision: 2 },
      outcomeContract: { revision: 2 },
    });
    expect(() =>
      runtime.synchronizeHostedAuthority(ready.taskId, {
        autonomyMode: 'balanced',
        intentAuthorization: { ...intentAuthorization, revision: 1 },
        outcomeContract: { ...outcomeContract, revision: 1 },
      }),
    ).toThrow('cannot roll back');
  });
});
