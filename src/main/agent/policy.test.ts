import { describe, expect, it } from 'vitest';

import { evaluateAction } from './policy';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';

describe('concrete tool policy', () => {
  const contract = createTaskContract('Help me with this task.');

  it('allows registered safe browser and scroll operations without semantic grants', () => {
    expect(
      evaluateAction(contract, {
        action: 'open_url',
        toolId: 'browser.navigate',
        operation: 'open_url',
        description: 'Open YouTube.',
        target: 'https://www.youtube.com/',
      }).status,
    ).toBe('allowed');
    expect(
      evaluateAction(contract, {
        action: 'scroll',
        toolId: 'desktop.control',
        operation: 'scroll',
        description: 'Scroll the visible inbox.',
      }).status,
    ).toBe('allowed');
  });

  it.each(['click', 'drag', 'type_text', 'keypress'] as const)(
    'allows routine desktop %s when the declared consequence is benign',
    (operation) => {
      expect(
        evaluateAction(contract, {
          action:
            operation === 'click'
              ? 'click_element'
              : operation === 'keypress'
                ? 'press_key'
                : operation,
          toolId: 'desktop.control',
          operation,
          description: 'Perform the visible desktop action.',
        }).status,
      ).toBe('allowed');
    },
  );

  it.each([
    ['click_element', 'click'],
    ['drag', 'drag'],
    ['type_text', 'type_text'],
    ['press_key', 'keypress'],
    ['scroll', 'scroll'],
  ] as const)(
    'requires strict-mode approval for routine desktop %s',
    (action, operation) => {
      expect(
        evaluateAction(
          createTaskContract('Perform the visible desktop action.', {
            autonomyMode: 'strict',
          }),
          {
            action,
            toolId: 'desktop.control',
            operation,
            description: 'Perform the visible desktop action.',
          },
        ).status,
      ).toBe('needs_approval');
    },
  );

  it('uses the declared desktop consequence for exact approval', () => {
    expect(
      evaluateAction(contract, {
        action: 'click_element',
        toolId: 'desktop.control',
        operation: 'click',
        description: 'Send the composed email.',
        target: 'Gmail Send button',
        parameters: { declaredConsequence: 'send' },
      }).status,
    ).toBe('needs_approval');
  });

  it.each([
    {
      description: 'Approve the requested Gmail compose action in Tro.',
      target: 'Tro',
    },
    {
      description: 'Approve the exact Gmail compose action shown in Tro.',
      target: 'Tro approval card',
    },
    {
      description: 'Click the approval control at the bottom of the Tro dialog.',
      target: 'Approve exact action button in the Tro window',
    },
    {
      description: 'Click the approval control in the legacy TroCode dialog.',
      target: 'TroCode approval card',
    },
  ])('denies desktop actions aimed at Tro approval controls', ({ description, target }) => {
    const decision = evaluateAction(contract, {
      action: 'click_element',
      toolId: 'desktop.control',
      operation: 'click',
      description,
      target,
      parameters: { declaredConsequence: 'click_element' },
    });

    expect(decision.status).toBe('denied');
    expect(decision.nextActions.join(' ')).toContain('user');
  });

  it.each([
    'login',
    'send',
    'submit',
    'upload',
    'download',
    'delete',
    'purchase',
    'install',
    'run_command',
    'write_file',
    'system_permission',
  ] as const)('requires exact approval for %s', (action) => {
    expect(
      evaluateAction(contract, {
        action,
        toolId: 'desktop.control',
        operation: 'click',
        description: 'Perform the exact displayed action.',
      }).status,
    ).toBe('needs_approval');
  });

  it('denies unavailable operations rather than inferred capabilities', () => {
    const decision = evaluateAction(contract, {
      action: 'run_command',
      toolId: 'terminal.execute',
      operation: 'run',
      description: 'Run a command.',
    });
    expect(decision.status).toBe('denied');
    expect(decision.summary).not.toContain('Capability');
  });

  it('rejects local, private, and credential-bearing browser targets', () => {
    for (const target of [
      'https://localhost/admin',
      'https://127.0.0.1/admin',
      'https://192.168.1.1/admin',
      'https://user:pass@example.com/',
      'http://example.com/',
    ]) {
      expect(
        evaluateAction(contract, {
          action: 'open_url',
          toolId: 'browser.navigate',
          operation: 'open_url',
          description: 'Open a target.',
          target,
        }).status,
      ).toBe('denied');
    }
  });

  it('uses the installed registry as the authority boundary', () => {
    expect(
      evaluateAction(
        contract,
        {
          action: 'open_url',
          toolId: 'browser.navigate',
          operation: 'open_url',
          description: 'Open a site.',
          target: 'https://example.com/',
        },
        new RuntimeToolRegistry([]),
      ).status,
    ).toBe('denied');
  });
});
