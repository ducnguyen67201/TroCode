import { describe, expect, it, vi } from 'vitest';

import { TaskUpdateSchema } from '../../shared/contracts';

import { TaskRuntime } from './task-runtime';

describe('TaskRuntime', () => {
  it('submits a ready v6 task synchronously', () => {
    const runtime = new TaskRuntime();
    const listener = vi.fn();
    runtime.on('task-update', listener);

    const snapshot = runtime.submit({ text: 'What is 27 × 14?' });

    expect(snapshot.phase).toBe('ready');
    expect(snapshot.goal).toMatchObject({
      schemaVersion: 6,
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

    const completed = runtime.complete(ready.taskId, 'Am7 – D9 – Gmaj7 – Cmaj7');

    expect(completed.phase).toBe('completed');
    expect(completed.progress).toMatchObject({ completed: 0 });
    expect(completed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      kind: 'answer',
    });
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
      { toolId: 'desktop.observe', operation: 'observe' },
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
});
