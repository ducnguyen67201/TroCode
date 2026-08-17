import { describe, expect, it, vi } from 'vitest';

import { TaskRuntime } from './task-runtime';
import { TaskSubmissionService } from './task-submission-service';

describe('TaskSubmissionService', () => {
  it('creates a v2 task contract from GPT intent without capability grants', async () => {
    const runtime = new TaskRuntime();
    const compiler = {
      compile: vi.fn().mockResolvedValue({
        kind: 'compiled',
        intent: {
          behavior: 'act',
          objective: 'Open Gmail and read the newest message.',
          successDescription: 'The newest message is visible and summarized.',
        },
      }),
    };
    const service = new TaskSubmissionService({ compiler, runtime });

    const snapshot = await service.submit({
      text: 'Mở mail và đọc cho tôi mail gần nhất.',
    });

    expect(compiler.compile).toHaveBeenCalledWith(
      'Mở mail và đọc cho tôi mail gần nhất.',
    );
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.goal).toMatchObject({
      schemaVersion: 2,
      behavior: 'act',
      objective: 'Open Gmail and read the newest message.',
      approvalPolicy: { alwaysConfirm: expect.arrayContaining(['send', 'delete']) },
    });
    runtime.start({ taskId: snapshot.taskId });
    runtime.beginObservation(snapshot.taskId, 'Observed the visible desktop.');
    expect(
      runtime.beginAllowedAction(snapshot.taskId, {
        action: 'click_element',
        toolId: 'desktop.control',
        operation: 'click',
        description: 'Click the visible Gmail application icon.',
      }).phase,
    ).toBe('acting');
  });

  it('round-trips a model clarification through the same compiler', async () => {
    const runtime = new TaskRuntime();
    const compiler = {
      compile: vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'clarification',
          prompt: 'What style of music should I help create?',
        })
        .mockResolvedValueOnce({
          kind: 'compiled',
          intent: {
            behavior: 'act',
            objective: 'Create a relaxed instrumental track.',
            successDescription: 'A playable instrumental track is available.',
          },
        }),
    };
    const service = new TaskSubmissionService({ compiler, runtime });
    const waiting = await service.submit({ text: 'Make music for me' });

    expect(waiting.phase).toBe('clarifying');
    const ready = await service.respondToInteraction({
      taskId: waiting.taskId,
      interactionId: waiting.pendingInteraction?.id ?? '',
      kind: 'answer',
      text: 'A relaxed instrumental track',
    });

    expect(ready.phase).toBe('ready');
    expect(compiler.compile).toHaveBeenLastCalledWith(
      'Make music for me\n\nClarification: A relaxed instrumental track',
    );
  });
});
