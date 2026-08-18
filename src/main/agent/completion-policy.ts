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

const VISUAL_ARTIFACT_TERMS = [
  'document',
  'email',
  'form',
  'google sheet',
  'message',
  'presentation',
  'sheet',
  'slide',
  'spreadsheet',
  'table',
  'workbook',
  'worksheet',
  'bảng tính',
  'biểu mẫu',
  'email',
  'tin nhắn',
  'tài liệu',
  'trang tính',
  'trình chiếu',
] as const;

const VISUAL_ACTION_PATTERN =
  /\b(?:add|change|create|edit|enter|fill|format|make|select|type|update|write)\b|(?:^|\s)(?:chọn|điền|định dạng|nhập|sửa|tạo|viết)(?:$|[\s.,!?;:])/u;
const NAVIGATION_FIRST_PATTERN =
  /^\s*(?:go\s+to|launch|navigate\s+to|open)\b|^\s*(?:mở|truy cập)(?:$|\s)/u;

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

/**
 * Decides locally whether the first model sample needs current desktop evidence.
 * Keep this selective: direct answers and navigation-first work can choose a tool
 * without paying the image cost, while visible artifact work starts grounded.
 */
export function shouldCaptureInitialDesktopObservation(
  request: string,
): boolean {
  if (requestReferencesVisibleContext(request)) return true;
  const normalized = normalizeRequest(request);
  if (NAVIGATION_FIRST_PATTERN.test(normalized)) return false;
  return (
    VISUAL_ACTION_PATTERN.test(normalized) &&
    VISUAL_ARTIFACT_TERMS.some((term) => normalized.includes(term))
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
