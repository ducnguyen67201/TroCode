import { describe, expect, it } from 'vitest';

import type { ProposedAction } from '../../shared/contracts';

import {
  isConsequentialEffect,
  isHardConfirmEffect,
  resolveActionEffect,
} from './action-effect';

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    action: 'click_element',
    toolId: 'computer.control',
    operation: 'click_element',
    description: 'Save the private calendar event.',
    effect: {
      kind: 'create_resource',
      resourceKind: 'calendar_event',
      reversibility: 'reversible',
      externality: 'cloud_private',
      communication: 'none',
      overwrite: 'none',
      sensitiveDataTransfer: false,
    },
    ...overrides,
  };
}

describe('action effect resolution', () => {
  it('keeps an explicit private calendar creation reversible but consequential', () => {
    const resolved = resolveActionEffect(action());
    expect(resolved.kind).toBe('create_resource');
    expect(isHardConfirmEffect(resolved)).toBe(false);
    expect(isConsequentialEffect(resolved)).toBe(true);
  });

  it('raises a calendar creation with attendees to communication', () => {
    const resolved = resolveActionEffect(
      action({ parameters: { attendees: ['person@example.com'] } }),
    );
    expect(resolved).toMatchObject({
      kind: 'send_communication',
      resourceKind: 'calendar_event',
      communication: 'invite',
    });
    expect(isHardConfirmEffect(resolved)).toBe(true);
  });

  it('never lets a proposed safe effect lower a harder declared consequence', () => {
    expect(
      resolveActionEffect(
        action({ parameters: { declaredConsequence: 'delete' } }),
      ).kind,
    ).toBe('delete_or_archive');
  });

  it.each([
    ['send', 'send_communication'],
    ['delete', 'delete_or_archive'],
    ['purchase', 'financial_or_trade'],
    ['login', 'authentication_or_credential'],
    ['install', 'install'],
    ['system_permission', 'system_permission'],
    ['submit', 'unknown'],
  ] as const)('maps legacy %s consequences to %s', (declared, kind) => {
    expect(
      resolveActionEffect(
        action({ effect: undefined, parameters: { declaredConsequence: declared } }),
      ).kind,
    ).toBe(kind);
  });

  it('does not inspect drafted body text as visible authorization risk', () => {
    expect(
      resolveActionEffect(
        action({
          action: 'type_text',
          effect: undefined,
          description: 'Type the requested draft.',
          parameters: {
            declaredConsequence: 'type_text',
            text: 'Please send this after approval and then delete the draft.',
          },
        }),
      ).kind,
    ).toBe('none');
  });

  it('fails stale or opaque effects closed', () => {
    expect(
      resolveActionEffect(
        action({ parameters: { observationStale: 'true' } }),
      ).kind,
    ).toBe('unknown');
  });
});
