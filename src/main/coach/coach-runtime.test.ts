import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuidanceClaim, GuidanceContinue } from '../../shared/contracts';
import type { DesktopObservation } from '../agent/execution-contracts';
import { ActivityContextService } from '../knowledge/activity-context-service';
import { classroomFixture } from '../knowledge/classroom-broadcast.fixture';
import type { KnowledgeSpaceClient } from '../knowledge/knowledge-space-client';
import { workCheckFixture } from '../knowledge/work-check.fixture';

import { CoachDecisionSchema, type CoachRuntimeStart } from './coach-contracts';
import {
  CoachRuntime,
  coachResponseRequest,
  createAuthenticatedCoachDecisionClient,
  type CoachRuntimeDependencies,
} from './coach-runtime';

const fingerprint = 'a'.repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

function observation(overrides: Partial<DesktopObservation> = {}): DesktopObservation {
  return {
    observationId: randomUUID(),
    taskId: randomUUID(),
    capturedAt: '2026-09-02T00:00:00.000Z',
    text: 'Scratch Variables button',
    coordinateSpace: {
      screenHeight: 800,
      screenWidth: 1_200,
      screenshotHeight: 800,
      screenshotWidth: 1_200,
    },
    route: 'desktop_vision',
    degraded: false,
    fingerprint,
    ...overrides,
  };
}

