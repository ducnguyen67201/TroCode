import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DesktopStepDecisionSchema,
  mapNormalizedPointToScreenshot,
  mapScreenshotPointToDesktop,
  proposedActionForDecision,
} from './execution-contracts';

describe('desktop execution contracts', () => {
  it('keeps enough response room for a multi-question worksheet', () => {
    expect(
      DesktopStepDecisionSchema.safeParse({
        kind: 'complete',
        summary: 'Answer and explanation. '.repeat(150),
      }).success,
    ).toBe(true);
  });

  it('allows a guide to point without granting a click', () => {
    const decision = DesktopStepDecisionSchema.parse({
      kind: 'action',
      observationId: randomUUID(),
      intent: 'guide',
      capability: 'computer_use',
      description: 'Notice the word “now” in question 2.',
      target: 'Question 2',
      guidanceSequence: { index: 2, total: 16 },
      command: { kind: 'point', x: 990, y: 714 },
    });

    if (decision.kind !== 'action') throw new Error('Expected an action.');
    expect(proposedActionForDecision(decision)).toMatchObject({
      action: 'guide',
      capability: 'computer_use',
      parameters: { command: 'point', x: '990', y: '714' },
    });
    expect(
      DesktopStepDecisionSchema.safeParse({
        ...decision,
        intent: 'click_element',
      }).success,
    ).toBe(false);
  });

  it('maps Retina screenshot pixels only for the Electron overlay', () => {
    expect(
      mapScreenshotPointToDesktop({ x: 1_980, y: 1_428 }, {
        screenHeight: 1_117,
        screenWidth: 1_728,
        screenshotHeight: 2_234,
        screenshotWidth: 3_456,
      }),
    ).toEqual({ x: 990, y: 714 });
  });

  it('maps model-normalized coordinates into CUA screenshot pixels', () => {
    expect(
      mapNormalizedPointToScreenshot({ x: 580, y: 150 }, {
        screenHeight: 1_117,
        screenWidth: 1_728,
        screenshotHeight: 2_234,
        screenshotWidth: 3_456,
      }),
    ).toEqual({ x: 2_004, y: 335 });
  });

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
      operation: 'click',
      target: 'Gmail compose window',
      toolId: 'desktop.control',
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

  it('rejects a tool or operation that does not match the concrete command', () => {
    const base = {
      kind: 'action' as const,
      observationId: randomUUID(),
      intent: 'open_url' as const,
      description: 'Open Gmail.',
      command: { kind: 'open_url' as const, url: 'https://mail.google.com/' },
    };

    expect(
      DesktopStepDecisionSchema.safeParse({
        ...base,
        toolId: 'desktop.control',
        operation: 'click',
      }).success,
    ).toBe(false);
    expect(
      DesktopStepDecisionSchema.safeParse({
        ...base,
        toolId: 'browser.navigate',
        operation: 'open_url',
      }).success,
    ).toBe(true);
  });

  it('normalizes a future direct tool without adding another command enum', () => {
    const decision = DesktopStepDecisionSchema.parse({
      kind: 'action',
      observationId: randomUUID(),
      intent: 'write_file',
      toolId: 'music.generate',
      operation: 'create_track',
      description: 'Generate a playable lo-fi track.',
      target: 'new-track.mp3',
      command: {
        kind: 'direct_tool',
        toolId: 'music.generate',
        operation: 'create_track',
        input: { prompt: 'Warm lo-fi beat', format: 'mp3' },
      },
    });
    if (decision.kind !== 'action') throw new Error('Expected an action.');

    expect(proposedActionForDecision(decision)).toMatchObject({
      action: 'write_file',
      toolId: 'music.generate',
      operation: 'create_track',
      parameters: {
        command: 'direct_tool',
        prompt: 'Warm lo-fi beat',
        format: 'mp3',
      },
    });
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
