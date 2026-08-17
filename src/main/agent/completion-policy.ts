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

export function shouldRequestCompletionReview(input: {
  request: string;
  resolvedToolCalls: number;
}): boolean {
  return (
    input.resolvedToolCalls > 0 ||
    requestReferencesVisibleContext(input.request)
  );
}
