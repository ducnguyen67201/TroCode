import { describe, expect, it } from 'vitest';

import type { TaskSnapshot } from '../../shared/contracts';

import {
  CompanionResponseController,
  selectCompanionOverlayMode,
} from './companion-response-controller';

const FIRST_TASK_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_TASK_ID = '00000000-0000-4000-8000-000000000002';
const FIRST_CARD_ID = '00000000-0000-4000-8000-000000000011';
const SECOND_CARD_ID = '00000000-0000-4000-8000-000000000012';
const TIMESTAMP = '2026-08-18T08:00:00.000Z';
const RESPONSE_CARD = {
  cardId: FIRST_CARD_ID,
  message: 'Answer',
  phase: 'completed',
  side: 'right',
  taskId: FIRST_TASK_ID,
} as const;

function completedSnapshot(
  taskId: string,
  answers: string[],
): Pick<TaskSnapshot, 'messages' | 'phase' | 'taskId'> {
  return {
    messages: answers.map((text, index) => ({
      kind: 'answer',
      messageId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      role: 'assistant',
      taskId,
      text,
      timestamp: TIMESTAMP,
    })),
    phase: 'completed',
    taskId,
  };
}

function controller(): CompanionResponseController {
  const ids = [FIRST_CARD_ID, SECOND_CARD_ID];
  return new CompanionResponseController({
    cardId: () => ids.shift() ?? SECOND_CARD_ID,
    side: () => 'right',
  });
}

describe('CompanionResponseController', () => {
  it('creates one streaming card from the first nonblank delta and keeps its id', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);

    expect(responses.appendTextDelta(FIRST_TASK_ID, '   ')).toBeNull();
    expect(responses.appendTextDelta(FIRST_TASK_ID, 'Hello')).toEqual({
      cardId: FIRST_CARD_ID,
      message: 'Hello',
      phase: 'streaming',
      side: 'right',
      taskId: FIRST_TASK_ID,
    });
    expect(responses.appendTextDelta(FIRST_TASK_ID, ', world.')).toEqual({
      cardId: FIRST_CARD_ID,
      message: 'Hello, world.',
      phase: 'streaming',
      side: 'right',
      taskId: FIRST_TASK_ID,
    });
  });

  it('bounds a coalesced streamed answer to the response contract limit', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);

    responses.appendTextDelta(FIRST_TASK_ID, 'a'.repeat(7_999));
    responses.appendTextDelta(FIRST_TASK_ID, 'bc');

    expect(responses.current?.message).toBe(`${'a'.repeat(7_999)}b`);
    expect(responses.current?.message).toHaveLength(8_000);
    expect(responses.current?.cardId).toBe(FIRST_CARD_ID);
  });

  it('replaces the draft with the latest authoritative assistant answer', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);
    responses.appendTextDelta(FIRST_TASK_ID, 'Unfinished dra');

    const completed = responses.complete(
      completedSnapshot(FIRST_TASK_ID, ['Earlier answer.', 'Final answer.']),
    );

    expect(completed).toEqual({
      cardId: FIRST_CARD_ID,
      message: 'Final answer.',
      phase: 'completed',
      side: 'right',
      taskId: FIRST_TASK_ID,
    });
  });

  it('creates a completed card when the runtime did not stream text', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);

    expect(
      responses.complete(completedSnapshot(FIRST_TASK_ID, ['Done.'])),
    ).toMatchObject({
      cardId: FIRST_CARD_ID,
      message: 'Done.',
      phase: 'completed',
    });
  });

  it('resets the old response for a new run and ignores stale task events', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);
    responses.appendTextDelta(FIRST_TASK_ID, 'Old task');

    expect(responses.startRun(SECOND_TASK_ID)).toBeNull();
    expect(responses.appendTextDelta(FIRST_TASK_ID, ' stale')).toBeNull();
    expect(
      responses.complete(completedSnapshot(FIRST_TASK_ID, ['Stale answer.'])),
    ).toBeNull();
    expect(responses.appendTextDelta(SECOND_TASK_ID, 'New task')).toEqual({
      cardId: SECOND_CARD_ID,
      message: 'New task',
      phase: 'streaming',
      side: 'right',
      taskId: SECOND_TASK_ID,
    });
  });

  it('keeps the current draft when duplicate start signals arrive for the active task', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);
    responses.appendTextDelta(FIRST_TASK_ID, 'Streaming answer');

    expect(responses.startRun(FIRST_TASK_ID)).toEqual({
      cardId: FIRST_CARD_ID,
      message: 'Streaming answer',
      phase: 'streaming',
      side: 'right',
      taskId: FIRST_TASK_ID,
    });
    expect(responses.appendTextDelta(FIRST_TASK_ID, '.')).toEqual({
      cardId: FIRST_CARD_ID,
      message: 'Streaming answer.',
      phase: 'streaming',
      side: 'right',
      taskId: FIRST_TASK_ID,
    });
  });

  it('clears a streaming response on failure or cancellation', () => {
    const failed = controller();
    failed.startRun(FIRST_TASK_ID);
    failed.appendTextDelta(FIRST_TASK_ID, 'Working');
    expect(failed.failRun(FIRST_TASK_ID)).toBeNull();
    expect(failed.appendTextDelta(FIRST_TASK_ID, ' late')).toBeNull();

    const cancelled = controller();
    cancelled.startRun(FIRST_TASK_ID);
    cancelled.appendTextDelta(FIRST_TASK_ID, 'Working');
    expect(cancelled.cancelRun(FIRST_TASK_ID)).toBeNull();
    expect(cancelled.current).toBeNull();
  });

  it('dismisses only the exact latest card and suppresses late events', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);
    responses.appendTextDelta(FIRST_TASK_ID, 'Answer');

    expect(responses.dismiss(SECOND_CARD_ID, FIRST_TASK_ID)).toMatchObject({
      cardId: FIRST_CARD_ID,
    });
    expect(responses.dismiss(FIRST_CARD_ID, SECOND_TASK_ID)).toMatchObject({
      cardId: FIRST_CARD_ID,
    });
    expect(responses.dismiss(FIRST_CARD_ID, FIRST_TASK_ID)).toBeNull();
    expect(
      responses.complete(completedSnapshot(FIRST_TASK_ID, ['Late answer.'])),
    ).toBeNull();
  });
});

describe('companion overlay selection', () => {
  it.each([
    [
      'interaction',
      {
        activity: {},
        guidance: {},
        interaction: {},
        response: RESPONSE_CARD,
      },
    ],
    ['guidance', { activity: {}, guidance: {}, response: RESPONSE_CARD }],
    ['response', { activity: {}, response: RESPONSE_CARD }],
    ['activity', { activity: {} }],
    ['hidden', {}],
  ] as const)('selects %s using strict overlay precedence', (mode, input) => {
    expect(selectCompanionOverlayMode(input)).toBe(mode);
  });

  it('does not corrupt a response hidden temporarily by guidance or input', () => {
    const responses = controller();
    responses.startRun(FIRST_TASK_ID);
    responses.appendTextDelta(FIRST_TASK_ID, 'Keep me');
    const card = responses.current;

    expect(
      selectCompanionOverlayMode({ guidance: {}, response: responses.current }),
    ).toBe('guidance');
    expect(
      selectCompanionOverlayMode({
        interaction: {},
        response: responses.current,
      }),
    ).toBe('interaction');
    expect(responses.current).toBe(card);
  });
});