function setup(
  decide: CoachRuntimeDependencies['decide'],
  presenterResult: Awaited<
    ReturnType<CoachRuntimeDependencies['presenter']['presentSequence']>
  > | null = null,
) {
  const current = observation();
  const terminal = vi.fn<CoachRuntimeDependencies['onTerminal']>();
  const status = vi.fn<CoachRuntimeDependencies['onStatus']>();
  const startObservationSession = vi.fn(async () => undefined);
  const releaseObservationSession = vi.fn();
  const observe = vi.fn(async () => current);
  const presentSequence = vi.fn(async (
    steps: Parameters<CoachRuntimeDependencies['presenter']['presentSequence']>[0],
    context: Parameters<CoachRuntimeDependencies['presenter']['presentSequence']>[1],
  ) => {
    if (presenterResult) {
      for (const [index, step] of steps.entries()) {
        await context.onStepStart?.(step, index, steps.length);
      }
      return presenterResult;
    }
    return new Promise((_, reject) => {
      context.signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  });
  const presenter = {
    beginSession: vi.fn(),
    cancelGuidance: vi.fn(),
    finishSession: vi.fn(),
    presentSequence,
  } as unknown as CoachRuntimeDependencies['presenter'];
  const dependencies: CoachRuntimeDependencies = {
    decide: vi.fn(decide),
    startObservationSession,
    releaseObservationSession,
    observe,
    onProgress: vi.fn(),
    onStatus: status,
    onTerminal: terminal,
    presenter,
  };
  return {
    current,
    dependencies,
    observe,
    presentSequence,
    releaseObservationSession,
    runtime: new CoachRuntime(dependencies),
    startObservationSession,
    status,
    terminal,
  };
}

function sequenceFor(current: DesktopObservation) {
  return {
    kind: 'coach_sequence' as const,
    language: 'en' as const,
    observationId: current.observationId,
    observationFingerprint: current.fingerprint,
    steps: [
      {
        hook: 'Ready?',
        instruction: 'Open Variables.',
        reason: 'It stores a changing score.',
        expectedOutcome: 'The Variables palette appears.',
        target: 'Variables button',
        point: { x: 200, y: 400 },
      },
      {
        hook: 'Next!',
        instruction: 'Choose Make a Variable.',
        reason: 'This creates a place for the score.',
        expectedOutcome: 'The variable dialog opens.',
        target: 'Make a Variable button',
        point: { x: 800, y: 200 },
      },
    ],
  };
}

describe('Coach decision contract', () => {
  it('rejects legacy model-owned target rectangles', () => {
    const current = observation();

    expect(CoachDecisionSchema.safeParse({
      ...sequenceFor(current),
      steps: [{
        ...sequenceFor(current).steps[0],
        region: { x: 150, y: 350, width: 100, height: 100 },
      }],
    }).success).toBe(false);
  });

  it('bounds a sequence to eight visible targets', () => {
    const current = observation();
    const sequence = sequenceFor(current);

    expect(CoachDecisionSchema.safeParse({
      ...sequence,
      steps: Array.from({ length: 9 }, () => sequence.steps[0]),
    }).success).toBe(false);
  });
});

describe('CoachRuntime', () => {
  it('uses one capture and one model call for the complete visible sequence', async () => {
    const setupResult = setup(
      async ({ observation: current }) => sequenceFor(current!),
      { outcome: 'presented' },
    );
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'Show me how to do this',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.dependencies.presenter.presentSequence).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.observe).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledWith(
      taskId,
      expect.any(AbortSignal),
    );
    expect(setupResult.startObservationSession.mock.invocationCallOrder[0])
      .toBeLessThan(setupResult.observe.mock.invocationCallOrder[0]!);
    expect(setupResult.dependencies.decide).toHaveBeenCalledOnce();
    expect(setupResult.dependencies.presenter.presentSequence).toHaveBeenCalledOnce();
    const presentedSteps = setupResult.presentSequence.mock.calls[0]?.[0];
    expect(presentedSteps).toHaveLength(2);
    expect(presentedSteps?.[0]).toMatchObject({ screenPoint: { x: 240, y: 320 } });
    expect(presentedSteps?.[1]).toMatchObject({ screenPoint: { x: 960, y: 160 } });
    expect(presentedSteps?.[0]).not.toHaveProperty('screenRegion');
    expect(setupResult.terminal).toHaveBeenCalledWith(taskId, expect.objectContaining({
      finalOutput: '1. Open Variables.\n2. Choose Make a Variable.',
      status: 'completed',
    }));
    expect(setupResult.dependencies.onProgress).toHaveBeenCalledTimes(2);
    expect(setupResult.releaseObservationSession).toHaveBeenCalledOnce();
  });

  it('does not observe again or ask for another decision after presentation', async () => {
    const decisions = vi.fn(async ({ observation: current }) => sequenceFor(current!));
    const setupResult = setup(decisions, { outcome: 'presented' });
    await setupResult.runtime.start({
      taskId: randomUUID(),
      request: 'Show me how',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.observe).toHaveBeenCalledOnce();
    expect(setupResult.startObservationSession).toHaveBeenCalledOnce();
    expect(setupResult.dependencies.decide).toHaveBeenCalledOnce();
  });

  it('rejects stale model coordinates instead of displaying them', async () => {
    const setupResult = setup(async () => ({
      ...sequenceFor(setupResult.current),
      observationId: randomUUID(),
    }));
    await setupResult.runtime.start({
      taskId: randomUUID(),
      request: 'Show me',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.dependencies.presenter.presentSequence).not.toHaveBeenCalled();
    expect(setupResult.terminal).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed', message: 'Coach returned a stale screen target.' }),
    );
  });

  it('fails and releases the session when presentation cannot remain active', async () => {
    const setupResult = setup(
      async ({ observation: current }) => sequenceFor(current!),
      { outcome: 'unavailable' },
    );
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'Show me',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.terminal).toHaveBeenCalledWith(taskId, expect.objectContaining({
      status: 'failed',
    }));
    expect(setupResult.dependencies.presenter.finishSession).toHaveBeenCalledWith(taskId);
    expect(setupResult.releaseObservationSession).toHaveBeenCalledWith(taskId);
  });

  it('does not start CUA for a plain answer without screen context', async () => {
    const setupResult = setup(async () => ({
      kind: 'answer',
      language: 'en',
      text: 'A variable stores a value.',
    }));
    const taskId = randomUUID();

    await setupResult.runtime.start({
      taskId,
      request: 'What is a variable?',
      activity: null,
      requiresObservation: false,
      priorProgress: null,
    });
    await vi.waitFor(() => expect(setupResult.terminal).toHaveBeenCalledOnce());

    expect(setupResult.startObservationSession).not.toHaveBeenCalled();
    expect(setupResult.dependencies.observe).not.toHaveBeenCalled();
    expect(setupResult.releaseObservationSession).toHaveBeenCalledWith(taskId);
  });
});

