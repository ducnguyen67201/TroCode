import { describe, expect, it } from 'vitest';

import { classifyWorkspaceCommand } from './workspace-command-policy';

describe('WorkspaceCommandPolicy', () => {
  it.each([
    'rg -n policy src',
    'git status --short',
    'git diff -- src/main/agent/policy.ts',
    'npm --version',
  ])('allows bounded inspection: %s', (command) => {
    expect(classifyWorkspaceCommand(command).classification).toBe('safe_read');
  });

  it.each([
    'npm test',
    'npm run check',
    'npm run typecheck',
    'npx vitest run src/main/agent/policy.test.ts',
    'node --test services/api/test/config.test.mjs',
  ])('allows bounded validation: %s', (command) => {
    expect(classifyWorkspaceCommand(command).classification).toBe(
      'safe_validation',
    );
  });

  it('allows a local commit only when the user requested it', () => {
    expect(classifyWorkspaceCommand('git commit -m "fix"').classification).toBe(
      'requires_approval',
    );
    expect(
      classifyWorkspaceCommand('git commit -m "fix"', 'Implement and commit the fix.')
        .classification,
    ).toBe('requested_local_mutation');
  });

  it.each([
    'npm install example',
    'git push origin main',
    'curl https://example.com',
    'npm run deploy',
    'cat /etc/passwd',
  ])('requires approval for expansive command: %s', (command) => {
    expect(classifyWorkspaceCommand(command).classification).toBe(
      'requires_approval',
    );
  });

  it.each([
    'git reset --hard',
    'git clean -fd',
    'rm -rf build',
    'printenv',
    'echo $(printenv)',
    'echo `whoami`',
  ])('denies destructive or opaque command: %s', (command) => {
    expect(classifyWorkspaceCommand(command).classification).toBe('denied');
  });
});
