const VISIBLE_CONTEXT_PHRASES = [
  'on screen',
  'on the screen',
  'on my screen',
  'currently visible',
  'currently open',
  'in front of me',
  'trên màn hình',
  'đang hiển thị',
  'đang mở',
  'trước mặt',
] as const;

function normalizeRequest(request: string): string {
  return request.normalize('NFKC').toLocaleLowerCase();
}

export function requestReferencesVisibleContext(request: string): boolean {
  const normalized = normalizeRequest(request);
  if (VISIBLE_CONTEXT_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  return (
    /\b(?:this|that|these|those)\b/u.test(normalized) ||
    /(?:^|\s)(?:này|đó|kia)(?:$|[\s.,!?;:])/u.test(normalized)
  );
}

export interface CompletionReviewDecision {
  reason:
    | 'visible_context'
    | 'outcome_verification'
    | 'selective_skip'
    | 'no_tools';
  required: boolean;
}

export function decideCompletionReview(input: {
  request: string;
  resolvedToolCalls: number;
}): CompletionReviewDecision {
  if (requestReferencesVisibleContext(input.request)) {
    return { reason: 'visible_context', required: true };
  }
  const normalized = normalizeRequest(input.request);
  if (
    input.resolvedToolCalls > 0 &&
    /\b(?:read|inspect|find|fill|edit|submit|send|create|make|download|upload|delete|purchase|latest|email)\b/u.test(
      normalized,
    )
  ) {
    return { reason: 'outcome_verification', required: true };
  }
  if (input.resolvedToolCalls > 0) {
    return { reason: 'selective_skip', required: false };
  }
  return { reason: 'no_tools', required: false };
}

export function shouldRequestCompletionReview(input: {
  request: string;
  resolvedToolCalls: number;
}): boolean {
  return decideCompletionReview(input).required;
}