describe('authenticated Coach decision client', () => {
  it('reserves one paid user turn for the Coach session and does not retry', async () => {
    const taskId = randomUUID();
    const agentTurnId = randomUUID();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: agentTurnId }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          kind: 'answer',
          text: 'A variable stores a value.',
          language: 'en',
          observationId: null,
          observationFingerprint: null,
          steps: null,
          recap: null,
        }),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.test',
    });
    const input = {
      activity: null,
      observation: null,
      priorProgress: null,
      request: 'What is a variable?',
      taskId,
    };

    await expect(client.decide(input, new AbortController().signal)).resolves.toMatchObject({
      kind: 'answer',
    });
    await expect(client.decide(input, new AbortController().signal)).rejects.toThrow(
      'Coach model request failed (503).',
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/agent-turns')))
      .toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/openai/responses')))
      .toHaveLength(2);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      parallel_tool_calls: false,
      store: false,
      tools: [],
    });
  });

  it('fits generated Coach speech to the presentation contract without another model call', async () => {
    const taskId = randomUUID();
    const current = observation({ taskId });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: randomUUID() }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          kind: 'coach_sequence',
          text: null,
          language: 'vi',
          observationId: current.observationId,
          observationFingerprint: current.fingerprint,
          steps: [{
            hook: 'h'.repeat(50),
            instruction: 'i'.repeat(90),
            reason: 'r'.repeat(90),
            expectedOutcome: 'Bảng Biến số xuất hiện.',
            target: 'Nút Biến số',
            point: { x: 200, y: 400 },
          }],
          recap: null,
        }),
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.test',
    });

    const decision = await client.decide({
      activity: null,
      observation: current,
      priorProgress: null,
      request: 'Chỉ cho em bước tiếp theo',
      taskId,
    }, new AbortController().signal);

    expect(decision.kind).toBe('coach_sequence');
    if (decision.kind !== 'coach_sequence') throw new Error('Expected a Coach sequence.');
    const step = decision.steps[0]!;
    expect([step.hook, step.instruction, step.reason].join(' ').length)
      .toBeLessThanOrEqual(160);
    expect(step.hook).toHaveLength(36);
    expect(step.instruction).toHaveLength(76);
    expect(step.reason).toHaveLength(46);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      text: { format: { schema: { properties: { steps: { anyOf: Array<{ items?: { properties: Record<string, { maxLength?: number }> }; maxItems?: number }> } } } } };
    };
    const properties = requestBody.text.format.schema.properties;
    const stepProperties = properties.steps.anyOf[0]?.items?.properties;
    expect(properties.steps.anyOf[0]?.maxItems).toBe(8);
    expect(stepProperties?.hook?.maxLength).toBe(36);
    expect(stepProperties?.instruction?.maxLength).toBe(76);
    expect(stepProperties?.reason?.maxLength).toBe(46);
    expect(stepProperties).toHaveProperty('point');
    expect(stepProperties).not.toHaveProperty('region');
  });
});

