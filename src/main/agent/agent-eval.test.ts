import { describe, expect, it } from 'vitest';

import { shouldRequestCompletionReview } from './completion-policy';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';

const GENERAL_PURPOSE_CASES = [
  'What is 27 × 14?',
  '27 nhân 14 bằng bao nhiêu?',
  'Translate this paragraph into Vietnamese.',
  'Write a friendly product announcement.',
  'Explain this TypeScript function.',
  'Write original lyrics for a short chorus.',
  'Write an eight-bar chord progression.',
] as const;

describe('general-purpose agent evaluation matrix', () => {
  it.each(GENERAL_PURPOSE_CASES)(
    'creates the same general host contract for assistant-capable work: %s',
    (request) => {
      const contract = createTaskContract(request);
      expect(contract.schemaVersion).toBe(5);
      expect(contract.originalRequest).toBe(request);
      expect(contract).not.toHaveProperty('behavior');
      expect(contract).not.toHaveProperty('capabilities');
    },
  );

  it('exposes desktop tools for Gmail and GarageBand without keyword grants', () => {
    const registry = new RuntimeToolRegistry();
    const names = registry.modelVisibleSpecs().map((tool) => tool.name);
    for (const request of [
      'Open Gmail and read the latest email.',
      'Make this beat in GarageBand.',
    ]) {
      expect(createTaskContract(request).schemaVersion).toBe(5);
      expect(names).toEqual(
        expect.arrayContaining(['observe_desktop', 'control_desktop']),
      );
    }
  });

  it('does not advertise an MP3 provider when none is installed', () => {
    const names = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .map((tool) => tool.name);
    expect(names).not.toContain('generate_music');
  });

  it.each([
    {
      request: 'giúp tôi làm bài tập này',
      resolvedToolCalls: 0,
      regression: 'visible assignment without an initial observation',
    },
    {
      request: 'Open Gmail and read the latest email.',
      resolvedToolCalls: 2,
      regression: 'stopping after navigation and inbox preview',
    },
  ])(
    'requires a GPT completion review for $regression',
    ({ request, resolvedToolCalls }) => {
      expect(
        shouldRequestCompletionReview({ request, resolvedToolCalls }),
      ).toBe(true);
    },
  );
});
