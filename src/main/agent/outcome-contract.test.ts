import { describe, expect, it } from 'vitest';

import {
  addToolEffectObligation,
  compileOutcomeContract,
  validateOutcomeContract,
} from './outcome-contract';

describe('outcome contract', () => {
  it('uses a bounded assistant-output criterion for direct answers', () => {
    expect(compileOutcomeContract('Explain why the sky appears blue.')).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      criteria: [{ verifier: { kind: 'assistant_output' } }],
    });
  });

  it('requires fresh application-surface evidence for an explicit Chrome launch', () => {
    expect(compileOutcomeContract('Open Chrome.').criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          required: true,
          verifier: { kind: 'application_surface', application: 'chrome' },
        }),
      ]),
    );
  });

  it('adds one host-generated tool-effect obligation per verifier identity', () => {
    const contract = compileOutcomeContract('Create the requested file.');
    const revised = addToolEffectObligation(
      contract,
      'workspace.filesystem',
      'write_file',
      'Write the requested file.',
    );
    expect(revised.revision).toBe(2);
    expect(
      addToolEffectObligation(
        revised,
        'workspace.filesystem',
        'write_file',
        'Write the requested file.',
      ),
    ).toEqual(revised);
  });

  it('rejects hidden authority and unrelated application criteria', () => {
    const unrelated = {
      ...compileOutcomeContract('Explain photosynthesis.'),
      criteria: [
        {
          id: 'chrome-visible',
          description: 'Chrome is visible.',
          required: true,
          verifier: { kind: 'application_surface', application: 'chrome' },
        },
      ],
    };
    expect(validateOutcomeContract('Explain photosynthesis.', unrelated).valid).toBe(false);
  });
});
