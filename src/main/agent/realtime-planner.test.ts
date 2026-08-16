import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { compileGoal } from './goal-router';
import {
  GptRealtimePlanner,
  type PlannerSocketFactory,
} from './realtime-planner';

class FakePlannerSocket extends EventEmitter {
  readonly sent: unknown[] = [];

  closed = false;

  private responseIndex = 0;

  constructor(private readonly decisions: readonly unknown[]) {
    super();
    queueMicrotask(() => {
      this.emit('open');
      this.emit('message', Buffer.from(JSON.stringify({ type: 'session.created' })));
    });
  }

  send(data: string): void {
    const event: unknown = JSON.parse(data);
    this.sent.push(event);
    if (!event || typeof event !== 'object' || !('type' in event)) return;

    if (event.type === 'session.update') {
      queueMicrotask(() =>
        this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' }))),
      );
    }
    if (event.type === 'response.create') {
      const decision =
        this.decisions[
          Math.min(this.responseIndex, this.decisions.length - 1)
        ];
      this.responseIndex += 1;
      const decisionKind =
        typeof decision === 'object' && decision !== null && 'kind' in decision
          ? decision.kind
          : 'action';
      const toolName =
        {
          action: 'propose_desktop_action',
          point: 'point_to_screen',
          ask_user: 'request_user_input',
          complete: 'complete_desktop_task',
          blocked: 'block_desktop_task',
        }[String(decisionKind)] ?? 'propose_desktop_action';
      queueMicrotask(() =>
        this.emit(
          'message',
          Buffer.from(
            JSON.stringify({
              type: 'response.done',
              response: {
                status: 'completed',
                output: [
                  {
                    type: 'function_call',
                    name: toolName,
                    call_id: `call_test_${this.responseIndex}`,
                    arguments: JSON.stringify(decision),
                  },
                ],
              },
            }),
          ),
        ),
      );
    }
  }

  close(): void {
    this.closed = true;
    this.emit('close');
  }
}

const retinaCoordinateSpace = {
  screenHeight: 1_117,
  screenWidth: 1_728,
  screenshotHeight: 2_234,
  screenshotWidth: 3_456,
} as const;

