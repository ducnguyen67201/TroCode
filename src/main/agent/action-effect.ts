import {
  ActionEffectSchema,
  HOST_ALWAYS_CONFIRM_EFFECTS,
  type ActionEffect,
  type ActionEffectKind,
  type ProposedAction,
  type ResourceKind,
} from '../../shared/contracts';

const HARD_CONFIRM_EFFECTS: ReadonlySet<ActionEffectKind> = new Set(
  HOST_ALWAYS_CONFIRM_EFFECTS,
);

const VISIBLE_SEND_PATTERN = /\b(?:invite|notify|send)\b/iu;
const VISIBLE_DELETE_PATTERN = /\b(?:archive|delete|erase|remove)\b/iu;
const VISIBLE_FINANCIAL_PATTERN =
  /\b(?:bid|buy|checkout|pay|purchase|subscribe|trade)\b/iu;
const VISIBLE_AUTH_PATTERN =
  /\b(?:credential|log\s*in|password|secret|sign\s*in|token)\b/iu;
const VISIBLE_PERMISSION_PATTERN =
  /\b(?:accessibility|administrator|microphone|permission|screen\s+recording)\b/iu;
const VISIBLE_INSTALL_PATTERN = /\binstall\b/iu;
const VISIBLE_PUBLISH_PATTERN = /\b(?:publish|post\s+publicly|make\s+public)\b/iu;
const VISIBLE_DEPLOY_PATTERN = /\bdeploy\b/iu;
const VISIBLE_MERGE_PATTERN = /\bmerge\b/iu;
const VISIBLE_TRANSFER_PATTERN = /\b(?:share|upload)\b/iu;
const VISIBLE_SUBMIT_PATTERN = /\bsubmit\b/iu;

function effect(
  kind: ActionEffectKind,
  resourceKind: ResourceKind,
  overrides: Partial<Omit<ActionEffect, 'kind' | 'resourceKind'>> = {},
): ActionEffect {
  return ActionEffectSchema.parse({
    kind,
    resourceKind,
    reversibility: 'reversible',
    externality: 'cloud_private',
    communication: 'none',
    overwrite: 'none',
    sensitiveDataTransfer: false,
    ...overrides,
  });
}

export function effectFreeAction(): ActionEffect {
  return ActionEffectSchema.parse({
    kind: 'none',
    resourceKind: null,
    reversibility: 'none',
    externality: 'local',
    communication: 'none',
    overwrite: 'none',
    sensitiveDataTransfer: false,
  });
}

export function unknownActionEffect(
  resourceKind: ResourceKind = 'generic_private_resource',
): ActionEffect {
  return effect('unknown', resourceKind, {
    reversibility: 'unknown',
    externality: 'unknown',
    communication: 'unknown',
    overwrite: 'unknown',
    sensitiveDataTransfer: 'unknown',
  });
}

function consequenceEffect(consequence: string): ActionEffect {
  switch (consequence) {
    case 'login':
      return effect('authentication_or_credential', 'application', {
        externality: 'external',
      });
    case 'send':
      return effect('send_communication', 'message', {
        externality: 'external',
        communication: 'send',
      });
    case 'submit':
      return unknownActionEffect('form_submission');
    case 'upload':
      return effect('sensitive_transfer', 'generic_private_resource', {
        externality: 'external',
        sensitiveDataTransfer: true,
      });
    case 'download':
      return effect('create_resource', 'download', { externality: 'local' });
    case 'delete':
      return effect('delete_or_archive', 'generic_private_resource', {
        reversibility: 'destructive',
      });
    case 'purchase':
      return effect('financial_or_trade', 'generic_private_resource', {
        externality: 'external',
      });
    case 'install':
      return effect('install', 'application', { externality: 'local' });
    case 'run_command':
      return effect('workspace_command', 'workspace_repository', {
        externality: 'local',
      });
    case 'write_file':
      return effect('workspace_write', 'workspace_file', {
        externality: 'local',
      });
    case 'system_permission':
      return effect('system_permission', 'application', {
        externality: 'local',
      });
    default:
      return effectFreeAction();
  }
}

export function effectForDeclaredConsequence(consequence: string): ActionEffect {
  return consequenceEffect(consequence);
}

function visibleRiskText(action: ProposedAction): string {
  const fields = Object.entries(action.parameters ?? {})
    .filter(([name]) =>
      [
        'application',
        'ariaLabel',
        'controlLabel',
        'controlValue',
        'href',
        'role',
        'visibleText',
      ].includes(name),
    )
    .flatMap(([, value]) => value);
  return [action.description, action.target, ...fields]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .slice(0, 120_000);
}

function resourceForCommunication(action: ProposedAction): ResourceKind {
  if (action.effect?.resourceKind === 'calendar_event') return 'calendar_event';
  if (action.parameters?.subject !== undefined) return 'email';
  return 'message';
}

