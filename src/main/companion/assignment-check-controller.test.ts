import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ClassroomSessionProjectionSchema,
  type CompanionResponseCard,
  type WorkCheckAction,
} from '../../shared/contracts';
import { workCheckFixture } from '../knowledge/work-check.fixture';

import { AssignmentCheckController } from './assignment-check-controller';

function setup() {
  const f = workCheckFixture();
  let session: ReturnType<
    typeof ClassroomSessionProjectionSchema.parse
  > | null = ClassroomSessionProjectionSchema.parse({
    ...f.session,
    role: 'student',
    autoOpenConsent: false,
  });
  let card!: CompanionResponseCard;
  const options = {
    owner: vi.fn(async () => 'student'),
    session: {
      get: () => session,
      restore: vi.fn(),
      updateAttemptState: vi.fn(),
    },
    client: {
      getAttempt: vi.fn(async () => f.attempt),
      acknowledgeAttempt: vi.fn(),
      readyAttempt: vi.fn(async () => ({ state: 'ready_for_review' })),
    },
    tasks: {
      submitAndStart: vi.fn(async () => ({ taskId: f.packet.taskId })),
      cancel: vi.fn(),
    },
    workspaces: {
      select: vi.fn(async () => ({
        selectionId: randomUUID(),
        displayName: 'project',
      })),
    },
    files: {
      select: vi.fn(async () => ({
        selectionId: randomUUID(),
        files: [{ relativePath: 'main.py', byteSize: 30 }],
      })),
    },
    uploads: { submit: vi.fn(async () => ({ cancelled: false })) },
    present: vi.fn((value: CompanionResponseCard) => {
      card = value;
    }),
    dismiss: vi.fn(),
  };
  const controller = new AssignmentCheckController(options as never);
  return {
    ...f,
    controller,
    options,
    card: () => card,
    leave: () => {
      session = null;
    },
    action: (action: WorkCheckAction) =>
      controller.action({ cardId: card.cardId, taskId: card.taskId, action }),
  };
}
describe('floating assignment controller', () => {
  it('opening a panel does not register work; explicit start does', async () => {
    const f = setup();
    await f.controller.show();
    expect(f.options.tasks.submitAndStart).not.toHaveBeenCalled();
    await f.action('start_assignment');
    expect(f.options.tasks.submitAndStart).toHaveBeenCalledWith(
      expect.objectContaining({ activityIntent: 'work' }),
    );
    expect(f.options.client.readyAttempt).not.toHaveBeenCalled();
  });
  it('shortcut checks the bound assignment once and never submits', async () => {
    const f = setup();
    await f.controller.show();
    await Promise.all([f.controller.check(), f.controller.check()]);
    expect(f.options.tasks.submitAndStart).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        activityAttemptId: f.attempt.attemptId,
        activityIntent: 'check',
        requestedMode: 'coach',
      }),
    );
    expect(f.options.uploads.submit).not.toHaveBeenCalled();
    expect(f.options.client.readyAttempt).not.toHaveBeenCalled();
    await f.action('stop_check');
    expect(f.options.tasks.cancel).toHaveBeenCalledWith({
      taskId: f.packet.taskId,
      source: 'stop_button',
    });
  });
  it('requires an explicit native folder choice before workspace checks', async () => {
    const f = setup();
    f.attempt.definition.launchTarget = 'workspace';
    await f.controller.check();
    expect(f.options.tasks.submitAndStart).not.toHaveBeenCalled();
    expect(f.card().workCheck?.needsWorkspace).toBe(true);
    await f.action('choose_check_workspace');
    await f.controller.check();
    expect(f.options.tasks.submitAndStart).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceSelectionId: expect.any(String) }),
    );
  });
  it('sends ready only on an explicit gesture and waits for server confirmation', async () => {
    const f = setup();
    await f.controller.show();
    await f.action('send_for_review');
    expect(f.options.client.readyAttempt).toHaveBeenCalledOnce();
    expect(f.options.session.updateAttemptState).toHaveBeenCalledWith(
      'ready_for_review',
    );
  });
  it('previews selected files before uploading and never uses ready for file assignments', async () => {
    const f = setup();
    f.attempt.definition.completionPolicy.requiresSubmission = true;
    await f.controller.show();
    await f.action('send_for_review');
    expect(f.options.uploads.submit).not.toHaveBeenCalled();
    expect(f.card().workCheck?.submissionFiles).toEqual([
      { displayName: 'main.py', byteSize: 30 },
    ]);
    await f.action('confirm_submit_files');
    expect(f.options.uploads.submit).toHaveBeenCalledOnce();
    expect(f.options.client.readyAttempt).not.toHaveBeenCalled();
  });
  it('does not replay a review mutation with an unknown result', async () => {
    const f = setup();
    f.options.client.readyAttempt.mockRejectedValue(
      new Error('connection lost'),
    );
    await f.controller.show();
    await f.action('send_for_review');
    await f.action('send_for_review');
    expect(f.options.client.readyAttempt).toHaveBeenCalledOnce();
    expect(f.options.session.updateAttemptState).not.toHaveBeenCalled();
    expect(f.card().workCheck?.canReview).toBe(false);
  });
  it('rejects stale panels and does not act after leave or account change', async () => {
    const f = setup();
    await f.controller.show();
    await expect(
      f.controller.action({
        action: 'send_for_review',
        cardId: randomUUID(),
        taskId: f.card().taskId,
      }),
    ).rejects.toThrow('expired');
    f.leave();
    await f.action('send_for_review');
    expect(f.options.client.readyAttempt).not.toHaveBeenCalled();
    f.controller.clear();
    expect(f.controller.owns(f.card().cardId, f.card().taskId)).toBe(false);
  });
});

it('allows another check after a confirmed review is returned by the teacher', async () => {
  const f = setup();
  await f.controller.show();
  await f.action('send_for_review');
  f.attempt.state = 'in_progress';
  await f.controller.show();
  expect(f.card().workCheck?.canCheck).toBe(true);
  expect(f.card().workCheck?.canReview).toBe(true);
  await f.controller.check();
  expect(f.options.tasks.submitAndStart).toHaveBeenCalledOnce();
});
