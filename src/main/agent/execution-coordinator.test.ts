import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import type {
  AgentModel,
  AgentToolOutput,
  AgentTurn,
  ModelToolSpec,
} from './agent-contracts';
import type { DesktopObservation } from './execution-contracts';
import { TaskExecutionCoordinator } from './execution-coordinator';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { TaskRuntime } from './task-runtime';

class FakeAgent implements AgentModel {
  readonly outputs: AgentToolOutput[] = [];
  readonly userMessages: string[] = [];
  readonly start = vi.fn(async () => undefined);
  readonly end = vi.fn(async () => undefined);
  readonly sample = vi.fn(
    async (
      _taskId: string,
      _tools: readonly ModelToolSpec[],
      _signal?: AbortSignal,
    ): Promise<AgentTurn> => {
      void _taskId;
      void _tools;
      void _signal;
      const turn = this.turns.shift();
      if (!turn) throw new Error('Fake agent ran out of turns.');
      return turn;
    },
  );

  constructor(private readonly turns: AgentTurn[]) {}

  appendToolOutput(_taskId: string, output: AgentToolOutput): void {
    this.outputs.push(output);
  }

  appendUserMessage(_taskId: string, text: string): void {
    this.userMessages.push(text);
  }
}

function assistant(text: string): AgentTurn {
  return { kind: 'assistant_message', responseItems: [], text };
}

function tool(
  callId: string,
  name: string,
  input: Record<string, unknown>,
): AgentTurn {
  return {
    kind: 'tool_call',
    responseItems: [],
    call: { callId, name, arguments: JSON.stringify(input) },
  };
}

function observation(
  taskId: string,
  observationId = randomUUID(),
  fingerprint = 'a'.repeat(64),
): DesktopObservation {
  return {
    observationId,
    taskId,
    capturedAt: '2026-08-17T00:00:00.000Z',
    text: 'Gmail inbox is visible.',
    degraded: false,
    fingerprint,
    coordinateSpace: {
      screenHeight: 500,
      screenWidth: 1000,
      screenshotHeight: 1000,
      screenshotWidth: 2000,
    },
    screenshot: { mimeType: 'image/png', dataBase64: 'aGVsbG8=' },
  };
}

function setup(turns: AgentTurn[], observations: DesktopObservation[] = []) {
  const runtime = new TaskRuntime({ toolRegistry: new RuntimeToolRegistry() });
  const agent = new FakeAgent(turns);
  const cua = {
    startTaskSession: vi.fn(async () => undefined),
    observe: vi.fn(async () => {
      const next = observations.shift();
      if (!next) throw new Error('No fake observation available.');
      return next;
    }),
    executeCommand: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'The desktop action was confirmed.',
    })),
    endTaskSession: vi.fn(async () => undefined),
    getStatus: vi.fn<() => Promise<CuaStatus>>(async () => ({
      state: 'ready' as const,
      available: true,
      platform: 'darwin' as const,
      permissions: { accessibility: true, screenRecording: true },
      summary: 'Ready.',
      nextActions: [],
    })),
  };
  const registry = new RuntimeToolRegistry();
  const coordinator = new TaskExecutionCoordinator({
    agent,
    cua,
    runtime,
    toolRegistry: registry,
  });
  return { agent, coordinator, cua, runtime };
}

