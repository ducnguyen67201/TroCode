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

  constructor(private readonly decision: unknown) {
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
                    name: 'propose_desktop_step',
                    call_id: 'call_test',
                    arguments: JSON.stringify(this.decision),
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
      socket = new FakePlannerSocket(decision);
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