describe('individual classroom explanations', () => {
  function textExplanation(): CoachRuntimeStart {
    return {
      taskId: randomUUID(),
      request: 'Explain this assignment',
      activity: null,
      requiresObservation: false,
      priorProgress: null,
      explanation: {
        guidanceId: randomUUID(),
        broadcastId: randomUUID(),
        teacherInstruction: 'Explain assignment 1',
        language: 'en',
        contextMode: 'text_only',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        startedAt: new Date().toISOString(),
        modelRequests: 0,
        observations: 0,
      },
    };
  }

  it('carries displayed text into Next requests without changing prior request history', async () => {
    const f = setup(async () => ({ kind: 'answer', text: 'A loop repeats an instruction.', language: 'en' }));
    const input = textExplanation();
    f.dependencies.explanation = {
      beforeRound: vi.fn(async () => undefined),
      consume: vi.fn(async () => undefined),
      observe: f.observe,
      awaitContinuation: vi.fn(async () => ({
        guidanceId: input.explanation!.guidanceId,
        stepRevision: 1,
        action: 'next' as const,
        text: null,
      })),
    };
    await f.runtime.start(input);
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalledOnce());
    const calls = vi.mocked(f.dependencies.decide).mock.calls;
    expect(calls).toHaveLength(8);
    expect(calls[0]![0].presentedSteps).toEqual([]);
    expect(calls[1]![0].presentedSteps).toEqual(['A loop repeats an instruction.']);
    expect(calls[7]![0].presentedSteps).toHaveLength(7);
    const body = coachResponseRequest(calls[1]![0], 'model') as {
      input: Array<{ content: Array<{ text: string }> }>;
    };
    expect(JSON.parse(body.input[1]!.content[0]!.text).explanation).toMatchObject({
      question: null,
      presentedSteps: ['A loop repeats an instruction.'],
    });
    expect(f.observe).not.toHaveBeenCalled();
  });

  it('waits for Next after a known API rate limit and preserves the pending question and model turn', async () => {
    const answer = () => new Response(JSON.stringify({ output_text: JSON.stringify({
      kind: 'answer', text: 'A loop repeats an instruction.', language: 'en',
      observationId: null, observationFingerprint: null, steps: null, recap: null,
    }) }));
    const agentTurnId = randomUUID();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: agentTurnId }), { status: 201 }))
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'rate_limited', retryable: true }), {
        status: 429, headers: { 'retry-after': '1' },
      }))
      .mockResolvedValueOnce(answer());
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token', apiBaseUrl: 'https://api.example.test',
    });
    const f = setup(client.decide);
    const input = textExplanation();
    let next!: (value: GuidanceContinue) => void;
    const wait = vi.fn<NonNullable<CoachRuntimeDependencies['explanation']>['awaitContinuation']>(
      () => new Promise<GuidanceContinue>((resolve) => (next = resolve)),
    );
    f.dependencies.explanation = {
      beforeRound: vi.fn(async () => undefined), consume: vi.fn(async () => undefined),
      observe: f.observe, awaitContinuation: wait,
    };
    const continuation = (action: GuidanceContinue['action'], text: string | null = null): GuidanceContinue => ({
      guidanceId: input.explanation!.guidanceId, stepRevision: 1, action, text,
    });
    await f.runtime.start(input);
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    next(continuation('question', 'Which instruction repeats?'));
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(2));
    expect(wait.mock.calls[1]?.[1]).toContain('Next');
    expect(f.terminal).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    next(continuation('next'));
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(f.dependencies.decide).mock.calls;
    expect(calls[2]![0]).toMatchObject({
      question: 'Which instruction repeats?', presentedSteps: ['A loop repeats an instruction.'],
    });
    expect(new Set(calls.map(([call]) => call.requestId)).size).toBe(3);
    expect(f.dependencies.explanation.consume).toHaveBeenCalledTimes(3);
    expect(f.dependencies.explanation.beforeRound).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[1]?.headers['x-trocode-agent-turn-id']).toBe(agentTurnId);
    next(continuation('finish'));
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalledOnce());
    expect(f.terminal.mock.calls[0]![1].status).toBe('completed');
  });

  it.each([
    { status: 429, body: { error: { code: 'rate_limit_exceeded' } }, retryHeader: true },
    { status: 429, body: { code: 'rate_limited', retryable: true }, retryHeader: false },
    { status: 429, body: { code: 'rate_limited', retryable: false }, retryHeader: true },
    { status: 503, body: { code: 'rate_limited', retryable: true }, retryHeader: true },
  ])('does not offer replay for an unverified model outcome ($status, $body)', async ({ status, body, retryHeader }) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: randomUUID() }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(body), {
        status, headers: retryHeader ? { 'retry-after': '1' } : {},
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token', apiBaseUrl: 'https://api.example.test',
    });
    const f = setup(client.decide);
    f.dependencies.explanation = {
      beforeRound: vi.fn(async () => undefined), consume: vi.fn(async () => undefined),
      observe: f.observe, awaitContinuation: vi.fn(),
    };
    await f.runtime.start(textExplanation());
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalledOnce());
    expect(f.terminal.mock.calls[0]![1]).toMatchObject({ status: 'failed', outcomeUnknown: true });
    expect(f.dependencies.explanation.awaitContinuation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps rejected requests inside the durable eight-request allowance', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: randomUUID() }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'rate_limited', retryable: true }), {
        status: 429, headers: { 'retry-after': '1' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createAuthenticatedCoachDecisionClient({
      accessTokenProvider: async () => 'token', apiBaseUrl: 'https://api.example.test',
    });
    const f = setup(client.decide);
    f.dependencies.explanation = {
      beforeRound: vi.fn(async () => undefined), consume: vi.fn(async () => undefined),
      observe: f.observe, awaitContinuation: vi.fn(),
    };
    const input = textExplanation();
    input.explanation!.modelRequests = 7;
    await f.runtime.start(input);
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalledOnce());
    expect(f.terminal.mock.calls[0]![1]).toMatchObject({
      status: 'failed', message: expect.stringContaining('request limit reached'),
    });
    expect(f.dependencies.explanation.consume).toHaveBeenCalledOnce();
    expect(f.dependencies.explanation.awaitContinuation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('observes again only after continuation and sends the actual assignment context', async () => {
    const { attempt, broadcast } = classroomFixture();
    const claim = {
      id: randomUUID(),
      attemptId: attempt.attemptId,
      activityVersionId: attempt.activityVersionId,
      workSessionId: randomUUID(),
    } as GuidanceClaim;
    const activity = new ActivityContextService(
      {} as KnowledgeSpaceClient,
    ).createForClassroomGuidance(attempt, claim);
    const f = setup(async () => ({
      kind: 'answer',
      text: 'A loop repeats the same instruction.',
      language: 'en',
    }));
    let next!: (value: GuidanceContinue) => void;
    const wait = vi.fn(
      () => new Promise<GuidanceContinue>((resolve) => (next = resolve)),
    );
    f.dependencies.explanation = {
      beforeRound: vi.fn(async () => undefined),
      consume: vi.fn(async () => undefined),
      observe: f.observe,
      awaitContinuation: wait,
    };
    const taskId = randomUUID();
    const guidanceId = randomUUID();
    await f.runtime.start({
      taskId,
      request: 'Explain this assignment',
      activity,
      requiresObservation: true,
      priorProgress: null,
      explanation: {
        guidanceId,
        broadcastId: broadcast.id,
        teacherInstruction: 'Explain assignment 1',
        language: 'vi',
        contextMode: 'screen_if_permitted',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        startedAt: new Date().toISOString(),
        modelRequests: 0,
        observations: 0,
      },
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
    expect(f.observe).toHaveBeenCalledOnce();
    expect(f.terminal).not.toHaveBeenCalled();
    next({
      guidanceId,
      stepRevision: 1,
      action: 'question',
      text: 'What repeats?',
    });
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(2));
    expect(f.observe).toHaveBeenCalledTimes(2);
    const call = vi.mocked(f.dependencies.decide).mock.calls[1]![0];
    expect(f.dependencies.explanation.consume).toHaveBeenCalledWith(taskId, 'model', call.requestId);
    expect(call.requestId).not.toBe(vi.mocked(f.dependencies.decide).mock.calls[0]![0].requestId);
    const request = JSON.stringify(coachResponseRequest(call, 'model'));
    expect(request).toContain(attempt.definition.instructions);
    expect(request).toContain('What repeats?');
    expect(request).toContain('guidancePolicy');
    expect(request).toContain('vi');
    expect(request).toContain('"tools":[]');
    next({ guidanceId, stepRevision: 2, action: 'finish', text: null });
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalledOnce());
  });
  it('discards delayed targets when the screen changes and rejects multiple visual steps', async () => {
    const f = setup(
      async ({ observation: current }) => ({
        ...sequenceFor(current!),
        steps: sequenceFor(current!).steps.slice(0, 1),
      }),
      { outcome: 'presented' },
    );
    f.observe
      .mockResolvedValueOnce(f.current)
      .mockResolvedValue({ ...f.current, fingerprint: 'b'.repeat(64) });
    const continuation = vi.fn<NonNullable<CoachRuntimeDependencies['explanation']>['awaitContinuation']>(async () => ({
      guidanceId: randomUUID(),
      stepRevision: 1,
      action: 'finish' as const,
      text: null,
    }));
    f.dependencies.explanation = {
      beforeRound: async () => undefined,
      consume: async () => undefined,
      observe: f.observe,
      awaitContinuation: continuation,
    };
    const input = {
      taskId: randomUUID(),
      request: 'Explain assignment 1',
      activity: null,
      requiresObservation: true,
      priorProgress: null,
      explanation: {
        guidanceId: randomUUID(),
        broadcastId: randomUUID(),
        teacherInstruction: 'Explain',
        language: 'en' as const,
        contextMode: 'screen_if_permitted' as const,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        startedAt: new Date().toISOString(),
        modelRequests: 0,
        observations: 0,
      },
    };
    await f.runtime.start(input);
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalled());
    expect(f.presentSequence).not.toHaveBeenCalled();
    expect(continuation.mock.calls[0]?.[1]).toContain('screen changed');
    const invalid = setup(
      async ({ observation: current }) => sequenceFor(current!),
      { outcome: 'presented' },
    );
    invalid.dependencies.explanation = {
      ...f.dependencies.explanation,
      observe: invalid.observe,
    };
    await invalid.runtime.start({ ...input, taskId: randomUUID() });
    await vi.waitFor(() => expect(invalid.terminal).toHaveBeenCalled());
    expect(invalid.terminal.mock.calls[0]![1].status).toBe('failed');
    expect(invalid.presentSequence).not.toHaveBeenCalled();
  });
  it('falls back to assignment text when screen capture is unavailable without replaying a model request', async () => {
    const f = setup(async (input) => {
      expect(input.observation).toBeNull();
      expect(input.explanation?.contextMode).toBe('text_only');
      return { kind: 'answer', language: 'en', text: 'The assignment asks you to write a loop.' };
    });
    f.observe.mockRejectedValue(new Error('Screen unavailable'));
    f.dependencies.explanation = {
      beforeRound: async () => undefined,
      consume: async () => undefined,
      observe: f.observe,
      awaitContinuation: async () => ({ guidanceId: randomUUID(), stepRevision: 1, action: 'finish', text: null }),
    };
    await f.runtime.start({ taskId: randomUUID(), request: 'Explain assignment 1', activity: null, requiresObservation: true, priorProgress: null,
      explanation: { guidanceId: randomUUID(), broadcastId: randomUUID(), teacherInstruction: 'Explain', language: 'en', contextMode: 'screen_if_permitted', expiresAt: new Date(Date.now() + 600_000).toISOString(), startedAt: new Date().toISOString(), modelRequests: 0, observations: 0 } });
    await vi.waitFor(() => expect(f.terminal).toHaveBeenCalled());
    expect(f.terminal.mock.calls[0]![1].status).toBe('completed');
    expect(f.dependencies.decide).toHaveBeenCalledOnce();
    expect(f.presentSequence).not.toHaveBeenCalled();
  });
  it('isolates 200 mocked student model inputs, screens, progress, and cancellation owners', async () => {
    const runs = Array.from({ length: 200 }, (_, index) => {
      const { attempt, broadcast } = classroomFixture();
      attempt.definition.instructions = `Student ${index} assignment instructions`;
      const activity = new ActivityContextService(
        {} as KnowledgeSpaceClient,
      ).createForClassroomGuidance(attempt, {
        attemptId: attempt.attemptId,
        activityVersionId: attempt.activityVersionId,
        workSessionId: randomUUID(),
      } as GuidanceClaim);
      const f = setup(async (input) => ({
        kind: 'answer',
        text: `Explanation ${input.observation?.text}`,
        language: 'en',
      }));
      const taskId = randomUUID();
      f.observe.mockResolvedValue({
        ...f.current,
        taskId,
        text: `Private screen ${index}`,
      });
      f.dependencies.explanation = {
        beforeRound: async () => undefined,
        consume: async () => undefined,
        observe: f.observe,
        awaitContinuation: async () => ({
          guidanceId: randomUUID(),
          stepRevision: 1,
          action: 'finish',
          text: null,
        }),
      };
      return {
        f,
        index,
        input: {
          taskId,
          request: 'Explain assignment 1',
          activity,
          requiresObservation: index % 3 !== 2,
          priorProgress: null,
          explanation: {
            guidanceId: randomUUID(),
            broadcastId: broadcast.id,
            teacherInstruction: 'Explain assignment 1',
            language: index % 2 ? ('vi' as const) : ('en' as const),
            contextMode:
              index % 3 === 2
                ? ('text_only' as const)
                : ('screen_if_permitted' as const),
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            startedAt: new Date().toISOString(),
            modelRequests: 0,
            observations: 0,
          },
        },
      };
    });
    await Promise.all(runs.map(({ f, input }) => f.runtime.start(input)));
    await vi.waitFor(() =>
      expect(runs.every(({ f }) => f.terminal.mock.calls.length === 1)).toBe(
        true,
      ),
    );
    for (const { f, index, input } of runs) {
      expect(f.dependencies.decide).toHaveBeenCalledOnce();
      const decisionInput = vi.mocked(f.dependencies.decide).mock.calls[0]![0];
      expect(decisionInput.activity?.attemptId).toBe(input.activity.attemptId);
      expect(decisionInput.observation?.text ?? null).toBe(
        index % 3 === 2 ? null : `Private screen ${index}`,
      );
      expect(decisionInput.presentedSteps).toEqual([]);
      expect(f.releaseObservationSession).toHaveBeenCalledWith(input.taskId);
    }
  });
});