function raisedVisibleEffect(
  action: ProposedAction,
  current: ActionEffect,
): ActionEffect {
  if (
    action.parameters?.targetOpaque === 'true' ||
    action.parameters?.observationStale === 'true'
  ) {
    return unknownActionEffect(current.resourceKind ?? 'generic_private_resource');
  }
  const recipients = action.parameters?.recipients ?? action.parameters?.attendees;
  const hasRecipients =
    (Array.isArray(recipients) && recipients.length > 0) ||
    (typeof recipients === 'string' && recipients.trim().length > 0);
  const text = visibleRiskText(action);
  if (hasRecipients || VISIBLE_SEND_PATTERN.test(text)) {
    return effect('send_communication', resourceForCommunication(action), {
      externality: 'external',
      communication:
        action.effect?.resourceKind === 'calendar_event' ? 'invite' : 'send',
    });
  }
  if (VISIBLE_DELETE_PATTERN.test(text)) {
    return effect(
      'delete_or_archive',
      current.resourceKind ?? 'generic_private_resource',
      { reversibility: 'destructive' },
    );
  }
  if (VISIBLE_FINANCIAL_PATTERN.test(text)) {
    return effect('financial_or_trade', 'generic_private_resource', {
      externality: 'external',
    });
  }
  if (VISIBLE_AUTH_PATTERN.test(text)) {
    return effect('authentication_or_credential', 'application', {
      externality: 'external',
    });
  }
  if (VISIBLE_PERMISSION_PATTERN.test(text)) {
    return effect('system_permission', 'application', { externality: 'local' });
  }
  if (VISIBLE_INSTALL_PATTERN.test(text)) {
    return effect('install', 'application', { externality: 'local' });
  }
  if (VISIBLE_PUBLISH_PATTERN.test(text)) {
    return effect('publish', 'generic_public_resource', {
      externality: 'public',
    });
  }
  if (VISIBLE_DEPLOY_PATTERN.test(text)) {
    return effect('deploy', 'generic_public_resource', { externality: 'public' });
  }
  if (VISIBLE_MERGE_PATTERN.test(text)) {
    return effect('merge', 'pull_request', { externality: 'external' });
  }
  if (VISIBLE_TRANSFER_PATTERN.test(text)) {
    return effect('sensitive_transfer', current.resourceKind ?? 'generic_private_resource', {
      externality: 'external',
      sensitiveDataTransfer: true,
    });
  }
  if (current.kind === 'none' && VISIBLE_SUBMIT_PATTERN.test(text)) {
    return unknownActionEffect('form_submission');
  }
  return current;
}

/** Resolve the strictest effect known to the host; untrusted context only raises risk. */
export function resolveActionEffect(action: ProposedAction): ActionEffect {
  const declared = action.parameters?.declaredConsequence;
  const declaredEffect = consequenceEffect(
    typeof declared === 'string' ? declared : action.action,
  );
  let resolved = action.effect
    ? raiseActionEffect(declaredEffect, ActionEffectSchema.parse(action.effect))
    : declaredEffect;

  if (
    resolved.communication === 'send' ||
    resolved.communication === 'invite' ||
    resolved.communication === 'notify'
  ) {
    resolved = effect('send_communication', resolved.resourceKind ?? 'message', {
      externality: 'external',
      communication: resolved.communication,
    });
  } else if (resolved.reversibility === 'destructive') {
    resolved = effect(
      'delete_or_archive',
      resolved.resourceKind ?? 'generic_private_resource',
      { reversibility: 'destructive' },
    );
  } else if (resolved.overwrite === 'unexpected') {
    resolved = effect(
      'unexpected_overwrite',
      resolved.resourceKind ?? 'generic_private_resource',
      { overwrite: 'unexpected' },
    );
  } else if (resolved.externality === 'public') {
    resolved = effect('publish', resolved.resourceKind ?? 'generic_public_resource', {
      externality: 'public',
    });
  } else if (resolved.sensitiveDataTransfer === true) {
    resolved = effect(
      'sensitive_transfer',
      resolved.resourceKind ?? 'generic_private_resource',
      { externality: 'external', sensitiveDataTransfer: true },
    );
  }
  return raisedVisibleEffect(action, resolved);
}

export function isHardConfirmEffect(effect: ActionEffect): boolean {
  return (
    HARD_CONFIRM_EFFECTS.has(effect.kind) ||
    ['send', 'invite', 'notify', 'unknown'].includes(effect.communication) ||
    ['destructive', 'unknown'].includes(effect.reversibility) ||
    ['unexpected', 'unknown'].includes(effect.overwrite) ||
    ['external', 'public', 'unknown'].includes(effect.externality) ||
    effect.sensitiveDataTransfer !== false
  );
}

export function isConsequentialEffect(effect: ActionEffect): boolean {
  return effect.kind !== 'none';
}

/** Merge a model proposal with host normalization without ever lowering host risk. */
export function raiseActionEffect(
  hostEffect: ActionEffect,
  proposedEffect: ActionEffect,
): ActionEffect {
  const hostHard = isHardConfirmEffect(hostEffect);
  const proposedHard = isHardConfirmEffect(proposedEffect);
  if (hostHard) return hostEffect;
  if (proposedHard) return proposedEffect;
  if (hostEffect.kind === 'none') return proposedEffect;
  if (proposedEffect.kind === 'none') return hostEffect;
  if (
    hostEffect.kind !== proposedEffect.kind ||
    hostEffect.resourceKind !== proposedEffect.resourceKind
  ) {
    return unknownActionEffect(hostEffect.resourceKind ?? proposedEffect.resourceKind ?? 'generic_private_resource');
  }
  return hostEffect;
}
