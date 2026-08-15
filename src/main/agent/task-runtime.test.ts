import { describe, expect, it, vi } from 'vitest';

import { TaskRuntime } from './task-runtime';

describe('task runtime', () => {
  it('emits typed lifecycle events while compiling a goal', () => {
    const runtime = new TaskRuntime();
    const listener = vi.fn();
    runtime.on('task-update', listener);

    const snapshot = runtime.submit({ text: 'Open YouTube for me' });

    expect(snapshot.phase).toBe('ready');
    expect(snapshot.goal?.interactionMode).toBe('act');
    expect(snapshot.pendingInteraction).toBeNull();
    expect(snapshot.messages.map((message) => message.role)).toEqual(['user']);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.lastCall?.[0].snapshot).toEqual(snapshot);
  });

  it('stops at clarification for an ambiguous request', () => {
    const runtime = new TaskRuntime();
    const snapshot = runtime.submit({ text: 'help' });

    expect(snapshot.phase).toBe('clarifying');
    expect(snapshot.goal).toBeNull();
    expect(snapshot.pendingInteraction?.kind).toBe('clarification');
    expect(snapshot.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('continues a clarification in the same task and compiles the answer', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'help' });
    const pending = submitted.pendingInteraction;

    expect(pending?.kind).toBe('clarification');
    if (!pending) throw new Error('Expected a pending clarification.');

    const ready = runtime.respondToInteraction({
      taskId: submitted.taskId,
      interactionId: pending.id,
      kind: 'answer',
      text: 'Open Gmail for me',
    });

    expect(ready.taskId).toBe(submitted.taskId);
    expect(ready.phase).toBe('ready');
    expect(ready.pendingInteraction).toBeNull();
    expect(ready.goal?.objective).toContain('Open Gmail for me');
    expect(ready.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
  });

  it('rejects stale clarification responses without consuming the pending input', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'help' });
    const pending = submitted.pendingInteraction;

    if (!pending) throw new Error('Expected a pending clarification.');

    expect(() =>
      runtime.respondToInteraction({
        taskId: submitted.taskId,
        interactionId: crypto.randomUUID(),
        kind: 'answer',
        text: 'Open Gmail for me',
      }),
    ).toThrow('does not match');

    expect(
      runtime.respondToInteraction({
        taskId: submitted.taskId,
        interactionId: pending.id,
        kind: 'answer',
        text: 'Open Gmail for me',
      }).phase,
    ).toBe('ready');
  });

  it('resumes a running task through observation after requested input', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open Gmail for me' });
    const planning = runtime.start({ taskId: submitted.taskId });
    const waiting = runtime.requestInput({
      taskId: planning.taskId,
      prompt: 'Which inbox should I use?',
      choices: [
        { id: 'work', label: 'Work' },
        { id: 'personal', label: 'Personal' },
      ],
    });

    expect(waiting.phase).toBe('awaiting_input');
    expect(waiting.pendingInteraction?.kind).toBe('clarification');

    const pending = waiting.pendingInteraction;
    if (!pending) throw new Error('Expected a pending clarification.');

    const resumed = runtime.respondToInteraction({
      taskId: waiting.taskId,
      interactionId: pending.id,
      kind: 'answer',
      text: 'Work',
    });

    expect(resumed.phase).toBe('observing');
    expect(resumed.pendingInteraction).toBeNull();
  });

  it('binds approval to one exact action and rejects replay', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({
      text: 'Send an email to alex@example.com',
    });
    const planning = runtime.start({ taskId: submitted.taskId });
    const waiting = runtime.requestApproval({
      taskId: planning.taskId,
      prompt: 'Send this email?',
      consequence: 'This will send an external email.',
      action: {
        action: 'send',
        capability: 'email',
        description: 'Send the drafted message to Alex.',
        parameters: {
          body: 'See you tomorrow.',
          recipients: ['alex@example.com'],
          subject: 'Tomorrow',
        },
      },
    });

    const pending = waiting.pendingInteraction;
    expect(pending?.kind).toBe('approval');
    if (!pending || pending.kind !== 'approval') {
      throw new Error('Expected a pending approval.');
    }

    expect(() =>
      runtime.decideApproval({
        taskId: waiting.taskId,
        interactionId: pending.id,
        kind: 'approval',
        decision: 'approve',
        actionDigest: '0'.repeat(64),
      }),
    ).toThrow('does not match');

    const resumed = runtime.decideApproval({
      taskId: waiting.taskId,
      interactionId: pending.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: pending.actionDigest,
    });

    expect(resumed.phase).toBe('observing');
    expect(resumed.pendingInteraction).toBeNull();
    expect(() =>
      runtime.decideApproval({
        taskId: waiting.taskId,
        interactionId: pending.id,
        kind: 'approval',
        decision: 'approve',
        actionDigest: pending.actionDigest,
      }),
    ).toThrow('no pending interaction');
  });

  it('cancels a non-terminal task', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open YouTube for me' });
    const cancelled = runtime.cancel({ taskId: submitted.taskId });

    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.pendingInteraction).toBeNull();
  });
});
