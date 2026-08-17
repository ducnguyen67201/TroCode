import { describe, expect, it } from 'vitest';

import type { AuthStatus, PendingInteraction } from '../../shared/contracts';

import {
  isAuthenticatedCompanionSession,
  toCompanionInteraction,
} from './companion-interaction';

const TASK_ID = '00000000-0000-4000-8000-000000000001';
const INTERACTION_ID = '00000000-0000-4000-8000-000000000002';
const CREATED_AT = '2026-08-17T12:00:00.000Z';

describe('companion interaction projection', () => {
  it('keeps a clarification compact and actionable', () => {
    const interaction: PendingInteraction = {
      choices: [
        { id: 'work', label: 'Work account' },
        { id: 'personal', label: 'Personal account' },
      ],
      createdAt: CREATED_AT,
      id: INTERACTION_ID,
      kind: 'clarification',
      prompt: 'Which Gmail account should I use?',
      taskId: TASK_ID,
    };

    expect(toCompanionInteraction(interaction, 'right')).toEqual({
      choices: interaction.choices,
      id: INTERACTION_ID,
      kind: 'clarification',
      prompt: interaction.prompt,
      side: 'right',
      taskId: TASK_ID,
    });
  });

  it('preserves material email details without exposing observation metadata', () => {
    const interaction: PendingInteraction = {
      action: {
        action: 'send',
        description: 'Send the drafted launch update.',
        parameters: {
          observationFingerprint: 'secret-screen-fingerprint',
          observationId: 'screen-observation-id',
          recipient: 'friend@example.com',
          subject: 'Launch update',
          body: 'The launch is ready.',
          x: '545',
          y: '836',
        },
        target: 'Gmail message to friend@example.com',
      },
      actionDigest: 'a'.repeat(64),
      consequence: 'This sends an external message as you.',
      createdAt: CREATED_AT,
      expiresAt: '2026-08-17T12:05:00.000Z',
      id: INTERACTION_ID,
      kind: 'approval',
      prompt: 'Send this email?',
      taskId: TASK_ID,
    };

    const projected = toCompanionInteraction(interaction, 'left');

    expect(projected).toMatchObject({
      action: {
        details: [
          { label: 'Recipient', value: 'friend@example.com' },
          { label: 'Subject', value: 'Launch update' },
          { label: 'Body', value: 'The launch is ready.' },
        ],
        hasMoreDetails: false,
        label: 'Send',
      },
      actionDigest: 'a'.repeat(64),
      kind: 'approval',
      side: 'left',
    });
    expect(JSON.stringify(projected)).not.toContain('secret-screen-fingerprint');
    expect(JSON.stringify(projected)).not.toContain('screen-observation-id');
    expect(JSON.stringify(projected)).not.toContain('545');
    expect(JSON.stringify(projected)).not.toContain('836');
  });

  it('keeps malformed legacy labels from breaking the companion presenter', () => {
    const interaction = {
      choices: [{ id: ' ', label: ' ' }],
      createdAt: CREATED_AT,
      id: INTERACTION_ID,
      kind: 'clarification',
      prompt: ' ',
      taskId: TASK_ID,
    } as PendingInteraction;

    expect(toCompanionInteraction(interaction, 'right')).toMatchObject({
      choices: [{ id: 'choice-1', label: 'Option 1' }],
      prompt: 'TroCode needs your input.',
    });
  });
});

describe('authenticated companion session', () => {
  it('enables auxiliary surfaces only for a signed-in user', () => {
    const signedIn: AuthStatus = {
      configured: true,
      state: 'signed_in',
      summary: 'Signed in.',
      user: { id: 'user-id', email: 'user@example.com', name: 'User' },
    };
    const signedOut: AuthStatus = {
      configured: true,
      state: 'signed_out',
      summary: 'Sign in.',
      user: null,
    };

    expect(isAuthenticatedCompanionSession(signedIn)).toBe(true);
    expect(isAuthenticatedCompanionSession(signedOut)).toBe(false);
    expect(
      isAuthenticatedCompanionSession({ ...signedIn, state: 'error' }),
    ).toBe(false);
  });
});