describe('TaskExecutionCoordinator', () => {
  it.each([
    ['What is 27 × 14?', '27 × 14 = 378.'],
    ['Dịch câu này sang tiếng Việt.', 'Bản dịch hữu ích.'],
    ['Write an eight-bar chord progression.', 'Am7 – D9 – Gmaj7 – Cmaj7'],
  ])('finishes assistant-only work without starting CUA: %s', async (request, answer) => {
    const { agent, coordinator, cua, runtime } = setup([assistant(answer)]);
    const ready = runtime.submit({ text: request });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'completed',
      progress: { kind: 'tool_calls', completed: 0 },
    });
    expect(cua.startTaskSession).not.toHaveBeenCalled();
    expect(agent.sample).toHaveBeenCalledOnce();
  });

  it('runs observe → one desktop action → fresh observation → assistant', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const first = observation(taskId, observationId, 'a'.repeat(64));
    const after = observation(taskId, randomUUID(), 'b'.repeat(64));
    const { agent, coordinator, cua, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect Gmail.' }),
        tool('call-click', 'control_desktop', {
          observationId,
          consequence: 'click_element',
          description: 'Open the newest email.',
          target: 'Newest inbox row',
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
          },
        }),
        assistant('The newest email is open.'),
      ],
      [first, after],
    );
    const ready = runtime.submit({ text: 'Open Gmail and read the latest email.' });
    first.taskId = ready.taskId;
    after.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.startTaskSession).toHaveBeenCalledOnce();
    expect(cua.observe).toHaveBeenCalledTimes(2);
    expect(cua.executeCommand).toHaveBeenCalledWith(
      ready.taskId,
      expect.objectContaining({ kind: 'click', x: 1000, y: 250 }),
      expect.any(AbortSignal),
    );
    expect(agent.outputs).toHaveLength(2);
    expect(agent.outputs[1]?.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'input_image' }),
      ]),
    );
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'completed',
      progress: { completed: 2 },
    });
  });

  it('returns clarification to the same model call before continuing', async () => {
    const { agent, coordinator, runtime } = setup([
      tool('call-input', 'request_user_input', {
        prompt: 'Who should receive the update?',
        choices: ['Alex', 'Sam'],
      }),
      assistant('I drafted the update for Alex.'),
    ]);
    const ready = runtime.submit({ text: 'Draft and send the update.' });
    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);
    const waiting = runtime.getSnapshot(ready.taskId);
    if (!waiting.pendingInteraction) throw new Error('Expected input.');

    runtime.respondToInteraction({
      taskId: ready.taskId,
      interactionId: waiting.pendingInteraction.id,
      kind: 'answer',
      text: 'Alex',
    });
    coordinator.resume(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    expect(agent.outputs).toContainEqual({
      callId: 'call-input',
      output: JSON.stringify({ status: 'confirmed', answer: 'Alex' }),
    });
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('returns an approval denial to GPT without dispatching the action', async () => {
    const observationId = randomUUID();
    const { agent, coordinator, cua, runtime } = setup([
      tool('call-observe', 'observe_desktop', { reason: 'Inspect the inbox.' }),
      tool('call-delete', 'control_desktop', {
        observationId,
        consequence: 'delete',
        description: 'Delete the selected email.',
        command: {
          kind: 'click',
          x: 900,
          y: 100,
          button: 'left',
          count: 1,
        },
      }),
      assistant('I left the email unchanged.'),
    ]);
    const ready = runtime.submit({ text: 'Delete that email.' });
    const first = observation(ready.taskId, observationId);
    cua.observe.mockResolvedValueOnce(first);

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);
    const waiting = runtime.getSnapshot(ready.taskId);
    if (!waiting.pendingInteraction || waiting.pendingInteraction.kind !== 'approval') {
      throw new Error('Expected approval.');
    }
    runtime.decideApproval({
      taskId: ready.taskId,
      interactionId: waiting.pendingInteraction.id,
      kind: 'approval',
      decision: 'deny',
      actionDigest: waiting.pendingInteraction.actionDigest,
    });
    coordinator.resume(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(agent.outputs.at(-1)).toMatchObject({ callId: 'call-delete' });
    expect(String(agent.outputs.at(-1)?.output)).toContain('denied');
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('invalidates approved desktop work when the screen fingerprint changes', async () => {
    const observationId = randomUUID();
    const { agent, coordinator, cua, runtime } = setup([
      tool('call-observe', 'observe_desktop', { reason: 'Inspect the inbox.' }),
      tool('call-delete', 'control_desktop', {
        observationId,
        consequence: 'delete',
        description: 'Delete the selected email.',
        command: {
          kind: 'click',
          x: 900,
          y: 100,
          button: 'left',
          count: 1,
        },
      }),
      assistant('The screen changed, so I did not delete anything.'),
    ]);
    const ready = runtime.submit({ text: 'Delete that email.' });
    cua.observe
      .mockResolvedValueOnce(observation(ready.taskId, observationId, 'a'.repeat(64)))
      .mockResolvedValueOnce(observation(ready.taskId, randomUUID(), 'b'.repeat(64)));

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);
    const waiting = runtime.getSnapshot(ready.taskId);
    if (!waiting.pendingInteraction || waiting.pendingInteraction.kind !== 'approval') {
      throw new Error('Expected approval.');
    }
    runtime.decideApproval({
      taskId: ready.taskId,
      interactionId: waiting.pendingInteraction.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: waiting.pendingInteraction.actionDigest,
    });
    coordinator.resume(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(JSON.stringify(agent.outputs.at(-1)?.output)).toContain(
      'screen changed',
    );
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('pauses on missing computer permission while keeping the model session alive', async () => {
    const { agent, coordinator, cua, runtime } = setup([
      tool('call-observe', 'observe_desktop', { reason: 'Inspect GarageBand.' }),
    ]);
    cua.startTaskSession.mockRejectedValueOnce(new Error('Permission required.'));
    cua.getStatus.mockResolvedValueOnce({
      state: 'permission_required',
      available: false,
      platform: 'darwin',
      permissions: { accessibility: false, screenRecording: false },
      summary: 'Computer permission required.',
      nextActions: ['Connect computer.'],
    });
    const ready = runtime.submit({ text: 'Make this beat in GarageBand.' });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'awaiting_input',
      pendingInteraction: {
        kind: 'clarification',
        choices: expect.arrayContaining([
          expect.objectContaining({ id: 'connect_computer' }),
        ]),
      },
    });
    expect(agent.end).not.toHaveBeenCalled();
    coordinator.cancel({ taskId: ready.taskId });
  });
});
