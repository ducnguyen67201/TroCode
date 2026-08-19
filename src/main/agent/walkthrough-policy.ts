export type WalkthroughPhase = 'needs_observation' | 'needs_guidance';

export interface WalkthroughState {
  completedSteps: number;
  enabled: boolean;
  phase: WalkthroughPhase;
}

export interface WalkthroughToolDecision {
  allowed: boolean;
  summary: string;
}

const WALKTHROUGH_COMPLETION_PREFIX = 'WALKTHROUGH_COMPLETE: ';
const MAX_WALKTHROUGH_RECAP_LENGTH = 180;

function normalizeRequest(request: string): string {
  return request
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/đ/gu, 'd')
    .replace(/[\u2010-\u2015]/gu, '-');
}

/**
 * Selects the interactive desktop tutor only when the user explicitly asks to
 * be guided. Requests for an explanation or a written step list stay textual.
 */
export function requestsGuidedWalkthrough(request: string): boolean {
  const normalized = normalizeRequest(request);
  const englishSpatialTour =
    /^(?:\s*please\s+)?(?:show\s+(?:me|us)\b|point\b|circle\b|highlight\b|(?:can|could|will|would)\s+you\b)/u.test(
      normalized,
    ) &&
    /\b(?:area|part|question|field|control|section|button|target|here|there)\b/u.test(
      normalized,
    ) &&
    /\b(?:explain|teach|tell|walk\s+(?:me|us)\s+through)\b/u.test(
      normalized,
    ) &&
    /\b(?:then|next|continue|one\s+(?:area|part|question|step)\s+at\s+a\s+time|move\s+to|go\s+to)\b/u.test(
      normalized,
    );
  const englishIntent =
    /\bguide\s+(?:me|us)\b/u.test(normalized) ||
    /\bwalk\s+(?:me|us)\s+through\b/u.test(normalized) ||
    /\bgive\s+(?:me|us)\s+guidance\s+(?:on\s+)?how\s+to\b/u.test(
      normalized,
    ) ||
    /\bshow\s+(?:me|us)\s+how\s+to\b/u.test(normalized) ||
    /^\s*(?:please\s+)?guide\s+(?:on\s+)?how\s+to\b/u.test(normalized) ||
    (/\bteach\s+(?:me|us)\b/u.test(normalized) &&
      /\b(?:step\s*-?\s*by\s*-?\s*step|one\s+step\s+at\s+a\s+time)\b/u.test(
        normalized,
      )) ||
    englishSpatialTour;
  const englishSelfDirected =
    /\b(?:myself|ourselves)\b/u.test(normalized) &&
    /\b(?:do|complete|finish|solve|try|work\s+on)\b/u.test(normalized) &&
    (/\b(?:help|guide|show|teach)\s+(?:me|us)\b/u.test(normalized) ||
      /\blet\s+(?:me|us)\b/u.test(normalized) ||
      /\b(?:i|we)\s+(?:need|want|would\s+like)\s+to\b/u.test(normalized));
  if (englishIntent || englishSelfDirected) return true;

  const learner = '(?:toi|minh|em|chung toi|chung minh)';
  const vietnameseSelfDirected =
    new RegExp(
      `\\b(?:giup|chi|day|huong\\s+dan)\\s+(?:cho\\s+)?${learner}\\s+tu\\s+(?:lam|giai|hoan\\s+thanh|thuc\\s+hien)\\b`,
      'u',
    ).test(normalized) ||
    new RegExp(
      `\\b(?:de|cho)\\s+${learner}\\s+tu\\s+(?:lam|giai|hoan\\s+thanh|thuc\\s+hien)\\b`,
      'u',
    ).test(normalized) ||
    new RegExp(
      `\\b${learner}\\s+muon\\s+tu\\s+(?:lam|giai|hoan\\s+thanh|thuc\\s+hien)\\b`,
      'u',
    ).test(normalized);
  const vietnameseSpatialTour =
    /^\s*(?:vui\s+long\s+)?(?:chi\s+vao|khoanh\s+vung|lam\s+noi\s+bat)\b/u.test(
      normalized,
    ) &&
    /\b(?:phan|cau|khu\s+vuc|o|nut|muc)\b/u.test(normalized) &&
    /\b(?:giai\s+thich|huong\s+dan|day)\b/u.test(normalized) &&
    /\b(?:sau\s+do|tiep\s+theo|tiep\s+tuc|chuyen\s+sang|tung\s+(?:phan|cau|buoc))\b/u.test(
      normalized,
    );
  return (
    new RegExp(`\\bhuong\\s+dan\\s+${learner}\\b`, 'u').test(normalized) ||
    /^\s*huong\s+dan\s+cach\s+lam\b/u.test(normalized) ||
    (new RegExp(`\\b(?:chi|day)\\s+(?:cho\\s+)?${learner}\\b`, 'u').test(
      normalized,
    ) && /\b(?:tung\s+buoc|cach\s+lam)\b/u.test(normalized)) ||
    vietnameseSelfDirected ||
    vietnameseSpatialTour
  );
}