describe('GPT Realtime desktop planner', () => {
  it('uses the lower-cost Mini model by default', async () => {
    const taskId = randomUUID();
    let connectionUrl: string | undefined;
    const socketFactory: PlannerSocketFactory = (url) => {
      connectionUrl = url;
      return new FakePlannerSocket([]);
    };
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });

    await planner.start(taskId, compileGoal('Open Gmail for me'));

    expect(connectionUrl).toContain('model=gpt-realtime-2.1-mini');
    await planner.end(taskId);
  });

  it('sends a screenshot and returns a validated single action', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const decision = {
      kind: 'action',
      observationId,
      intent: 'open_url',
      capability: 'browser',
      description: 'Open Gmail.',
      command: { kind: 'open_url', url: 'https://mail.google.com/' },
    };
    let socket: FakePlannerSocket | undefined;
    const socketFactory: PlannerSocketFactory = () => {
      socket = new FakePlannerSocket([decision]);
      return socket;
    };
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Open Gmail for me');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        guidancePoints: [],
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'TroCode window',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          degraded: false,
          fingerprint: 'a'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps,
        steering: [],
      }),
    ).resolves.toMatchObject({
      kind: 'action',
      observationId,
      command: { kind: 'open_url' },
    });

    expect(socket?.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session.update' }),
        expect.objectContaining({
          type: 'conversation.item.create',
          item: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'input_image' }),
            ]),
          }),
        }),
      ]),
    );

    const sessionUpdate = socket?.sent.find(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'session.update',
    );
    expect(sessionUpdate).toMatchObject({
      session: {
        instructions: expect.stringContaining('Available tool catalog:'),
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: 'propose_desktop_action',
            parameters: expect.objectContaining({
              required: expect.arrayContaining(['command']),
            }),
          }),
          expect.objectContaining({ name: 'request_user_input' }),
          expect.objectContaining({ name: 'complete_desktop_task' }),
          expect.objectContaining({ name: 'block_desktop_task' }),
        ]),
      },
    });
  });

  it('requests one corrected tool call when an action omits its command', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const correctedDecision = {
      kind: 'action',
      observationId,
      intent: 'open_url',
      capability: 'browser',
      description: 'Open YouTube.',
      command: { kind: 'open_url', url: 'https://www.youtube.com/' },
    };
    let socket: FakePlannerSocket | undefined;
    const socketFactory: PlannerSocketFactory = () => {
      socket = new FakePlannerSocket([
        { ...correctedDecision, command: undefined },
        correctedDecision,
      ]);
      return socket;
    };
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Open YouTube for me');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        guidancePoints: [],
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'TroCode window',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          degraded: false,
          fingerprint: 'b'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps,
        steering: [],
      }),
    ).resolves.toMatchObject(correctedDecision);

    expect(
      socket?.sent.filter(
        (event) =>
          typeof event === 'object' &&
          event !== null &&
          'type' in event &&
          event.type === 'response.create',
      ),
    ).toHaveLength(2);
    expect(socket?.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            type: 'function_call_output',
            output: expect.stringContaining('rejected_invalid_arguments'),
          }),
        }),
      ]),
    );
  });

  it('requires a screen-grounded guide to point before completing', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const prematureCompletion = {
      kind: 'complete',
      summary:
        'Bài này yêu cầu chọn thì hiện tại đơn hoặc hiện tại tiếp diễn dựa trên dấu hiệu thời gian.',
    };
    const pointDecision = {
      kind: 'point',
      observationId,
      description: 'Điền “do” vào chỗ trống đầu tiên vì chủ ngữ là “you”.',
      target: 'Câu 1 · chỗ trống đầu tiên',
      sequenceIndex: 1,
      sequenceTotal: 16,
      x: 580,
      y: 150,
    };
    let socket: FakePlannerSocket | undefined;
    const socketFactory: PlannerSocketFactory = () => {
      socket = new FakePlannerSocket([prematureCompletion, pointDecision]);
      return socket;
    };
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Làm sao để làm bài tập tiếng Anh này?');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        guidancePoints: [],
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'A visible English worksheet',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          coordinateSpace: retinaCoordinateSpace,
          degraded: false,
          fingerprint: 'c'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps,
        steering: [],
      }),
    ).resolves.toMatchObject({
      kind: 'action',
      intent: 'guide',
      target: pointDecision.target,
      guidanceSequence: { index: 1, total: 16 },
      command: { kind: 'point', x: 2_004, y: 335 },
    });

    const sessionUpdate = socket?.sent.find(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'session.update',
    );
    expect(sessionUpdate).toMatchObject({
      session: {
        tools: [
          expect.objectContaining({ name: 'point_to_screen' }),
          expect.objectContaining({ name: 'request_user_input' }),
          expect.objectContaining({ name: 'complete_desktop_task' }),
          expect.objectContaining({ name: 'block_desktop_task' }),
        ],
      },
    });
    const serializedSession = JSON.parse(
      JSON.stringify(sessionUpdate),
    ) as { session: { tools: Array<{ name: string }> } };
    expect(serializedSession.session.tools.map((tool) => tool.name)).not.toContain(
      'propose_desktop_action',
    );
    expect(socket?.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            type: 'function_call_output',
            output: expect.stringContaining('rejected_teaching_sequence'),
          }),
        }),
      ]),
    );
  });

  it('normalizes a guide pointer tool into a non-clicking point command', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const pointDecision = {
      kind: 'point',
      observationId,
      description: 'Notice that “now” signals the present continuous tense.',
      target: 'Question 2',
      sequenceIndex: 1,
      sequenceTotal: 16,
      x: 580,
      y: 150,
    };
    const socketFactory: PlannerSocketFactory = () =>
      new FakePlannerSocket([pointDecision]);
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Làm sao để làm bài tập tiếng Anh này?');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        guidancePoints: [],
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'A visible English worksheet',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          coordinateSpace: retinaCoordinateSpace,
          degraded: false,
          fingerprint: 'd'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps,
        steering: [],
      }),
    ).resolves.toMatchObject({
      kind: 'action',
      intent: 'guide',
      capability: 'computer_use',
      description: pointDecision.description,
      target: pointDecision.target,
      guidanceSequence: { index: 1, total: 16 },
      command: { kind: 'point', x: 2_004, y: 335 },
    });
  });

  it('continues an ordered worksheet walkthrough instead of completing after question one', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const prematureCompletion = {
      kind: 'complete',
      summary: 'Question 1 is complete.',
    };
    const secondPoint = {
      kind: 'point',
      observationId,
      description:
        '“Now” signals the present continuous: “What is he doing now?”',
      target: 'Question 2',
      sequenceIndex: 2,
      sequenceTotal: 3,
      x: 620,
      y: 210,
    };
    let socket: FakePlannerSocket | undefined;
    const socketFactory: PlannerSocketFactory = () => {
      socket = new FakePlannerSocket([prematureCompletion, secondPoint]);
      return socket;
    };
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Solve this English worksheet');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        guidancePoints: [
          {
            description: 'Question 1 uses “do” with “you”.',
            sequenceIndex: 1,
            sequenceTotal: 3,
            target: 'Question 1',
          },
        ],
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'A visible three-question English worksheet',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          coordinateSpace: retinaCoordinateSpace,
          degraded: false,
          fingerprint: '9'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps - 1,
        steering: [],
      }),
    ).resolves.toMatchObject({
      kind: 'action',
      guidanceSequence: { index: 2, total: 3 },
      target: 'Question 2',
      command: { kind: 'point', x: 2_143, y: 469 },
    });

    expect(socket?.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            type: 'function_call_output',
            output: expect.stringContaining(
              'The walkthrough is only 1 of 3 items complete',
            ),
          }),
        }),
      ]),
    );
  });

  it('rotates the Realtime session between visual steps to bound screenshot context', async () => {
    const taskId = randomUUID();
    const firstObservationId = randomUUID();
    const secondObservationId = randomUUID();
    const decisions = [
      {
        kind: 'point',
        observationId: firstObservationId,
        description: 'Question 1 uses “do” with “you”.',
        target: 'Question 1',
        sequenceIndex: 1,
        sequenceTotal: 2,
        x: 450,
        y: 320,
      },
      {
        kind: 'point',
        observationId: secondObservationId,
        description: 'Question 2 uses the present continuous with “now”.',
        target: 'Question 2',
        sequenceIndex: 2,
        sequenceTotal: 2,
        x: 470,
        y: 370,
      },
    ];
    const sockets: FakePlannerSocket[] = [];
    const socketFactory: PlannerSocketFactory = () => {
      const socket = new FakePlannerSocket([decisions[sockets.length]]);
      sockets.push(socket);
      return socket;
    };
    const planner = new GptRealtimePlanner({
      credentialStore: {
        read: async () => 'sk-test-key',
        write: async () => undefined,
      },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Solve this English worksheet');
    const desktopObservation = (
      observationId: string,
      fingerprintCharacter: string,
    ) => ({
      observationId,
      taskId,
      capturedAt: new Date().toISOString(),
      text: 'A visible two-question English worksheet',
      screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
      coordinateSpace: retinaCoordinateSpace,
      degraded: false,
      fingerprint: fingerprintCharacter.repeat(64),
    });

    await planner.start(taskId, goal);
    const first = await planner.decide(taskId, {
      goal,
      guidancePoints: [],
      observation: desktopObservation(firstObservationId, 'a'),
      recentMessages: [],
      remainingSteps: goal.limits.maxSteps,
      steering: [],
    });
    const second = await planner.decide(taskId, {
      goal,
      guidancePoints: [
        {
          description: 'Question 1 uses “do” with “you”.',
          sequenceIndex: 1,
          sequenceTotal: 2,
          target: 'Question 1',
        },
      ],
      observation: desktopObservation(secondObservationId, 'b'),
      previousOutcome: {
        status: 'confirmed',
        summary: 'The first teaching point was displayed.',
      },
      recentMessages: [],
      remainingSteps: goal.limits.maxSteps - 1,
      steering: [],
    });

    expect(first).toMatchObject({
      kind: 'action',
      guidanceSequence: { index: 1, total: 2 },
    });
    expect(second).toMatchObject({
      kind: 'action',
      guidanceSequence: { index: 2, total: 2 },
    });
    expect(sockets).toHaveLength(2);
    expect(sockets.every((socket) => socket.closed)).toBe(true);
    expect(
      sockets.map(
        (socket) =>
          socket.sent.filter(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              'type' in event &&
              event.type === 'conversation.item.create' &&
              'item' in event &&
              typeof event.item === 'object' &&
              event.item !== null &&
              'role' in event.item &&
              event.item.role === 'user',
          ).length,
      ),
    ).toEqual([1, 1]);
  });

  it('allows a guide to complete after a pointer explanation was shown', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const decision = {
      kind: 'complete',
      summary:
        'Câu 1 là “Where do you live?” vì câu hỏi hiện tại đơn với chủ ngữ “you”.',
    };
    const socketFactory: PlannerSocketFactory = () =>
      new FakePlannerSocket([decision]);
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => 'sk-test-key', write: async () => undefined },
      environmentApiKey: '',
      socketFactory,
      timeoutMs: 1_000,
    });
    const goal = compileGoal('Làm sao để làm bài tập tiếng Anh này?');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        guidancePoints: [
          {
            description: 'Điền “do” vì chủ ngữ là “you”.',
            sequenceIndex: 1,
            sequenceTotal: 1,
            target: 'Câu 1 · chỗ trống đầu tiên',
          },
        ],
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'A visible English worksheet',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          degraded: false,
          fingerprint: 'e'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps - 1,
        steering: [],
      }),
    ).resolves.toMatchObject(decision);
  });

  it('fails before opening a socket when no API key is configured', async () => {
    const planner = new GptRealtimePlanner({
      credentialStore: { read: async () => null, write: async () => undefined },
      environmentApiKey: '',
      socketFactory: () => {
        throw new Error('Socket should not be created.');
      },
    });

    await expect(
      planner.start(randomUUID(), compileGoal('Open Gmail for me')),
    ).rejects.toThrow('Connect an OpenAI API key');
  });
});
