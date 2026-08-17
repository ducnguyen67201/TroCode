import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { PlannerStepInput } from './desktop-planner';
import { compileGoal } from './goal-router';
import { GptResponsesPlanner } from './responses-planner';

const retinaCoordinateSpace = {
  screenHeight: 1_117,
  screenWidth: 1_728,
  screenshotHeight: 2_234,
  screenshotWidth: 3_456,
} as const;

function functionResponse(name: string, argumentsValue: unknown): Response {
  return new Response(
    JSON.stringify({
      id: `resp_${randomUUID()}`,
      status: 'completed',
      output: [
        {
          type: 'function_call',
          name,
          call_id: `call_${randomUUID()}`,
          arguments: JSON.stringify(argumentsValue),
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function worksheetInput(
  taskId: string,
  observationId: string,
  guidancePoints: PlannerStepInput['guidancePoints'] = [],
): PlannerStepInput {
  const goal = compileGoal('Solve this English worksheet on screen');
  return {
    goal,
    guidancePoints,
    observation: {
      observationId,
      taskId,
      capturedAt: new Date().toISOString(),
      text: '1. Where ___ you live? 2. He ___ flowers.',
      screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
      coordinateSpace: retinaCoordinateSpace,
      degraded: false,
      fingerprint: 'a'.repeat(64),
    },
    recentMessages: [],
    remainingSteps: goal.limits.maxSteps - guidancePoints.length,
    steering: [],
  };
}

describe('GPT Responses desktop planner', () => {
  it('uses Luna with the transcript and screenshot, then owns worksheet order locally', async () => {
    const taskId = randomUUID();
    const firstObservationId = randomUUID();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      functionResponse('plan_visible_guidance', {
        observationId: firstObservationId,
        items: [
          {
            answer: 'does; waters',
            explanation: 'He takes does and the action uses present continuous.',
            target: 'Question 2',
            x: 600,
            y: 300,
          },
          {
            answer: 'do; live',
            explanation: 'Use do with you in the present simple.',
            target: 'Question 1',
            x: 600,
            y: 200,
          },
          {
            answer: 'is; a teacher',
            explanation: 'Use is with she.',
            target: 'Question 3',
            x: 600,
            y: 400,
          },
        ],
        continuation: 'complete',
        finalSummary: '1. do, live; 2. does, waters; 3. is, a teacher',
      }),
    );
    const planner = new GptResponsesPlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      fetchImpl,
    });
    const firstInput = worksheetInput(taskId, firstObservationId);

    await planner.start(taskId, firstInput.goal);
    const first = await planner.decide(taskId, firstInput);

    expect(first).toMatchObject({
      kind: 'action',
      target: 'Question 1',
      guidanceSequence: { index: 1, total: 3 },
      command: { kind: 'point', x: 2_074, y: 447 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0];
    const options = request?.[1];
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      tool_choice: 'required',
      parallel_tool_calls: false,
    });
    expect(JSON.stringify(body)).toContain('input_image');
    expect(JSON.stringify(body)).toContain(firstInput.goal.originalRequest);
    expect(JSON.stringify(body)).not.toContain('sequenceIndex');
    expect(
      (body.tools as Array<{ name: string }>).map((tool) => tool.name),
    ).toEqual([
      'plan_visible_guidance',
      'request_user_input',
      'complete_desktop_task',
      'block_desktop_task',
    ]);

    const secondInput = worksheetInput(taskId, randomUUID(), [
      {
        description: 'do; live — Use do with you in the present simple.',
        sequenceIndex: 1,
        sequenceTotal: 3,
        target: 'Question 1',
      },
    ]);
    const second = await planner.decide(taskId, secondInput);
    expect(second).toMatchObject({
      kind: 'action',
      target: 'Question 2',
      guidanceSequence: { index: 2, total: 3 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('completes locally after every planned item has been presented', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      functionResponse('plan_visible_guidance', {
        observationId,
        items: [
          {
            answer: 'do; live',
            explanation: 'Use do with you.',
            target: 'Question 1',
            x: 500,
            y: 300,
          },
        ],
        continuation: 'complete',
        finalSummary: 'Question 1: Where do you live? I live in Hai Duong town.',
      }),
    );
    const planner = new GptResponsesPlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      fetchImpl,
    });
    const firstInput = worksheetInput(taskId, observationId);
    await planner.start(taskId, firstInput.goal);
    await planner.decide(taskId, firstInput);

    const completion = await planner.decide(
      taskId,
      worksheetInput(taskId, randomUUID(), [
        {
          description: 'do; live — Use do with you.',
          sequenceIndex: 1,
          sequenceTotal: 1,
          target: 'Question 1',
        },
      ]),
    );

    expect(completion).toEqual({
      kind: 'complete',
      summary: 'Question 1: Where do you live? I live in Hai Duong town.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back from Luna to Terra after an invalid model response', async () => {
    const taskId = randomUUID();
    const input = worksheetInput(taskId, randomUUID());
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'completed', output: [] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        functionResponse('complete_desktop_task', {
          summary: 'The visible work is complete.',
        }),
      );
    const planner = new GptResponsesPlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      fetchImpl,
    });
    await planner.start(taskId, input.goal);

    await expect(planner.decide(taskId, input)).resolves.toEqual({
      kind: 'complete',
      summary: 'The visible work is complete.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const models = fetchImpl.mock.calls.map((call) =>
      (JSON.parse(String(call[1]?.body)) as { model: string }).model,
    );
    expect(models).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra']);
  });

  it('maps a Responses action from normalized image coordinates once', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const goal = compileGoal('Open YouTube for me');
    const input: PlannerStepInput = {
      ...worksheetInput(taskId, observationId),
      goal,
      remainingSteps: goal.limits.maxSteps,
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      functionResponse('propose_desktop_action', {
        observationId,
        intent: 'click_element',
        capability: 'computer_use',
        description: 'Click the visible YouTube result.',
        target: 'YouTube result',
        command: { kind: 'click', x: 500, y: 500 },
      }),
    );
    const planner = new GptResponsesPlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      fetchImpl,
    });
    await planner.start(taskId, goal);

    await expect(planner.decide(taskId, input)).resolves.toMatchObject({
      kind: 'action',
      observationId,
      command: { kind: 'click', x: 1_728, y: 1_117 },
    });
    const requestBody = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as { tools: Array<{ name: string }> };
    expect(requestBody.tools.map((tool) => tool.name)).toEqual([
      'propose_desktop_action',
      'request_user_input',
      'complete_desktop_task',
      'block_desktop_task',
    ]);
  });

  it('requires an API key before starting', async () => {
    const planner = new GptResponsesPlanner({
      credentialStore: { read: async () => null, write: async () => undefined },
      environmentApiKey: '',
      fetchImpl: vi.fn<typeof fetch>(),
    });

    await expect(
      planner.start(randomUUID(), compileGoal('Open YouTube for me')),
    ).rejects.toThrow('Connect an OpenAI API key');
  });
});
