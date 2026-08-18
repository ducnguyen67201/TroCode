import { describe, expect, it } from 'vitest';

import { evaluateAction } from './policy';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';

describe('concrete tool policy', () => {
  const contract = createTaskContract('Help me with this task.');
  const fullyApprovedContract = createTaskContract(
    'Help me with this task.',
    'fully_approved',
  );

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
    'requires host approval for desktop %s even when the model declares a benign consequence',
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
      ).toBe('needs_approval');
    },
  );

  it.each(['click', 'drag', 'type_text', 'keypress'] as const)(
    'preauthorizes desktop %s in Full mode with explicit audit metadata',
    (operation) => {
      expect(
        evaluateAction(fullyApprovedContract, {
          action:
            operation === 'click'
              ? 'click_element'
              : operation === 'keypress'
                ? 'press_key'
                : operation,
          toolId: 'desktop.control',
          operation,
          description: 'Perform the visible desktop action.',
        }),
      ).toMatchObject({
        status: 'allowed',
        authorization: 'task_preapproved',
      });
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
      description: 'Approve the requested Gmail compose action in TroCode.',
      target: 'TroCode',
    },
    {
      description: 'Approve the exact Gmail compose action shown in TroCode.',
      target: 'TroCode approval card',
    },
    {
      description: 'Click the approval control at the bottom of the TroCode dialog.',
      target: 'Approve exact action button in the TroCode window',
    },
  ])('denies desktop actions aimed at TroCode approval controls', ({ description, target }) => {
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

  it('keeps hard denials ahead of Full preauthorization', () => {
    const unavailable = evaluateAction(
      fullyApprovedContract,
      {
        action: 'run_command',
        toolId: 'terminal.execute',
        operation: 'run',
        description: 'Run a command.',
      },
      new RuntimeToolRegistry([]),
    );
    const privateTarget = evaluateAction(fullyApprovedContract, {
      action: 'open_url',
      toolId: 'browser.navigate',
      operation: 'open_url',
      description: 'Open a target.',
      target: 'https://127.0.0.1/admin',
    });
    const selfApproval = evaluateAction(fullyApprovedContract, {
      action: 'click_element',
      toolId: 'desktop.control',
      operation: 'click',
      description: 'Click the approval control in TroCode.',
      target: 'Approve exact action button in the TroCode window',
    });

    expect(unavailable.status).toBe('denied');
    expect(privateTarget.status).toBe('denied');
    expect(selfApproval).toMatchObject({ status: 'denied', terminal: true });
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
