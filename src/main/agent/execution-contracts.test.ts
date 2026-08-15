import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DesktopStepDecisionSchema,
  proposedActionForDecision,
} from './execution-contracts';

describe('desktop execution contracts', () => {
  it('binds exact click coordinates into policy input while observation stays runtime-scoped', () => {
    const observationId = randomUUID();
    const decision = DesktopStepDecisionSchema.parse({
      kind: 'action',
      observationId,
      intent: 'send',
      capability: 'email',
      description: 'Send the drafted email to the selected recipient.',
      target: 'Gmail compose window',
      sendPayload: {
        account: 'me@example.com',
        recipients: ['alex@example.com'],
        subject: 'Tomorrow',
        body: 'See you at 10.',
      },
      command: { kind: 'click', x: 812, y: 744 },
    });

    if (decision.kind !== 'action') throw new Error('Expected an action.');

    expect(proposedActionForDecision(decision)).toEqual({
      action: 'send',
      capability: 'email',
      description: 'Send the drafted email to the selected recipient.',
      target: 'Gmail compose window',
      parameters: {
        account: 'me@example.com',
        recipients: ['alex@example.com'],
        subject: 'Tomorrow',
        body: 'See you at 10.',
        command: 'click',
        x: '812',
        y: '744',
        button: 'left',
        count: '1',
      },
    });
  });

  it('requires exact visible email details for every send decision', () => {
    expect(
      DesktopStepDecisionSchema.safeParse({
        kind: 'action',
        observationId: randomUUID(),
        intent: 'send',
        capability: 'email',
        description: 'Send the drafted email.',
        command: { kind: 'click', x: 812, y: 744 },
      }).success,
    ).toBe(false);
  });

  it('rejects insecure navigation and oversized desktop coordinates', () => {
    const base = {
      kind: 'action',
      observationId: randomUUID(),
      intent: 'open_url',
      capability: 'browser',
      description: 'Open Gmail.',
    } as const;

    expect(
      DesktopStepDecisionSchema.safeParse({
        ...base,
        command: { kind: 'open_url', url: 'http://mail.google.com' },
      }).success,
    ).toBe(false);
    expect(
      DesktopStepDecisionSchema.safeParse({
        ...base,
        intent: 'click_element',
        command: { kind: 'click', x: 100_001, y: 4 },
      }).success,
    ).toBe(false);
  });

  it('cannot disguise out-of-scope navigation with a benign target or intent', () => {
    const observationId = randomUUID();
    const mismatchedIntent = DesktopStepDecisionSchema.safeParse({
      kind: 'action',
      observationId,
      intent: 'click_element',
      capability: 'browser',
      description: 'Open a page.',
      target: 'https://mail.google.com/',
      command: { kind: 'open_url', url: 'https://example.com/' },
    });

    expect(mismatchedIntent.success).toBe(false);

    const decision = DesktopStepDecisionSchema.parse({
      kind: 'action',
      observationId,
      intent: 'open_url',
      capability: 'browser',
      description: 'Open a page.',
      target: 'https://mail.google.com/',
      command: { kind: 'open_url', url: 'https://example.com/' },
    });
    if (decision.kind !== 'action') throw new Error('Expected an action.');

    expect(proposedActionForDecision(decision).target).toBe(
      'https://example.com/',
    );
  });
});
