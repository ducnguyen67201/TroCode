import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  DesktopActionOutcome,
  DesktopCommand,
  DesktopObservation,
  DesktopStepDecision,
} from './execution-contracts';
import { TaskExecutionCoordinator } from './execution-coordinator';
import type { DesktopPlanner, PlannerStepInput } from './realtime-planner';
import { TaskRuntime } from './task-runtime';

class FakeCua {
  readonly startTaskSession = vi.fn(async () => undefined);

  readonly endTaskSession = vi.fn(async () => undefined);

  readonly executeCommand = vi.fn(
    async (
      _taskId: string,
      _command: DesktopCommand,
      _signal?: AbortSignal,
    ): Promise<DesktopActionOutcome> => {
      void _taskId;
      void _command;
      void _signal;
      return {
        status: 'confirmed',
        summary: 'CUA confirmed the action.',
      };
    },
  );

  private observationNumber = 0;

  readonly observe = vi.fn(async (taskId: string): Promise<DesktopObservation> => {
    this.observationNumber += 1;
    return {
      observationId: randomUUID(),
      taskId,
      capturedAt: new Date().toISOString(),
      text: `Desktop observation ${this.observationNumber}`,
      screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
      degraded: false,
      fingerprint: String(this.observationNumber).padStart(64, '0'),
    };
  });
}

