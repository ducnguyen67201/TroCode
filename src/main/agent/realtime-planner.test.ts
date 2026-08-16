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
    this.emit('close');
  }
}

describe('GPT Realtime desktop planner', () => {
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

  it('answers a screen-grounded guide task without exposing an action tool', async () => {
    const taskId = randomUUID();
    const observationId = randomUUID();
    const decision = {
      kind: 'complete',
      summary:
        'Bài này yêu cầu chọn thì hiện tại đơn hoặc hiện tại tiếp diễn dựa trên dấu hiệu thời gian.',
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
    const goal = compileGoal('Làm sao để làm bài tập tiếng Anh này?');

    await planner.start(taskId, goal);
    await expect(
      planner.decide(taskId, {
        goal,
        observation: {
          observationId,
          taskId,
          capturedAt: new Date().toISOString(),
          text: 'A visible English worksheet',
          screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
          degraded: false,
          fingerprint: 'c'.repeat(64),
        },
        recentMessages: [],
        remainingSteps: goal.limits.maxSteps,
        steering: [],
      }),
    ).resolves.toMatchObject(decision);

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
