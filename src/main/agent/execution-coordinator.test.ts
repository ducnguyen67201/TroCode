import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../../shared/contracts';

import type { ActionPreview } from './action-preview-policy';
import type {
  AgentToolOutput,
  ModelToolSpec,
} from './agent-contracts';
import type { AgentRuntime, AgentRuntimeStart } from './agent-runtime';
import type {
  DesktopActionOutcome,
  DesktopCommand,
  DesktopObservation,
  SurfaceActionOutcome,
  SurfaceCommand,
} from './execution-contracts';
import {
  billableUserTurnIds,
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
    }
  | {
      kind: 'approval_probe';
      call: { arguments: string; callId: string; name: string };
    };

class FakeAgent implements AgentRuntime {
  readonly kind = 'openai_agents' as const;
  readonly completionReviews: string[] = [];
  readonly continuationInstructions: string[] = [];
  readonly outputs: AgentToolOutput[] = [];
  readonly approvalPreviewResults: boolean[] = [];
  readonly userMessages: string[] = [];
  readonly taskStarts: AgentRuntimeStart[] = [];
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
    this.taskStarts.push(input);
    this.active = input;
    await this.start(input.taskId, input.request, input.signal);
    return this.runTurns(input);
  }

  async continueTask(
    taskId: string,
    instruction: string,
    _signal?: AbortSignal,
  ): Promise<string> {
    void _signal;
    this.continuationInstructions.push(instruction);
    this.completionReviews.push(taskId);
    if (!this.active) throw new Error('Fake agent has no active run.');
    return this.runTurns(this.active);
  }

  private async runTurns(input: AgentRuntimeStart): Promise<string> {
    this.userMessages.push(...(await input.callbacks.beforeModel()));
    const turn = await this.sample(input.taskId, input.tools, input.signal);
    if (turn.kind === 'assistant_message') return turn.text;
    if (turn.kind === 'approval_probe') {
      const needsApproval =
        (await input.callbacks.needsApproval?.(turn.call)) ?? false;
      this.approvalPreviewResults.push(needsApproval);
    }
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

function approvalProbe(
  callId: string,
  name: string,
  input: Record<string, unknown>,
): FakeAgentTurn {
  return {
    kind: 'approval_probe',
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
    route: 'desktop_vision',
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
    approvalObservationMatches?: (
      approved: DesktopObservation,
      current: DesktopObservation,
      command: DesktopCommand,
    ) => boolean;
    guidanceAutoAdvanceMs?: number;
    observationTimeoutMs?: number;
    onDesktopControlChange?: (
      taskId: string,
      active: boolean,
    ) => Promise<void> | void;
    presentAction?: (
      command: DesktopCommand,
      signal: AbortSignal,
      presentation?: DesktopPresentation,
    ) => Promise<GuidancePresentationHandle | void>;
    presentActionPreview?: (
      preview: ActionPreview,
      signal: AbortSignal,
    ) => Promise<boolean>;
  } = {},
) {
  const runtime = new TaskRuntime({ toolRegistry: new RuntimeToolRegistry() });
  const agent = new FakeAgent(turns);
  const cua = {
    startTaskSession: vi.fn(async () => undefined),
    observe: vi.fn<
      (
        taskId: string,
        signal?: AbortSignal,
      ) => Promise<DesktopObservation>
    >(async () => {
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
    observeCurrentSurface: vi.fn(async () => undefined),
    executeSurfaceCommand: vi.fn<
      (
        taskId: string,
        observationId: string,
        command: SurfaceCommand,
        signal?: AbortSignal,
      ) => Promise<SurfaceActionOutcome>
    >(async () => ({
      status: 'confirmed',
      summary: 'The semantic action was confirmed.',
    })),
    prepareBrowserAccess: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Browser access was prepared.',
    })),
    revalidateSurfaceAction: vi.fn(async (taskId: string) => ({
      currentObservation: observation(taskId),
      rebound: true,
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
  const openApplication = vi.fn(async () => undefined);
  const coordinator = new TaskExecutionCoordinator({
    agent,
    cua,
    openApplication,
    openExternal,
    runtime,
    toolRegistry: registry,
    ...options,
  });
  return { agent, coordinator, cua, openApplication, openExternal, runtime };
}

describe('TaskExecutionCoordinator', () => {
  it('bills requests, clarification answers, and steering but not approvals', () => {
    const requestId = randomUUID();
    const answerId = randomUUID();
    const steeringId = randomUUID();
    expect(
      billableUserTurnIds([
        { kind: 'request', messageId: requestId, role: 'user' },
        { kind: 'clarification', messageId: randomUUID(), role: 'assistant' },
        { kind: 'answer', messageId: answerId, role: 'user' },
        { kind: 'approval_decision', messageId: randomUUID(), role: 'user' },
        { kind: 'steering', messageId: steeringId, role: 'user' },
      ]),
    ).toEqual([requestId, answerId, steeringId]);
  });

  it('recovers when SDK approval preview receives an invalid desktop pair', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const { agent, coordinator, cua, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the button.' }),
        approvalProbe('call-invalid-guide-click', 'control_desktop', {
          observationId,
          consequence: 'guide',
          description: 'Invalidly mix guidance with a click.',
          target: null,
          sendPayload: null,
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
          },
        }),
        assistant('I did not execute the invalid action.'),
      ],
      [first],
    );
    const ready = runtime.submit({
      text: 'Handle one malformed proposed action safely.',
    });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(agent.approvalPreviewResults).toEqual([false]);
    expect(String(agent.outputs.at(-1)?.output)).toContain('not_executed');
    expect(String(agent.outputs.at(-1)?.output)).toContain(
      'desktop command and declared consequence do not agree',
    );
    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'completed',
      pendingInteraction: null,
    });
  });

  it('rejects an upfront answer dump and forces observe then one guided step', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const presentAction = vi.fn<
      (
        command: DesktopCommand,
        signal: AbortSignal,
        presentation?: DesktopPresentation,
      ) => Promise<GuidancePresentationHandle>
    >(async () => ({
        cancel: vi.fn(),
        completion: Promise.resolve(),
      }));
    const { agent, coordinator, cua, runtime } = setup(
      [
        assistant('Here are all fourteen answers at once.'),
        tool('call-observe', 'observe_desktop', {
          reason: 'Inspect the exercise.',
        }),
        tool('call-guide', 'show_guidance', {
          observationId,
          description: 'Start by identifying the time marker in question one.',
          target: 'Question one',
          x: 500,
          y: 100,
          region: { x: 300, y: 40, width: 400, height: 120 },
        }),
        assistant('WALKTHROUGH_COMPLETE: You completed the guided exercise.'),
        assistant('WALKTHROUGH_COMPLETE: You completed the guided controls.'),
      ],
      [first],
      { guidanceAutoAdvanceMs: 1, presentAction },
    );
    const ready = runtime.submit({
      text: 'Help me do this exercise myself.',
    });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledOnce());
    expect(presentAction.mock.calls[0]?.[2]).toMatchObject({
      screenPoint: { x: 500, y: 50 },
      screenRegion: { x: 300, y: 20, width: 400, height: 60 },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(agent.sample).toHaveBeenCalledTimes(3);
    expect(cua.observe).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot(ready.taskId).phase).not.toBe('completed');

    coordinator.nextGuidance(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    const snapshot = runtime.getSnapshot(ready.taskId);
    expect(agent.continuationInstructions[0]).toContain(
      'upfront text response was rejected',
    );
    expect(snapshot.phase).toBe('completed');
    expect(snapshot.messages.some((message) =>
      message.text.includes('all fourteen answers'),
    )).toBe(false);
  });

  it('requires a new desktop observation before a second guided step', async () => {
    const firstObservationId = randomUUID();
    const secondObservationId = randomUUID();
    const first = observation(randomUUID(), firstObservationId);
    const second = observation(randomUUID(), secondObservationId);
    const presentAction = vi.fn(async () => ({
      cancel: vi.fn(),
      completion: Promise.resolve(),
    }));
    const { agent, coordinator, runtime } = setup(
      [
        tool('call-observe-1', 'observe_desktop', { reason: 'Inspect step one.' }),
        tool('call-guide-1', 'show_guidance', {
          observationId: firstObservationId,
          description: 'Use this first control.',
          target: 'First control',
          x: 400,
          y: 100,
        }),
        tool('call-guide-stale', 'show_guidance', {
          observationId: firstObservationId,
          description: 'Try to show another target without observing.',
          target: 'Stale target',
          x: 500,
          y: 200,
        }),
        tool('call-observe-2', 'observe_desktop', { reason: 'Inspect step two.' }),
        tool('call-guide-2', 'show_guidance', {
          observationId: secondObservationId,
          description: 'Now use this second control.',
          target: 'Second control',
          x: 600,
          y: 200,
        }),
        assistant('The walkthrough is complete.'),
        assistant('WALKTHROUGH_COMPLETE: You completed the guided controls.'),
      ],
      [first, second],
      { presentAction },
    );
    const ready = runtime.submit({ text: 'Walk me through these controls.' });
    first.taskId = ready.taskId;
    second.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledOnce());
    coordinator.nextGuidance(ready.taskId);
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledTimes(2));

    expect(String(agent.outputs[2]?.output)).toContain(
      'fresh observe_desktop',
    );
    expect(presentAction).toHaveBeenCalledTimes(2);
    coordinator.nextGuidance(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

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
        assistant('WALKTHROUGH_COMPLETE: You completed the inbox filter step.'),
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
    const secondObservationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const second = observation(randomUUID(), secondObservationId);
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
        tool('call-observe-2', 'observe_desktop', {
          reason: 'Inspect the inbox after the user completed step one.',
        }),
        tool('call-guide-2', 'show_guidance', {
          observationId: secondObservationId,
          description: 'Choose unread messages.',
          target: 'Unread',
          x: 500,
          y: 180,
        }),
        assistant('The walkthrough is complete.'),
        assistant('WALKTHROUGH_COMPLETE: You completed the inbox walkthrough.'),
      ],
      [first, second],
      { guidanceAutoAdvanceMs: 60_000, presentAction },
    );
    const ready = runtime.submit({ text: 'Guide me through filtering this inbox.' });
    first.taskId = ready.taskId;
    second.taskId = ready.taskId;
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

  it('suppresses an answer dump after a guided step when completion is not attested', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const presentAction = vi.fn(async () => ({
      cancel: vi.fn(),
      completion: Promise.resolve(),
    }));
    const answerDump = 'Answers: 1. lives 2. is watering 3. is a teacher.';
    const { coordinator, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the exercise.' }),
        tool('call-guide', 'show_guidance', {
          observationId,
          description: 'Identify the time marker in the first question.',
          target: 'Question one',
          x: 500,
          y: 100,
        }),
        assistant(answerDump),
        assistant(answerDump),
      ],
      [first],
      { presentAction },
    );
    const ready = runtime.submit({ text: 'Guide me through the exercise.' });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledOnce());
    coordinator.nextGuidance(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    const snapshot = runtime.getSnapshot(ready.taskId);
    expect(snapshot.phase).toBe('blocked');
    expect(snapshot.messages.some((message) => message.text === answerDump)).toBe(
      false,
    );
  });

  it('strips a valid completion sentinel and appends only its concise recap', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const presentAction = vi.fn(async () => ({
      cancel: vi.fn(),
      completion: Promise.resolve(),
    }));
    const { coordinator, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the exercise.' }),
        tool('call-guide', 'show_guidance', {
          observationId,
          description: 'Identify the verb in the first question.',
          target: 'Question one',
          x: 500,
          y: 100,
        }),
        assistant('Candidate completion that must remain hidden.'),
        assistant('WALKTHROUGH_COMPLETE: You completed the guided exercise.'),
      ],
      [first],
      { presentAction },
    );
    const ready = runtime.submit({ text: 'Show me how to do the exercise.' });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await vi.waitFor(() => expect(presentAction).toHaveBeenCalledOnce());
    coordinator.nextGuidance(ready.taskId);
    await coordinator.waitForIdle(ready.taskId);

    const snapshot = runtime.getSnapshot(ready.taskId);
    expect(snapshot.phase).toBe('completed');
    expect(snapshot.messages.at(-1)?.text).toBe(
      'You completed the guided exercise.',
    );
    expect(snapshot.messages.some((message) =>
      message.text.includes('Candidate completion'),
    )).toBe(false);
  });

  it('blocks without waiting for Next when the guidance overlay is unavailable', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const presentAction = vi.fn(async () => undefined);
    const { coordinator, cua, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect the exercise.' }),
        tool('call-guide', 'show_guidance', {
          observationId,
          description: 'Identify the verb in the first question.',
          target: 'Question one',
          x: 500,
          y: 100,
        }),
      ],
      [first],
      { presentAction },
    );
    const ready = runtime.submit({ text: 'Guide me through the exercise.' });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    let reachedIdle = false;
    try {
      reachedIdle = await Promise.race([
        coordinator.waitForIdle(ready.taskId).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(reachedIdle).toBe(true);
    } finally {
      if (!reachedIdle) coordinator.cancel({ taskId: ready.taskId });
    }

    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: { summary: expect.stringContaining('guidance overlay') },
    });
    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(runtime.getSnapshot(ready.taskId).messages).toHaveLength(1);
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

  it('captures screen-dependent work once before the first model sample', async () => {
    const first = observation(
      randomUUID(),
      randomUUID(),
      'a'.repeat(64),
      'A blank Google Sheet is open in the browser.',
    );
    const { agent, coordinator, cua, runtime } = setup(
      [
        assistant('I created the daily money tracker in the open sheet.'),
        assistant('I created the daily money tracker in the open sheet.'),
      ],
      [first],
    );
    const ready = runtime.submit({
      text: 'Create me a simple sheet for tracking money.',
    });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    const initialObservation = (
      agent.taskStarts[0] as AgentRuntimeStart & {
        initialObservation?: DesktopObservation;
      }
    ).initialObservation;
    expect(cua.observe).toHaveBeenCalledOnce();
    expect(initialObservation).toMatchObject({
      observationId: first.observationId,
      text: 'A blank Google Sheet is open in the browser.',
    });
    expect(agent.sample).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'completed',
      progress: { kind: 'tool_calls', completed: 1 },
    });
  });

  it.each([
    'Help me work on this assignment.',
    'Giúp tôi làm bài tập Eroki.',
  ])('pre-observes an assignment for visible or implicit context: %s', async (request) => {
    const taskId = randomUUID();
    const visibleAssignment = observation(
      taskId,
      randomUUID(),
      'a'.repeat(64),
      'Assignment: solve 3x + 5 = 20.',
    );
    const solvedAnswer = 'The visible assignment solves to x = 5.';
    const { agent, coordinator, cua, runtime } = setup(
      [assistant(solvedAnswer), assistant(solvedAnswer)],
      [visibleAssignment],
    );
    const ready = runtime.submit({ text: request });
    visibleAssignment.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    const snapshot = runtime.getSnapshot(ready.taskId);
    expect(agent.completionReviews).toEqual([ready.taskId]);
    expect(agent.continuationInstructions[0]).toContain(
      'Do not claim the user failed to supply the screen',
    );
    expect(agent.continuationInstructions[0]).toContain('tutorial Next');
    expect(agent.continuationInstructions[0]).toContain(
      'The user delegated visible work',
    );
    expect(agent.continuationInstructions[0]).toContain(
      'routine, reversible visible action',
    );
    expect(cua.observe).toHaveBeenCalledOnce();
    expect(snapshot.phase).toBe('completed');
    expect(snapshot.messages.at(-1)?.text).toBe(solvedAnswer);
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

  it('shows the trusted action preview before dispatching a desktop action', async () => {
    const sequence: string[] = [];
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId, 'a'.repeat(64));
    const after = observation(randomUUID(), randomUUID(), 'b'.repeat(64));
    const presentActionPreview = vi.fn(async (preview: ActionPreview) => {
      sequence.push('preview');
      expect(preview).toMatchObject({
        classroom: false,
        message: 'Next: Open the newest email.',
        screenPoint: { x: 500, y: 125 },
        screenRegion: { x: 468, y: 101, width: 64, height: 48 },
        target: 'Newest inbox row',
      });
      return true;
    });
    const { coordinator, cua, runtime } = setup(
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
      { presentActionPreview },
    );
    const ready = runtime.submit({ text: 'Open my latest email.' });
    first.taskId = ready.taskId;
    after.taskId = ready.taskId;
    cua.executeCommand.mockImplementationOnce(async () => {
      sequence.push('dispatch');
      return {
        status: 'confirmed',
        summary: 'The desktop action was confirmed.',
      };
    });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(sequence).toEqual(['preview', 'dispatch']);
    expect(presentActionPreview).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('does not dispatch when the required action preview is unavailable', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId);
    const { coordinator, cua, runtime } = setup(
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
      ],
      [first],
      { presentActionPreview: async () => false },
    );
    const ready = runtime.submit({ text: 'Open my latest email.' });
    first.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.executeCommand).not.toHaveBeenCalled();
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: { summary: expect.stringContaining('preview was unavailable') },
    });
  });

  it('previews direct navigation before opening the external URL', async () => {
    const sequence: string[] = [];
    const presentActionPreview = vi.fn(async (preview: ActionPreview) => {
      sequence.push('preview');
      expect(preview.message).toBe('Next: Open the example site.');
      return true;
    });
    const { coordinator, openExternal, runtime } = setup(
      [
        tool('call-open', 'open_url', {
          url: 'https://example.com/',
          reason: 'Open the example site.',
        }),
        assistant('The example site is open.'),
      ],
      [],
      { presentActionPreview },
    );
    openExternal.mockImplementationOnce(async () => {
      sequence.push('dispatch');
    });
    const ready = runtime.submit({ text: 'Open example.com.' });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(sequence).toEqual(['preview', 'dispatch']);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('launches Chrome directly without starting a CUA session', async () => {
    const sequence: string[] = [];
    const presentActionPreview = vi.fn(async () => {
      sequence.push('preview');
      return true;
    });
    const { coordinator, cua, openApplication, runtime } = setup(
      [
        tool('call-open-chrome', 'open_application', {
          application: 'chrome',
          reason: 'Open Google Chrome.',
        }),
        assistant('Google Chrome is open.'),
      ],
      [],
      { presentActionPreview },
    );
    openApplication.mockImplementationOnce(async () => {
      sequence.push('dispatch');
    });
    const ready = runtime.submit({ text: 'Open Chrome.' });

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(sequence).toEqual(['preview', 'dispatch']);
    expect(openApplication).toHaveBeenCalledWith('chrome');
    expect(cua.startTaskSession).not.toHaveBeenCalled();
  });

  it('blocks promptly when post-action desktop verification stalls', async () => {
    const observationId = randomUUID();
    const first = observation(randomUUID(), observationId, 'a'.repeat(64));
    const { agent, coordinator, cua, runtime } = setup(
      [
        tool('call-observe', 'observe_desktop', { reason: 'Inspect Sheets.' }),
        tool('call-keypress', 'control_desktop', {
          observationId,
          consequence: 'press_key',
          description: 'Clear the selected spreadsheet cell.',
          target: 'Selected cell',
          command: {
            kind: 'keypress',
            keys: ['BACKSPACE'],
          },
        }),
      ],
      [first],
      { observationTimeoutMs: 10 },
    );
    const ready = runtime.submit({ text: 'Clear the selected spreadsheet cell.' });
    first.taskId = ready.taskId;
    cua.observe
      .mockResolvedValueOnce(first)
      .mockImplementationOnce(
        (_taskId: string, signal?: AbortSignal) =>
          new Promise<DesktopObservation>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('Desktop observation aborted.');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true },
            );
          }),
      );

    coordinator.start({ taskId: ready.taskId });
    let reachedIdle = false;
    try {
      reachedIdle = await Promise.race([
        coordinator.waitForIdle(ready.taskId).then(() => true),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), 80),
        ),
      ]);
      expect(reachedIdle).toBe(true);
    } finally {
      if (!reachedIdle) coordinator.cancel({ taskId: ready.taskId });
    }

    expect(agent.sample).toHaveBeenCalledTimes(2);
    expect(String(agent.outputs.at(-1)?.output)).toContain(
      'Desktop observation timed out',
    );
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: {
        summary: expect.stringContaining('fresh desktop state required'),
      },
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
    expect(agent.sample).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot(ready.taskId)).toMatchObject({
      phase: 'blocked',
      lastEvent: {
        status: 'warning',
        summary: expect.stringContaining('screen changed'),
      },
    });
  });

  it('executes approved work when perceptual matching confirms only incidental screen changes', async () => {
    const observationId = randomUUID();
    const approved = observation(
      randomUUID(),
      observationId,
      'a'.repeat(64),
    );
    const current = observation(randomUUID(), randomUUID(), 'b'.repeat(64));
    const after = observation(randomUUID(), randomUUID(), 'c'.repeat(64));
    const matches = vi.fn(() => true);
    const { agent, coordinator, cua, runtime } = setup(
      [
        tool('call-delete-stable', 'control_desktop', {
          observationId,
          consequence: 'delete',
          description: 'Delete the selected email.',
          target: 'Delete button',
          command: {
            kind: 'click',
            x: 900,
            y: 100,
            button: 'left',
            count: 1,
          },
        }),
        assistant('The selected email was deleted.'),
        assistant('The selected email was deleted.'),
      ],
      [approved, current, after],
      { approvalObservationMatches: matches },
    );
    const ready = runtime.submit({ text: 'Delete that email.' });
    approved.taskId = ready.taskId;
    current.taskId = ready.taskId;
    after.taskId = ready.taskId;

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

    expect(matches).toHaveBeenCalledWith(
      approved,
      current,
      expect.objectContaining({ kind: 'click', x: 1800, y: 100 }),
    );
    expect(cua.executeCommand).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
    expect(agent.outputs).toContainEqual(
      expect.objectContaining({ callId: 'call-delete-stable' }),
    );
  });

  it('keeps desktop control visible for the session and hides it after a failure', async () => {
    const observationId = randomUUID();
    const before = observation(randomUUID(), observationId, 'a'.repeat(64));
    const after = observation(randomUUID(), randomUUID(), 'b'.repeat(64));
    const controlChanges = vi.fn(async () => undefined);
    const { coordinator, cua, runtime } = setup(
      [
        tool('call-observe-before-type', 'observe_desktop', {
          reason: 'Inspect the worksheet.',
        }),
        tool('call-type-fails', 'control_desktop', {
          observationId,
          consequence: 'type_text',
          description: 'Type into the selected worksheet cell.',
          target: 'Selected worksheet cell',
          command: { kind: 'type_text', text: 'Ngày' },
        }),
        assistant('The text could not be entered.'),
        assistant('The text could not be entered.'),
      ],
      [before, after],
      { onDesktopControlChange: controlChanges },
    );
    const ready = runtime.submit({ text: 'Type Ngày into the selected cell.' });
    before.taskId = ready.taskId;
    after.taskId = ready.taskId;
    cua.executeCommand.mockRejectedValueOnce(new Error('Driver failed.'));

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    await vi.waitFor(() => expect(controlChanges).toHaveBeenCalledTimes(2));
    expect(controlChanges.mock.calls).toEqual([
      [ready.taskId, true],
      [ready.taskId, false],
    ]);
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('does not blink desktop control between consecutive actions', async () => {
    const firstObservationId = randomUUID();
    const secondObservationId = randomUUID();
    const first = observation(
      randomUUID(),
      firstObservationId,
      'a'.repeat(64),
    );
    const second = observation(
      randomUUID(),
      secondObservationId,
      'b'.repeat(64),
    );
    const third = observation(randomUUID(), randomUUID(), 'c'.repeat(64));
    const controlChanges = vi.fn(async () => undefined);
    const { coordinator, cua, runtime } = setup(
      [
        tool('call-first-click', 'control_desktop', {
          observationId: firstObservationId,
          consequence: 'click_element',
          description: 'Click the first control.',
          target: 'First control',
          command: { kind: 'click', x: 300, y: 180, button: 'left', count: 1 },
        }),
        tool('call-second-click', 'control_desktop', {
          observationId: secondObservationId,
          consequence: 'click_element',
          description: 'Click the second control.',
          target: 'Second control',
          command: { kind: 'click', x: 700, y: 320, button: 'left', count: 1 },
        }),
        assistant('Both controls were clicked.'),
        assistant('Both controls were clicked.'),
      ],
      [first, second, third],
      { onDesktopControlChange: controlChanges },
    );
    const ready = runtime.submit({ text: 'Click these two controls.' });
    first.taskId = ready.taskId;
    second.taskId = ready.taskId;
    third.taskId = ready.taskId;

    coordinator.start({ taskId: ready.taskId });
    await coordinator.waitForIdle(ready.taskId);

    expect(cua.executeCommand).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(controlChanges).toHaveBeenCalledTimes(2));
    expect(controlChanges.mock.calls).toEqual([
      [ready.taskId, true],
      [ready.taskId, false],
    ]);
    expect(runtime.getSnapshot(ready.taskId).phase).toBe('completed');
  });

  it('blocks a model attempt to operate Tro approval UI before requesting approval', async () => {
    const observationId = randomUUID();
    const { agent, coordinator, cua, runtime } = setup([
      tool('call-observe', 'observe_desktop', { reason: 'Inspect the desktop.' }),
      tool('call-self-approve', 'control_desktop', {
        observationId,
        consequence: 'click_element',
        description: 'Click the approval control at the bottom of the Tro dialog.',
        target: 'Approve exact action button in the Tro window',
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
