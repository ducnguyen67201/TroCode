import { describe, expect, it } from 'vitest';

import { compileGoal } from './goal-router';
import { evaluateAction } from './policy';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';

describe('goal policy', () => {
  it('allows a scoped URL and requires verification afterward', () => {
    const goal = compileGoal('Open YouTube for me');
    const decision = evaluateAction(goal, {
      action: 'open_url',
      capability: 'browser',
      description: 'Open the YouTube homepage.',
      target: 'https://www.youtube.com/',
    });

    expect(decision.status).toBe('allowed');
    expect(decision.nextActions[0]).toContain('verify');
  });

  it('does not treat a request-derived domain as an authorization grant', () => {
    const goal = compileGoal('Open YouTube for me');
    const decision = evaluateAction(goal, {
      action: 'open_url',
      capability: 'browser',
      description: 'Navigate elsewhere.',
      target: 'https://example.com/',
    });

    expect(decision.status).toBe('allowed');
  });

  it('requires explicit approval for consequential actions', () => {
    const goal = compileGoal('Send an email to the project team');
    const decision = evaluateAction(goal, {
      action: 'send',
      capability: 'email',
      description: 'Send the drafted message.',
    });

    expect(decision.status).toBe('needs_approval');
  });

  it('denies unavailable operations, not semantic capability labels', () => {
    const goal = compileGoal('Open YouTube for me');
    const decision = evaluateAction(goal, {
      action: 'run_command',
      capability: 'terminal',
      description: 'Run an unrelated command.',
    });

    expect(decision.status).toBe('denied');
    expect(decision.summary).not.toContain('Capability');
  });

  it('allows a desktop operation even when a legacy capability was not granted', () => {
    const goal = compileGoal('Open YouTube for me');
    const decision = evaluateAction(goal, {
      action: 'click_element',
      toolId: 'desktop.control',
      operation: 'click',
      description: 'Click the visible Gmail icon.',
    });

    expect(decision.status).toBe('allowed');
  });

  it('rejects local and private browser targets', () => {
    const goal = compileGoal('Open a website for me');

    for (const target of [
      'https://localhost/admin',
      'https://127.0.0.1/admin',
      'https://192.168.1.1/admin',
      'https://[::1]/admin',
    ]) {
      expect(
        evaluateAction(goal, {
          action: 'open_url',
          toolId: 'browser.navigate',
          operation: 'open_url',
          description: 'Open a private target.',
          target,
        }).status,
      ).toBe('denied');
    }
  });

  it('admits a future registered music operation while retaining host approval', () => {
    const registry = new RuntimeToolRegistry([
      {
        id: 'music.generate',
        description: 'Generate a configured audio artifact.',
        operations: ['create_track'],
      },
    ]);
    const goal = createTaskContract('Generate a lo-fi MP3.', {
      behavior: 'act',
      objective: 'Generate a lo-fi MP3.',
      successDescription: 'A playable MP3 is available.',
    });

    expect(
      evaluateAction(
        goal,
        {
          action: 'write_file',
          toolId: 'music.generate',
          operation: 'create_track',
          description: 'Write the generated MP3.',
        },
        registry,
      ).status,
    ).toBe('needs_approval');
  });
});
