import { describe, expect, it } from 'vitest';

import { compileGoal } from './goal-router';
import { evaluateAction } from './policy';

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

  it('denies navigation beyond the goal domain scope', () => {
    const goal = compileGoal('Open YouTube for me');
    const decision = evaluateAction(goal, {
      action: 'open_url',
      capability: 'browser',
      description: 'Navigate elsewhere.',
      target: 'https://example.com/',
    });

    expect(decision.status).toBe('denied');
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

  it('denies capabilities that were not granted by the goal', () => {
    const goal = compileGoal('Open YouTube for me');
    const decision = evaluateAction(goal, {
      action: 'run_command',
      capability: 'terminal',
      description: 'Run an unrelated command.',
    });

    expect(decision.status).toBe('denied');
  });
});
