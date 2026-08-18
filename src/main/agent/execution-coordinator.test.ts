import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import type {
  AgentToolOutput,
  ModelToolSpec,
} from './agent-contracts';
import type { AgentRuntime, AgentRuntimeStart } from './agent-runtime';
import type {
  DesktopActionOutcome,
  DesktopCommand,
  DesktopObservation,
} from './execution-contracts';
import {
  TaskExecutionCoordinator,
  type DesktopPresentation,
  type GuidancePresentationHandle,
} from './execution-coordinator';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { TaskRuntime } from './task-runtime';

type FakeAgentTurn =
  | { kind: 'assistant_message'; text: string }
  | {
      kind: 'tool_call';
      call: { arguments: string; callId: string; name: string };
    };

class FakeAgent implements AgentRuntime {
  readonly kind = 'openai_agents' as const;
  readonly completionReviews: string[] = [];
  readonly outputs: AgentToolOutput[] = [];
  readonly userMessages: string[] = [];
  readonly start = vi.fn(
    async (_taskId: string, _request: string, _signal?: AbortSignal) => {
      void _taskId;
      void _request;
      void _signal;
    },
  );
  readonly end = vi.fn(async (_taskId: string) => {
    void _taskId;
  });
  readonly sample = vi.fn(
    async (
      _taskId: string,
      _tools: readonly ModelToolSpec[],
      _signal?: AbortSignal,
    ): Promise<FakeAgentTurn> => {
      void _taskId;
      void _tools;
      void _signal;
      const turn = this.turns.shift();
      if (!turn) throw new Error('Fake agent ran out of turns.');
      return turn;
    },
  );

  constructor(private readonly turns: FakeAgentTurn[]) {}

  private active?: AgentRuntimeStart;

  async runTask(input: AgentRuntimeStart): Promise<string> {
    this.active = input;
    await this.start(input.taskId, input.request, input.signal);
    return this.runTurns(input);
  }

  async continueTask(
    taskId: string,
    _instruction: string,
    _signal?: AbortSignal,
  ): Promise<string> {
    void _instruction;
    void _signal;
    this.completionReviews.push(taskId);
    if (!this.active) throw new Error('Fake agent has no active run.');
    return this.runTurns(this.active);
  }

  private async runTurns(input: AgentRuntimeStart): Promise<string> {
    this.userMessages.push(...(await input.callbacks.beforeModel()));
    const turn = await this.sample(input.taskId, input.tools, input.signal);
    if (turn.kind === 'assistant_message') return turn.text;
    const output = await input.callbacks.executeTool(turn.call);
    this.outputs.push({ callId: turn.call.callId, output });
    return this.runTurns(input);
  }
}

function assistant(text: string): FakeAgentTurn {
  return { kind: 'assistant_message', text };
}

function tool(
  callId: string,
  name: string,
  input: Record<string, unknown>,
): FakeAgentTurn {
  return {
    kind: 'tool_call',
    call: { callId, name, arguments: JSON.stringify(input) },
  };
}

