import { describe, expect, it } from 'vitest';

import { approvalDetails } from './approval-details';

describe('approvalDetails', () => {
  it('shows exact workspace commands and patches while hiding internal evidence metadata', () => {
    expect(
      approvalDetails({
        commands: ['npm test', 'git status --short'],
        declaredConsequence: 'run_command',
        diff: '@@\n-old\n+new',
        moveTo: 'src/new.ts',
        observationFingerprint: 'internal-fingerprint',
      }),
    ).toEqual([
      {
        key: 'commands',
        label: 'Commands',
        payload: true,
        value: 'npm test\n\ngit status --short',
      },
      {
        key: 'diff',
        label: 'Diff',
        payload: true,
        value: '@@\n-old\n+new',
      },
      {
        key: 'moveTo',
        label: 'Move To',
        payload: false,
        value: 'src/new.ts',
      },
    ]);
  });
});
