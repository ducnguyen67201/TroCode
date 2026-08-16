import { describe, expect, it } from 'vitest';

import {
  compileGoal,
  inferDomain,
  inferInteractionMode,
  requestNeedsClarification,
} from './goal-router';

describe('goal router', () => {
  it('treats how-to requests as guidance instead of permission to act', () => {
    const goal = compileGoal('How do I open YouTube?');

    expect(goal.interactionMode).toBe('guide');
    expect(goal.scope.allowedDomains).toContain('youtube.com');
    expect(goal.capabilities).toEqual(
      expect.arrayContaining(['browser', 'computer_use', 'conversation']),
    );
  });

  it('grounds Vietnamese how-to questions about the visible screen', () => {
    const goal = compileGoal('Làm sao để làm bài tập tiếng Anh này?');

    expect(goal.domain).toBe('education');
    expect(goal.interactionMode).toBe('guide');
    expect(goal.capabilities).toEqual(
      expect.arrayContaining(['computer_use', 'conversation']),
    );
  });

  it('accepts Vietnamese screen questions when text input omits diacritics', () => {
    const goal = compileGoal('Lam sao de lam bai tap tieng Anh nay?');

    expect(goal.domain).toBe('education');
    expect(goal.interactionMode).toBe('guide');
    expect(goal.capabilities).toContain('computer_use');
  });

  it('treats explicit outcome verbs as action requests', () => {
    expect(inferInteractionMode('Open YouTube for me')).toBe('act');
    expect(inferInteractionMode('Reply to Alex in Gmail')).toBe('act');
    expect(inferInteractionMode('Draft an email to Alex')).toBe('act');
  });

  it('selects coding tools without coupling every request to education', () => {
    const goal = compileGoal('Fix the failing tests in my repository');

    expect(goal.domain).toBe('coding');
    expect(goal.capabilities).toEqual(
      expect.arrayContaining(['filesystem', 'terminal', 'code_editor']),
    );
    expect(goal.approvals.alwaysConfirm).toContain('write_file');
  });

  it('classifies research as its own general-purpose domain', () => {
    expect(inferDomain('Research three note-taking apps and compare them')).toBe(
      'research',
    );
  });

  it('grants Gmail requests only the Gmail browser and email surface', () => {
    const goal = compileGoal('Open Gmail for me');

    expect(goal.capabilities).toEqual(
      expect.arrayContaining(['browser', 'computer_use', 'email']),
    );
    expect(goal.scope.allowedDomains).toContain('mail.google.com');
  });

  it('asks for clarification when there is no usable outcome', () => {
    expect(requestNeedsClarification('help')).toBe(true);
    expect(requestNeedsClarification('help me')).toBe(false);
  });
});
