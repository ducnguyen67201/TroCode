import { describe, expect, it } from 'vitest';

import { evaluateAction } from './policy';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';

describe('concrete tool policy', () => {
  const contract = createTaskContract('Help me with this task.');

  it('allows registered safe browser and desktop operations without semantic grants', () => {
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
        action: 'click_element',
        toolId: 'desktop.control',
        operation: 'click',
        description: 'Click the visible Gmail icon.',
      }).status,
    ).toBe('allowed');
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
