import { describe, expect, it, vi } from 'vitest';

import { TaskUpdateSchema } from '../../shared/contracts';

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

  it('rejects a task update whose event belongs to another task', () => {
    const runtime = new TaskRuntime();
    const snapshot = runtime.submit({ text: 'Open YouTube for me' });
    const event = snapshot.lastEvent;

    if (!event) throw new Error('Expected a task event.');
    expect(TaskUpdateSchema.parse({ event, snapshot }).snapshot).toEqual(snapshot);
    expect(() =>
      TaskUpdateSchema.parse({
        event: { ...event, taskId: crypto.randomUUID() },
        snapshot,
      }),
    ).toThrow('do not match');
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

  it('keeps a completed guide response in the task conversation', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({
      text: 'Làm sao để làm bài tập tiếng Anh này?',
    });
    runtime.start({ taskId: ready.taskId });
    runtime.beginObservation(ready.taskId, 'The worksheet is visible.');
    runtime.recordGuidance(
      ready.taskId,
      'Look at the word “now” in question 2.',
    );
    runtime.beginVerification(ready.taskId, 'The guidance is grounded.');

    const completed = runtime.complete(
      ready.taskId,
      'Dùng hiện tại tiếp diễn cho hành động đang xảy ra ngay bây giờ.',
    );

    expect(completed.phase).toBe('completed');
    expect(completed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      kind: 'answer',
      text: 'Dùng hiện tại tiếp diễn cho hành động đang xảy ra ngay bây giờ.',
    });
    expect(completed.messages.at(-2)).toMatchObject({
      role: 'assistant',
      kind: 'answer',
      text: 'Look at the word “now” in question 2.',
    });
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
    const exactAction = waiting.pendingInteraction?.kind === 'approval'
      ? waiting.pendingInteraction.action
      : null;

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
    expect(resumed.approvalGrant?.actionDigest).toBe(pending.actionDigest);
    expect(exactAction).not.toBeNull();
    if (!exactAction) throw new Error('Expected the exact approved action.');
    expect(() =>
      runtime.consumeApprovalGrant({
        taskId: waiting.taskId,
        action: {
          ...exactAction,
          parameters: {
            ...exactAction.parameters,
            recipients: ['mallory@example.com'],
          },
        },
      }),
    ).toThrow('does not match');
    const acting = runtime.consumeApprovalGrant({
      taskId: waiting.taskId,
      action: exactAction,
    });
    expect(acting.phase).toBe('acting');
    expect(acting.approvalGrant).toBeNull();
    expect(() =>
      runtime.consumeApprovalGrant({
        taskId: waiting.taskId,
        action: exactAction,
      }),
    ).toThrow('no approved action grant');
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

  it('denies approval without creating an action grant', () => {
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
          recipients: ['alex@example.com'],
        },
      },
    });
    const pending = waiting.pendingInteraction;

    if (!pending || pending.kind !== 'approval') {
      throw new Error('Expected a pending approval.');
    }

    const denied = runtime.decideApproval({
      taskId: waiting.taskId,
      interactionId: pending.id,
      kind: 'approval',
      decision: 'deny',
      actionDigest: pending.actionDigest,
    });

    expect(denied.phase).toBe('observing');
    expect(denied.approvalGrant).toBeNull();
    expect(() =>
      runtime.consumeApprovalGrant({
        taskId: waiting.taskId,
        action: pending.action,
      }),
    ).toThrow('no approved action grant');
  });

  it('expires an approved grant before dispatch', () => {
    let now = new Date('2026-08-15T00:00:00.000Z');
    const runtime = new TaskRuntime({ now: () => now });
    const listener = vi.fn();
    runtime.on('task-update', listener);
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
      },
    });
    const pending = waiting.pendingInteraction;

    if (!pending || pending.kind !== 'approval') {
      throw new Error('Expected a pending approval.');
    }

    const approved = runtime.decideApproval({
      taskId: waiting.taskId,
      interactionId: pending.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: pending.actionDigest,
    });
    now = new Date('2026-08-15T00:06:00.000Z');

    expect(() =>
      runtime.consumeApprovalGrant({
        taskId: approved.taskId,
        action: pending.action,
      }),
    ).toThrow('expired');
    expect(listener.mock.lastCall?.[0].snapshot.phase).toBe('blocked');
    expect(listener.mock.lastCall?.[0].snapshot.approvalGrant).toBeNull();
  });

  it('expires an unused approval and blocks instead of executing it', () => {
    let now = new Date('2026-08-15T00:00:00.000Z');
    const runtime = new TaskRuntime({ now: () => now });
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
      },
    });
    const pending = waiting.pendingInteraction;

    if (!pending || pending.kind !== 'approval') {
      throw new Error('Expected a pending approval.');
    }

    now = new Date('2026-08-15T00:06:00.000Z');
    expect(() =>
      runtime.decideApproval({
        taskId: waiting.taskId,
        interactionId: pending.id,
        kind: 'approval',
        decision: 'approve',
        actionDigest: pending.actionDigest,
      }),
    ).toThrow('expired');
  });

  it('cancels while waiting for task input and invalidates the response', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open Gmail for me' });
    const planning = runtime.start({ taskId: submitted.taskId });
    const waiting = runtime.requestInput({
      taskId: planning.taskId,
      prompt: 'Which inbox should I use?',
    });
    const pending = waiting.pendingInteraction;

    if (!pending) throw new Error('Expected a pending clarification.');

    const cancelled = runtime.cancel({ taskId: waiting.taskId });
    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.pendingInteraction).toBeNull();
    expect(() =>
      runtime.respondToInteraction({
        taskId: waiting.taskId,
        interactionId: pending.id,
        kind: 'answer',
        text: 'Work',
      }),
    ).toThrow('no pending interaction');
  });

  it('queues steering without interrupting an atomic phase and consumes it once', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open Gmail for me' });
    const planning = runtime.start({ taskId: submitted.taskId });

    const steered = runtime.steer({
      taskId: planning.taskId,
      instruction: 'Use my work account instead.',
    });

    expect(steered.phase).toBe('planning');
    expect(steered.queuedSteering).toHaveLength(1);
    expect(steered.messages.at(-1)?.kind).toBe('steering');
    expect(runtime.takeSteering(steered.taskId)).toEqual(
      steered.queuedSteering,
    );
    expect(runtime.takeSteering(steered.taskId)).toEqual([]);
  });

  it('does not treat steering as an answer to pending input', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open Gmail for me' });
    const planning = runtime.start({ taskId: submitted.taskId });
    const waiting = runtime.requestInput({
      taskId: planning.taskId,
      prompt: 'Which inbox should I use?',
    });

    expect(() =>
      runtime.steer({
        taskId: waiting.taskId,
        instruction: 'Use my work account instead.',
      }),
    ).toThrow('pending interaction');
  });

  it('cancels a non-terminal task', () => {
    const runtime = new TaskRuntime();
    const submitted = runtime.submit({ text: 'Open YouTube for me' });
    const cancelled = runtime.cancel({ taskId: submitted.taskId });

    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.pendingInteraction).toBeNull();
  });

  it('tracks an allowed execution step through observation and verification', () => {
    const runtime = new TaskRuntime();
    const ready = runtime.submit({ text: 'Open Gmail for me' });
    runtime.start({ taskId: ready.taskId });
    runtime.beginObservation(ready.taskId, 'Captured the current desktop.');
    runtime.beginAllowedAction(ready.taskId, {
      action: 'open_url',
      capability: 'browser',
      description: 'Open Gmail.',
      target: 'https://mail.google.com/',
    });
    const verifying = runtime.beginVerification(
      ready.taskId,
      'Navigation was dispatched.',
      true,
    );

    expect(verifying.phase).toBe('verifying');
    expect(verifying.progress?.currentStep).toBe(1);
    expect(runtime.complete(ready.taskId, 'Gmail is open.').phase).toBe(
      'completed',
    );
  });
});