describe('task execution coordinator', () => {
  it('opens Gmail, re-observes, and completes without visual retry', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    const actionOrder: string[] = [];
    const openExternal = vi.fn(async () => {
      actionOrder.push('open');
    });
    const presentAction = vi.fn(async () => {
      actionOrder.push('present');
    });
    const prepareDesktop = vi.fn(async () => undefined);
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi
        .fn()
        .mockImplementationOnce(async (_taskId, input: PlannerStepInput) => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'open_url',
          capability: 'browser',
          description: 'Open Gmail.',
          command: { kind: 'open_url', url: 'https://mail.google.com/' },
        }))
        .mockImplementationOnce(async () => ({
          kind: 'complete',
          summary: 'Gmail is visible in the browser.',
        })),
    };
    const coordinator = new TaskExecutionCoordinator({
      runtime,
      cua,
      planner,
      openExternal,
      prepareDesktop,
      presentAction,
    });
    const ready = runtime.submit({ text: 'Open Gmail for me' });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
    expect(openExternal).toHaveBeenCalledOnce();
    expect(presentAction).toHaveBeenCalledWith(
      { kind: 'open_url', url: 'https://mail.google.com/' },
      expect.any(AbortSignal),
    );
    expect(actionOrder).toEqual(['open', 'present']);
    expect(prepareDesktop).toHaveBeenCalledTimes(2);
    expect(cua.observe).toHaveBeenCalledTimes(2);
    expect(cua.executeCommand).not.toHaveBeenCalled();
  });

  it('waits for exact approval and re-observes before one send click', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    const actionOrder: string[] = [];
    const presentAction = vi.fn(async () => {
      actionOrder.push('present');
    });
    cua.executeCommand.mockImplementation(async () => {
      actionOrder.push('execute');
      return {
        status: 'confirmed',
        summary: 'CUA confirmed the action.',
      };
    });
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi
        .fn()
        .mockImplementationOnce(async (_taskId, input: PlannerStepInput) => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'send',
          capability: 'email',
          description: 'Send the drafted email.',
          target: 'Gmail Send button',
          sendPayload: {
            account: 'me@example.com',
            recipients: ['me@example.com'],
            subject: 'TroCode test',
            body: 'This is the requested test message.',
          },
          command: {
            kind: 'click',
            x: 812,
            y: 744,
            button: 'left',
            count: 1,
          },
        }))
        .mockImplementationOnce(async (_taskId, input: PlannerStepInput) => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'send',
          capability: 'email',
          description: 'Send the drafted email.',
          target: 'Gmail Send button',
          sendPayload: {
            account: 'me@example.com',
            recipients: ['me@example.com'],
            subject: 'TroCode test',
            body: 'This is the requested test message.',
          },
          command: {
            kind: 'click',
            x: 812,
            y: 744,
            button: 'left',
            count: 1,
          },
        }))
        .mockImplementationOnce(async () => ({
          kind: 'complete',
          summary: 'Gmail shows the message was sent.',
        })),
    };
    const coordinator = new TaskExecutionCoordinator({
      runtime,
      cua,
      planner,
      presentAction,
    });
    const ready = runtime.submit({
      text: 'Open Gmail and send an email to me',
    });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);
    const waiting = runtime.getSnapshot(ready.taskId);
    expect(waiting.phase, waiting.lastEvent?.summary).toBe('awaiting_approval');
    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(presentAction).not.toHaveBeenCalled();

    const approval = waiting.pendingInteraction;
    if (approval?.kind !== 'approval') throw new Error('Expected approval.');
    runtime.decideApproval({
      taskId: ready.taskId,
      interactionId: approval.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: approval.actionDigest,
    });
    coordinator.resume(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
    expect(cua.observe).toHaveBeenCalledTimes(3);
    expect(cua.executeCommand).toHaveBeenCalledOnce();
    expect(presentAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', x: 812, y: 744 }),
      expect.any(AbortSignal),
    );
    expect(actionOrder).toEqual(['present', 'execute']);
  });

  it('blocks visual actions when the compiled goal did not grant computer use', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi.fn(
        async (
          _taskId,
          input: PlannerStepInput,
        ): Promise<DesktopStepDecision> => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'click_element',
          capability: 'email',
          description: 'Open the first message.',
          command: {
            kind: 'click',
            x: 400,
            y: 300,
            button: 'left',
            count: 1,
          },
        }),
      ),
    };
    const coordinator = new TaskExecutionCoordinator({ runtime, cua, planner });
    const ready = runtime.submit({ text: 'Read my Gmail messages' });

    expect(ready.goal?.capabilities).not.toContain('computer_use');
    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    const blocked = runtime.getSnapshot(ready.taskId);
    expect(blocked.phase).toBe('blocked');
    expect(blocked.lastEvent?.summary).toContain('computer-use capability');
    expect(cua.executeCommand).not.toHaveBeenCalled();
  });

  it('requests fresh approval when the approved action changes after re-observation', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi
        .fn()
        .mockImplementationOnce(async (_taskId, input: PlannerStepInput) => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'send',
          capability: 'email',
          description: 'Send the drafted email.',
          target: 'Gmail Send button',
          command: {
            kind: 'click',
            x: 812,
            y: 744,
            button: 'left',
            count: 1,
          },
        }))
        .mockImplementationOnce(async (_taskId, input: PlannerStepInput) => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'send',
          capability: 'email',
          description: 'Send the edited drafted email.',
          target: 'Gmail Send button',
          command: {
            kind: 'click',
            x: 815,
            y: 744,
            button: 'left',
            count: 1,
          },
        })),
    };
    const coordinator = new TaskExecutionCoordinator({ runtime, cua, planner });
    const ready = runtime.submit({
      text: 'Open Gmail and send an email to me',
    });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);
    const firstWaiting = runtime.getSnapshot(ready.taskId);
    const firstApproval = firstWaiting.pendingInteraction;
    if (firstApproval?.kind !== 'approval') throw new Error('Expected approval.');

    runtime.decideApproval({
      taskId: ready.taskId,
      interactionId: firstApproval.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: firstApproval.actionDigest,
    });
    coordinator.resume(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    const secondWaiting = runtime.getSnapshot(ready.taskId);
    const secondApproval = secondWaiting.pendingInteraction;
    expect(secondWaiting.phase).toBe('awaiting_approval');
    if (secondApproval?.kind !== 'approval') throw new Error('Expected approval.');
    expect(secondApproval.actionDigest).not.toBe(firstApproval.actionDigest);
    expect(cua.executeCommand).not.toHaveBeenCalled();
  });

  it('blocks after an unknown action outcome without retrying', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    cua.executeCommand.mockResolvedValue({
      status: 'unknown',
      summary: 'CUA could not prove whether the click changed the screen.',
    });
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi.fn(async (_taskId, input: PlannerStepInput) => ({
        kind: 'action',
        observationId: input.observation.observationId,
        intent: 'click_element',
        capability: 'computer_use',
        description: 'Click the visible button.',
        command: { kind: 'click', x: 400, y: 300, button: 'left', count: 1 },
      } as const)),
    };
    const coordinator = new TaskExecutionCoordinator({ runtime, cua, planner });
    const ready = runtime.submit({ text: 'Click the button on screen' });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    const blocked = runtime.getSnapshot(ready.taskId);
    expect(blocked.phase).toBe('blocked');
    expect(blocked.lastEvent?.summary).toContain('unknown');
    expect(cua.executeCommand).toHaveBeenCalledOnce();
    expect(planner.decide).toHaveBeenCalledOnce();
  });

  it('fails closed when the model references a stale observation', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi.fn(async () => ({
        kind: 'action',
        observationId: randomUUID(),
        intent: 'open_url',
        capability: 'browser',
        description: 'Open Gmail.',
        command: { kind: 'open_url', url: 'https://mail.google.com/' },
      } as const)),
    };
    const coordinator = new TaskExecutionCoordinator({
      runtime,
      cua,
      planner,
      openExternal: vi.fn(async () => undefined),
    });
    const ready = runtime.submit({ text: 'Open Gmail for me' });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    const failed = runtime.getSnapshot(ready.taskId);
    expect(failed.phase).toBe('failed');
    expect(failed.lastEvent?.summary).toContain('stale observation');
    expect(cua.executeCommand).not.toHaveBeenCalled();
  });

  it('never turns a how-to guide into permission to operate the desktop', async () => {
    const runtime = new TaskRuntime();
    const cua = new FakeCua();
    const openExternal = vi.fn(async () => undefined);
    const planner: DesktopPlanner = {
      start: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      decide: vi.fn(
        async (
          _taskId,
          input: PlannerStepInput,
        ): Promise<DesktopStepDecision> => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'open_url',
          capability: 'browser',
          description: 'Open Gmail.',
          command: { kind: 'open_url', url: 'https://mail.google.com/' },
        }),
      ),
    };
    const coordinator = new TaskExecutionCoordinator({
      runtime,
      cua,
      planner,
      openExternal,
    });
    const ready = runtime.submit({ text: 'How do I open Gmail?' });

    expect(ready.goal?.interactionMode).toBe('guide');
    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(runtime.getSnapshot(ready.taskId).phase).toBe('blocked');
    expect(openExternal).not.toHaveBeenCalled();
    expect(cua.executeCommand).not.toHaveBeenCalled();
  });

  it('aborts an in-flight action at the task deadline and marks its outcome unknown', async () => {
    vi.useFakeTimers();
    try {
      const runtime = new TaskRuntime();
      const cua = new FakeCua();
      cua.executeCommand.mockImplementation(
        async (_taskId, _command, signal): Promise<DesktopActionOutcome> =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          }),
      );
      const planner: DesktopPlanner = {
        start: vi.fn(async () => undefined),
        end: vi.fn(async () => undefined),
        decide: vi.fn(async (_taskId, input: PlannerStepInput) => ({
          kind: 'action',
          observationId: input.observation.observationId,
          intent: 'click_element',
          capability: 'computer_use',
          description: 'Click the visible button.',
          command: { kind: 'click', x: 400, y: 300, button: 'left', count: 1 },
        } as const)),
      };
      const coordinator = new TaskExecutionCoordinator({ runtime, cua, planner });
      const ready = runtime.submit({ text: 'Click the button on screen' });

      coordinator.start({ taskId: ready.taskId });
      await vi.waitFor(() => expect(cua.executeCommand).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(ready.goal!.limits.maxMinutes * 60_000);
      await coordinator.waitForIdle(ready.taskId);

      const blocked = runtime.getSnapshot(ready.taskId);
      expect(blocked.phase).toBe('blocked');
      expect(blocked.lastEvent?.summary).toContain('outcome is unknown');
      expect(cua.executeCommand).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