function observation(
  taskId: string,
  observationId = randomUUID(),
  fingerprint = 'a'.repeat(64),
  text = 'Gmail inbox is visible.',
): DesktopObservation {
  return {
    observationId,
    taskId,
    capturedAt: '2026-08-17T00:00:00.000Z',
    text,
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

function setup(
  turns: FakeAgentTurn[],
  observations: DesktopObservation[] = [],
  options: {
    guidanceAutoAdvanceMs?: number;
    presentAction?: (
      command: DesktopCommand,
      signal: AbortSignal,
      presentation?: DesktopPresentation,
    ) => Promise<GuidancePresentationHandle | void>;
  } = {},
) {
  const runtime = new TaskRuntime({ toolRegistry: new RuntimeToolRegistry() });
  const agent = new FakeAgent(turns);
  const cua = {
    startTaskSession: vi.fn(async () => undefined),
    observe: vi.fn(async () => {
      const next = observations.shift();
      if (!next) throw new Error('No fake observation available.');
      return next;
    }),
    executeCommand: vi.fn<
      (
        taskId: string,
        command: DesktopCommand,
        signal?: AbortSignal,
      ) => Promise<DesktopActionOutcome>
    >(async () => ({
      status: 'confirmed',
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
  const openExternal = vi.fn(async () => undefined);
  const coordinator = new TaskExecutionCoordinator({
    agent,
    cua,
    openExternal,
    runtime,
    toolRegistry: registry,
    ...options,
  });
  return { agent, coordinator, cua, openExternal, runtime };
}

describe('TaskExecutionCoordinator', () => {
  it('does not sample the next guidance step until the current one advances', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const cancelNarration = vi.fn();
    const presentAction = vi.fn(async () => ({
      cancel: cancelNarration,
      completion: new Promise<void>(() => undefined),
    }));
    const { agent, coordinator, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the inbox.' }),
        tool('call-guide', 'show_guidance', {
          observationId,
          description: 'Choose the visible filter.',
          target: 'Filter',
          x: 500,
          y: 100,
        }),
        assistant('Continue with the filter.'),
        assistant('Continue with the filter.'),
      ],
      [first],
      { guidanceAutoAdvanceMs: 60_000, presentAction },
    );
    const ready = runtime.submit({ text: 'Guide me through filtering this inbox.' });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledOnce());
    expect(agent.sample).toHaveBeenCalledTimes(2);

    coordinator.nextGuidance(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);
    expect(cancelNarration).toHaveBeenCalledOnce();
    expect(agent.sample).toHaveBeenCalledTimes(4);
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('replays Back and forward guidance without sampling, dispatching, or recording again', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const presentAction = vi.fn(async () => ({
      cancel: vi.fn(),
      completion: Promise.resolve(),
    }));
    const { agent, coordinator, cua, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the inbox.' }),
        tool('call-guide-1', 'show_guidance', {
          observationId,
          description: 'Open the visible filter menu.',
          target: 'Filter',
          x: 500,
          y: 100,
        }),
        tool('call-guide-2', 'show_guidance', {
          observationId,
          description: 'Choose unread messages.',
          target: 'Unread',
          x: 500,
          y: 180,
        }),
        assistant('The walkthrough is complete.'),
        assistant('The walkthrough is complete.'),
      ],
      [first],
      { guidanceAutoAdvanceMs: 60_000, presentAction },
    );
    const ready = runtime.submit({ text: 'Guide me through filtering this inbox.' });
    first.taskId = ready.taskId;
    coordinator.start({ taskId: ready.taskId });
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledTimes(1));
    coordinator.nextGuidance(ready.taskId);
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledTimes(2));
    const samplesAtSecondStep = agent.sample.mock.calls.length;
    const dispatchesAtSecondStep = cua.executeCommand.mock.calls.length;
    const progressAtSecondStep = runtime.getSnapshot(ready.taskId).progress;

    coordinator.previousGuidance(ready.taskId);
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledTimes(3));
    expect(agent.sample).toHaveBeenCalledTimes(samplesAtSecondStep);
    expect(cua.executeCommand).toHaveBeenCalledTimes(dispatchesAtSecondStep);
    expect(runtime.getSnapshot(ready.taskId).progress).toEqual(progressAtSecondStep);

    coordinator.nextGuidance(ready.taskId);
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledTimes(4));
    coordinator.nextGuidance(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it.each([
    ['What is 27 × 14?', '27 × 14 = 378.'],
    ['Dịch “Hello” sang tiếng Việt.', 'Bản dịch hữu ích.'],
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

  it('reviews a generic answer and observes when the request refers to this assignment', async () => {
    const taskId = randomUUID();
    const visibleAssignment = observation(
      taskId,
      randomUUID(),
      'a'.repeat(64),
      'Assignment: solve 3x + 5 = 20.',
    );
    const genericAnswer = 'Please send the assignment so I can help.';
    const solvedAnswer = 'The visible assignment solves to x = 5.';
    const { agent, coordinator, cua, runtime } = setup(
      [
        assistant(genericAnswer),
        tool('call-assignment-observe', 'observe_desktop', {
          reason: 'Inspect the assignment already visible on screen.',
        }),
        assistant(solvedAnswer),
      ],
      [visibleAssignment],
    );
    const ready = runtime.submit({ text: 'Help me work on this assignment.' });
    visibleAssignment.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    const snapshot = runtime.getSnapshot(ready.taskId);
    expect(agent.completionReviews).toEqual([ready.taskId]);
    expect(cua.observe).toHaveBeenCalledOnce();
    expect(snapshot.phase).toBe('completed');
    expect(snapshot.messages.at(-1)?.text).toBe(solvedAnswer);
    expect(snapshot.messages.some((message) => message.text === genericAnswer)).toBe(
      false,
    );
  });

  it('reviews inbox previews and continues until the latest email is opened', async () => {
    const taskId = randomUUID();
    const inboxObservationId = randomUUID();
    const inbox = observation(
      taskId,
      inboxObservationId,
      'a'.repeat(64),
      'Gmail inbox with the newest email in the first row.',
    );
    const openedEmail = observation(
      taskId,
      randomUUID(),
      'b'.repeat(64),
      'The newest email is open with its complete body.',
    );
    const { agent, coordinator, cua, openExternal, runtime } = setup(
      [
        tool('call-gmail-open', 'open_url', {
          url: 'https://mail.google.com/',
          reason: 'Open Gmail.',
        }),
        tool('call-inbox-observe', 'observe_desktop', {
          reason: 'Inspect the Gmail inbox.',
        }),
        assistant('Gmail is open and inbox previews are visible.'),
        tool('call-latest-click', 'control_desktop', {
          observationId: inboxObservationId,
          consequence: 'click_element',
          description: 'Open the newest email in the first inbox row.',
          target: 'Newest inbox row',
          command: {
            kind: 'click',
            x: 500,
            y: 180,
            button: 'left',
            count: 1,
          },
        }),
        assistant('The newest email is open and its complete body is readable.'),
      ],
      [inbox, openedEmail],
    );
    const ready = runtime.submit({
      text: 'Open Gmail and read the latest email.',
    });
    inbox.taskId = ready.taskId;
    openedEmail.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(openExternal).toHaveBeenCalledWith('https://mail.google.com/');
    expect(agent.completionReviews).toEqual([ready.taskId]);
    expect(cua.executeCommand).toHaveBeenCalledWith(
      ready.taskId,
      expect.objectContaining({ kind: 'click' }),
      expect.any(AbortSignal),
    );
    expect(cua.observe).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'completed',
      progress: { completed: 3 },
    });
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

  it('invalidates the cached observation after browser navigation', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const first = observation(taskId, observationId);
    const { agent, coordinator, cua, openExternal, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the inbox.' }),
        tool('call-open', 'open_url', {
          url: 'https://mail.google.com/',
          reason: 'Open Gmail.',
        }),
        tool('call-stale-click', 'control_desktop', {
          observationId,
          consequence: 'click_element',
          description: 'Click using the old page coordinates.',
          target: 'Old inbox row',
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
          },
        }),
        assistant('I need a fresh observation before clicking.'),
        assistant('I need a fresh observation before clicking.'),
      ],
      [first],
    );
    const ready = runtime.submit({ text: 'Open Gmail and inspect the latest email.' });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(openExternal).toHaveBeenCalledWith('https://mail.google.com/');
    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(agent.completionReviews).toEqual([ready.taskId]);
    expect(String(agent.outputs.at(-1)?.output)).toContain(
      'Observe the desktop before requesting a control action.',
    );
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('blocks before capturing more image evidence than the task contract permits', async () => {
    const turns = Array.from({ length: 21 }, (_, index) =>
      tool(`call-observe-${index}`, 'observe_desktop', {
        reason: `Inspect state ${index}.`,
      }),
    );
    const observations = Array.from({ length: 20 }, (_, index) =>
      observation(randomUUID(), randomUUID(), String(index).padStart(64, '0')),
    );
    const { agent, coordinator, cua, runtime } = setup(turns, observations);
    const ready = runtime.submit({ text: 'Inspect the changing screen repeatedly.' });
    for (const current of observations) current.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.observe).toHaveBeenCalledTimes(20);
    expect(agent.sample).toHaveBeenCalledTimes(21);
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: { summary: expect.stringContaining('image-evidence limit') },
    });
  });

  it('blocks after an approved desktop action has an unknown outcome', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const first = observation(taskId, observationId, 'a'.repeat(64));
    const approvedCurrent = observation(taskId, randomUUID(), 'a'.repeat(64));
    const after = observation(taskId, randomUUID(), 'b'.repeat(64));
    const { agent, coordinator, cua, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the inbox.' }),
        tool('call-click', 'control_desktop', {
          observationId,
          consequence: 'delete',
          description: 'Delete the visible message.',
          target: 'Delete button',
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
          },
        }),
      ],
      [first, approvedCurrent, after],
    );
    const ready = runtime.submit({ text: 'Delete the visible message.' });
    first.taskId = ready.taskId;
    approvedCurrent.taskId = ready.taskId;
    after.taskId = ready.taskId;
    cua.executeCommand.mockResolvedValueOnce({
      status: 'unknown',
      summary: 'The click result could not be confirmed.',
    });

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

    expect(agent.sample).toHaveBeenCalledTimes(2);
    expect(agent.end).toHaveBeenCalledWith(ready.taskId);
    expect(cua.endTaskSession).toHaveBeenCalledWith(ready.taskId);
    expect(agent.outputs.at(-1)).toMatchObject({ callId: 'call-click' });
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: {
        status: 'warning',
        summary: expect.stringContaining('unknown outcome'),
      },
    });
  });

  it('returns clarification to the same model call before continuing', async () => {
    const { agent, coordinator, runtime } = setup([
      tool('call-input', 'request_user_input', {
        prompt: 'Who should receive the update?',
        choices: ['Alex', 'Sam'],
      }),
      assistant('I drafted the update for Alex.'),
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
    expect(waiting.pendingInteraction.action.action).toBe('click_element');
    expect(waiting.pendingInteraction.consequence).toContain('permanently remove');
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
    expect(agent.sample).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: {
        status: 'warning',
        summary: expect.stringContaining('screen changed'),
      },
    });
  });

  it('blocks a model attempt to operate TroCode approval UI before requesting approval', async () => {
    const observationId = randomUUID();
    const { agent, coordinator, cua, runtime } = setup([
      tool('call-observe', 'observe_desktop', { reason: 'Inspect the desktop.' }),
      tool('call-self-approve', 'control_desktop', {
        observationId,
        consequence: 'click_element',
        description: 'Click the approval control at the bottom of the TroCode dialog.',
        target: 'Approve exact action button in the TroCode window',
        command: {
          kind: 'click',
          x: 700,
          y: 900,
          button: 'left',
          count: 1,
        },
      }),
    ]);
    const ready = runtime.submit({ text: 'Send the email.' });
    cua.observe.mockResolvedValueOnce(observation(ready.taskId, observationId));

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(agent.sample).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      pendingInteraction: null,
      lastEvent: {
        summary: expect.stringContaining('approval loop'),
      },
    });
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
