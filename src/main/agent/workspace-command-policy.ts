export type WorkspaceCommandClassification =
  | 'safe_read'
  | 'safe_validation'
  | 'requested_local_mutation'
  | 'requires_approval'
  | 'denied';

export interface WorkspaceCommandDecision {
  classification: WorkspaceCommandClassification;
  reason: string;
}

const DENIED_PATTERN =
  /(?:\bgit\s+(?:reset\s+--hard|clean\s+-|checkout\s+--|restore\s+(?:--source\s+)?(?:\.|\/))|\brm\s+-|\b(?:eval|exec)\b|\b(?:env|printenv)\b|\bset\b\s*$|\bbase64\b.*\s-d\b|\$\(|`)/iu;
const APPROVAL_PATTERN =
  /(?:\b(?:curl|wget|ssh|scp|rsync)\b|\bsudo\b|\bnpm\s+(?:install|publish|uninstall|update)\b|\b(?:pnpm|yarn|bun)\s+(?:add|install|publish|remove|update)\b|\bgit\s+(?:push|merge|rebase|tag)\b|\b(?:deploy|publish)\b|\bgh\s+(?:pr|release|api)\b|\bdocker\s+(?:push|login)\b|[<>|;])/iu;
const SAFE_READ_PATTERN =
  /^(?:pwd|(?:rg|grep)(?:\s|$).*|(?:ls|find)(?:\s|$).*|git\s+(?:status|diff|log|show|branch)(?:\s|$).*|(?:node|npm|pnpm|yarn|bun|npx)\s+--?version(?:\s|$).*)$/iu;
const SAFE_VALIDATION_PATTERN =
  /^(?:npm\s+(?:test|run\s+(?:test|check|lint|typecheck|build|package)(?::[a-z0-9_-]+)?)(?:\s|$).*|(?:pnpm|yarn|bun)\s+(?:test|run\s+(?:test|check|lint|typecheck|build|package)(?::[a-z0-9_-]+)?)(?:\s|$).*|npx\s+(?:vitest|tsc|eslint)(?:\s|$).*|node\s+--test(?:\s|$).*|cargo\s+(?:check|test|clippy)(?:\s|$).*|go\s+test(?:\s|$).*|pytest(?:\s|$).*|python\s+-m\s+(?:pytest|compileall)(?:\s|$).*)$/iu;
const COMMIT_PATTERN = /^git\s+commit(?:\s|$)/iu;
const USER_REQUESTED_COMMIT_PATTERN = /\bcommit\b/iu;
const ABSOLUTE_PATH_PATTERN = /(?:^|\s)\/(?!\/)/u;

function normalize(command: string): string {
  return command.trim().replace(/\s+/gu, ' ');
}

/**
 * Conservative policy for the current non-sandboxed Workspace shell.
 * Unknown syntax requires exact approval; destructive/obfuscated syntax is denied.
 */
export function classifyWorkspaceCommand(
  command: string,
  originalRequest = '',
): WorkspaceCommandDecision {
  const normalized = normalize(command);
  if (!normalized) {
    return { classification: 'denied', reason: 'The command is empty.' };
  }
  if (DENIED_PATTERN.test(normalized)) {
    return {
      classification: 'denied',
      reason: 'The command contains destructive, secret-enumerating, or opaque shell syntax.',
    };
  }
  if (ABSOLUTE_PATH_PATTERN.test(normalized)) {
    return {
      classification: 'requires_approval',
      reason: 'The command references an absolute path outside the trusted Workspace binding.',
    };
  }
  if (APPROVAL_PATTERN.test(normalized)) {
    return {
      classification: 'requires_approval',
      reason: 'The command can access the network, install, publish, deploy, or mutate remote state.',
    };
  }
  if (COMMIT_PATTERN.test(normalized)) {
    return USER_REQUESTED_COMMIT_PATTERN.test(originalRequest)
      ? {
          classification: 'requested_local_mutation',
          reason: 'The user explicitly requested a local commit.',
        }
      : {
          classification: 'requires_approval',
          reason: 'Creating a commit was not explicitly requested.',
        };
  }
  if (SAFE_READ_PATTERN.test(normalized)) {
    return {
      classification: 'safe_read',
      reason: 'The command performs bounded Workspace inspection.',
    };
  }
  if (SAFE_VALIDATION_PATTERN.test(normalized)) {
    return {
      classification: 'safe_validation',
      reason: 'The command runs a bounded project validation script.',
    };
  }
  return {
    classification: 'requires_approval',
    reason: 'The non-sandboxed Workspace shell command is outside the safe command policy.',
  };
}