export function createWalkthroughState(request: string): WalkthroughState {
  return {
    completedSteps: 0,
    enabled: requestsGuidedWalkthrough(request),
    phase: 'needs_observation',
  };
}

export function evaluateWalkthroughTool(
  state: WalkthroughState,
  toolName: string,
): WalkthroughToolDecision {
  if (!state.enabled) {
    return { allowed: true, summary: 'Walkthrough sequencing is not active.' };
  }
  if (state.phase === 'needs_observation') {
    return toolName === 'observe_desktop'
      ? { allowed: true, summary: 'Capturing the next walkthrough step.' }
      : {
          allowed: false,
          summary:
            'This walkthrough needs a fresh observe_desktop result before the next show_guidance step.',
        };
  }
  return toolName === 'show_guidance'
    ? { allowed: true, summary: 'Showing one user-controlled walkthrough step.' }
    : {
        allowed: false,
        summary:
          'Use show_guidance exactly once with the latest desktop observation before choosing another tool.',
      };
}

export function advanceWalkthrough(
  state: WalkthroughState,
  completedToolName: string,
): WalkthroughState {
  if (!state.enabled) return state;
  if (
    state.phase === 'needs_observation' &&
    completedToolName === 'observe_desktop'
  ) {
    return { ...state, phase: 'needs_guidance' };
  }
  if (state.phase === 'needs_guidance' && completedToolName === 'show_guidance') {
    return {
      ...state,
      completedSteps: state.completedSteps + 1,
      phase: 'needs_observation',
    };
  }
  return state;
}

export function walkthroughModelInstruction(state: WalkthroughState): string {
  if (!state.enabled) return '';
  if (state.phase === 'needs_guidance') {
    return 'Trusted host walkthrough checkpoint: call show_guidance exactly once using the latest observation. Show one target and one concise instruction; do not give the remaining answers upfront.';
  }
  if (state.completedSteps === 0) {
    return 'Trusted host walkthrough checkpoint: call observe_desktop now. Do not return an upfront text answer; the first visible step must follow as one show_guidance call.';
  }
  return 'Trusted host walkthrough checkpoint: if another visible step remains, call observe_desktop before showing it. If the walkthrough is complete, return only a concise completion note.';
}

export function parseWalkthroughCompletion(output: string): string | null {
  if (!output.startsWith(WALKTHROUGH_COMPLETION_PREFIX)) return null;
  const recap = output.slice(WALKTHROUGH_COMPLETION_PREFIX.length);
  if (
    !recap ||
    recap.length > MAX_WALKTHROUGH_RECAP_LENGTH ||
    /[\r\n]/u.test(recap) ||
    /(?:^|\s)(?:[-*\u2022]|\d{1,2}[.)])\s/u.test(recap)
  ) {
    return null;
  }
  return recap;
}

export const WALKTHROUGH_RECOVERY_INSTRUCTION = [
  'Trusted host correction: the upfront text response was rejected because the user requested an interactive walkthrough.',
  'Call observe_desktop, then call show_guidance exactly once for the first visible target.',
  'Do not provide the full answer or all remaining steps upfront.',
].join('\n');

export const WALKTHROUGH_COMPLETION_INSTRUCTION = [
  'Trusted host walkthrough completion checkpoint: re-read the original request and the complete tool-result history.',
  'If another visible step remains, continue with a fresh observe_desktop call followed by exactly one show_guidance call.',
  `Only when the interactive walkthrough is complete, return exactly one line in this form: ${WALKTHROUGH_COMPLETION_PREFIX}<concise recap>`,
  `The recap must be ${MAX_WALKTHROUGH_RECAP_LENGTH} characters or fewer and must not contain answers, steps, bullets, or a numbered list.`,
].join('\n');