describe('dedicated assignment checks',()=>{
  it('makes one tool-free check, records evidence and never presents pointers',async()=>{
    const f=workCheckFixture(); const s=setup(async()=>({kind:'work_check',...f.decision}));
    s.dependencies.workChecks={prepare:vi.fn(async()=>f.packet),verify:vi.fn(async()=>undefined),release:vi.fn()};
    s.dependencies.onWorkCheck=vi.fn();
    await s.runtime.start({taskId:f.packet.taskId,request:'Check my work',activity:f.activity,requiresObservation:false,priorProgress:null});
    await vi.waitFor(()=>expect(s.terminal).toHaveBeenCalledOnce());
    expect(s.dependencies.decide).toHaveBeenCalledOnce(); expect(s.observe).not.toHaveBeenCalled();
    expect(s.presentSequence).not.toHaveBeenCalled();
    expect(s.dependencies.onWorkCheck).toHaveBeenLastCalledWith(f.packet.taskId,expect.objectContaining({phase:'checked',report:expect.objectContaining({overall:'looks_ready'})}));
    expect(s.dependencies.workChecks.release).toHaveBeenCalledWith(f.packet.taskId);
    const request=coachResponseRequest({taskId:f.packet.taskId,request:'Check',observation:null,activity:f.activity,priorProgress:null,checkContext:f.packet},'test-model');
    expect(request).toMatchObject({tools:[],store:false,max_output_tokens:8000});
    expect(JSON.stringify(request)).toContain('untrusted evidence');
  });
  it('uses deterministic incomplete feedback without model cost when context is missing',async()=>{
    const f=workCheckFixture(); f.packet.evidence=[]; f.packet.sources=[]; f.packet.coverage.partial=true;
    const s=setup(async()=>({kind:'complete',recap:'Done'}));
    s.dependencies.workChecks={prepare:vi.fn(async()=>f.packet),verify:vi.fn(async()=>undefined),release:vi.fn()}; s.dependencies.onWorkCheck=vi.fn();
    await s.runtime.start({taskId:f.packet.taskId,request:'Check my work',activity:f.activity,requiresObservation:false,priorProgress:null});
    await vi.waitFor(()=>expect(s.terminal).toHaveBeenCalledOnce());
    expect(s.dependencies.decide).not.toHaveBeenCalled();
    expect(s.dependencies.onWorkCheck).toHaveBeenLastCalledWith(f.packet.taskId,expect.objectContaining({report:expect.objectContaining({overall:'incomplete_context'})}));
  });
  it('rejects ordinary answers for checks and does not retry',async()=>{
    const f=workCheckFixture(); const s=setup(async()=>({kind:'answer',text:'Perfect',language:'en'}));
    s.dependencies.workChecks={prepare:vi.fn(async()=>f.packet),verify:vi.fn(async()=>undefined),release:vi.fn()};
    s.dependencies.onWorkCheck=vi.fn();
    await s.runtime.start({taskId:f.packet.taskId,request:'Check my work',activity:f.activity,requiresObservation:false,priorProgress:null});
    await vi.waitFor(()=>expect(s.terminal).toHaveBeenCalledOnce());
    expect(s.terminal).toHaveBeenCalledWith(f.packet.taskId,expect.objectContaining({status:'failed'}));
    expect(s.dependencies.decide).toHaveBeenCalledOnce();
  });
  it('drops a late model response after cancellation',async()=>{
    const f=workCheckFixture(); let release!: (value: {kind:'work_check'} & typeof f.decision)=>void;
    const s=setup(()=>new Promise(resolve=>{release=resolve;}));
    s.dependencies.workChecks={prepare:vi.fn(async()=>f.packet),verify:vi.fn(async()=>undefined),release:vi.fn()}; s.dependencies.onWorkCheck=vi.fn();
    await s.runtime.start({taskId:f.packet.taskId,request:'Check my work',activity:f.activity,requiresObservation:false,priorProgress:null});
    await vi.waitFor(()=>expect(s.dependencies.decide).toHaveBeenCalledOnce()); s.runtime.cancel(f.packet.taskId);
    release({kind:'work_check',...f.decision}); await Promise.resolve(); await Promise.resolve();
    expect(s.terminal).not.toHaveBeenCalled(); expect(s.dependencies.onWorkCheck).toHaveBeenCalledTimes(1);
  });
});
