import type { AppLanguage, ProposedAction } from '../../shared/contracts';

const MAX_PREVIEW_LENGTH = 240;
const MIN_PREVIEW_DWELL_MS = 2_500;
const MAX_PREVIEW_DWELL_MS = 8_000;
const PREVIEW_READING_CHARACTERS_PER_SECOND = 22;
const CLASSROOM_REQUEST_PATTERN =
  /\b(?:assignment|class(?:room)?|course|exercise|homework|learn(?:ing)?|lesson|quiz|school|student|study|teacher|tutorial|tutor|worksheet)\b|(?:^|\s)(?:bai\s+tap|bai\s+hoc|giao\s+vien|hoc\s+sinh|lop\s+hoc|nha\s+truong|sinh\s+vien)(?:$|[\s.,!?;:])/u;
const VIETNAMESE_TEXT_PATTERN =
  /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]|(?:^|\s)(?:bai|ban|giup|hoc|lam|minh|toi)(?:$|[\s.,!?;:])/iu;

export interface ActionPreview {
  classroom: boolean;
  dwellMs: number;
  language: AppLanguage;
  message: string;
  screenPoint?: { x: number; y: number };
  screenRegion?: { height: number; width: number; x: number; y: number };
  target?: string;
  taskId: string;
}

function normalizeRequest(request: string): string {
  return request
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/đ/gu, 'd');
}

export function isClassroomRequest(request: string): boolean {
  return CLASSROOM_REQUEST_PATTERN.test(normalizeRequest(request));
}

function actionPreviewLanguage(
  value: string,
  preferredLanguage: AppLanguage | undefined,
): AppLanguage {
  return VIETNAMESE_TEXT_PATTERN.test(value)
    ? 'vi'
    : (preferredLanguage ?? 'en');
}

function asSentence(value: string, language: AppLanguage): string {
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  if (!trimmed) {
    return language === 'vi'
      ? 'Thực hiện bước tiếp theo.'
      : 'Perform the next step.';
  }
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function classroomReason(
  action: ProposedAction,
  language: AppLanguage,
): string {
  if (language === 'vi') {
    switch (action.action) {
      case 'open_url':
        return 'Bước này mở tài liệu học tập cần thiết cho phần tiếp theo.';
      case 'click_element':
        return 'Bước này cho thấy cách đi đến phần tiếp theo của hoạt động.';
      case 'type_text':
      case 'write_file':
        return 'Bước này áp dụng kiến thức để bạn thấy tác động trong bài làm.';
      case 'press_key':
        return 'Bước này minh họa phím tắt được dùng cho thao tác này.';
      case 'scroll':
        return 'Bước này hiển thị phần tài liệu tiếp theo trước khi tiếp tục.';
      case 'drag':
        return 'Bước này minh họa vị trí cần đặt đối tượng trong hoạt động.';
      case 'run_command':
        return 'Bước này kiểm tra cách bài làm hoạt động để liên hệ kết quả với mã.';
      default:
        return 'Bước này kết nối thao tác với mục tiêu của hoạt động.';
    }
  }
  switch (action.action) {
    case 'open_url':
      return 'This opens the learning material needed for the next step.';
    case 'click_element':
      return 'This shows how the next part of the activity is reached.';
    case 'type_text':
    case 'write_file':
      return 'This applies the idea so its effect is visible in the work.';
    case 'press_key':
      return 'This demonstrates the shortcut used for this step.';
    case 'scroll':
      return 'This reveals the next part of the material before we continue.';
    case 'drag':
      return 'This demonstrates where the item belongs in the activity.';
    case 'run_command':
      return 'This checks how the work behaves, so the result can be connected to the code.';
    default:
      return 'This connects the step to the goal of the activity.';
  }
}

function boundedMessage(
  what: string,
  language: AppLanguage,
  why?: string,
): string {
  const suffix = why
    ? language === 'vi'
      ? ` Vì sao: ${why}`
      : ` Why: ${why}`
    : '';
  const prefix = language === 'vi' ? 'Tiếp theo: ' : 'Next: ';
  const available = Math.max(1, MAX_PREVIEW_LENGTH - prefix.length - suffix.length);
  const boundedWhat =
    what.length <= available
      ? what
      : `${what.slice(0, Math.max(1, available - 1)).trimEnd()}…`;
  return `${prefix}${boundedWhat}${suffix}`.slice(0, MAX_PREVIEW_LENGTH);
}

export function actionPreviewDwellMs(message: string): number {
  return Math.min(
    MAX_PREVIEW_DWELL_MS,
    Math.max(
      MIN_PREVIEW_DWELL_MS,
      Math.ceil(
        (message.length / PREVIEW_READING_CHARACTERS_PER_SECOND) * 1_000,
      ),
    ),
  );
}

export function createActionPreview(input: {
  action: ProposedAction;
  context?: string;
  preferredLanguage?: AppLanguage;
  request: string;
  screenPoint?: { x: number; y: number };
  screenRegion?: { height: number; width: number; x: number; y: number };
  taskId: string;
}): ActionPreview {
  const language = actionPreviewLanguage(
    `${input.request} ${input.action.description}`,
    input.preferredLanguage,
  );
  const classroom = isClassroomRequest(
    [input.request, input.context, input.action.description]
      .filter(Boolean)
      .join(' '),
  );
  const message = boundedMessage(
    asSentence(input.action.description, language),
    language,
    classroom ? classroomReason(input.action, language) : undefined,
  );
  return {
    classroom,
    dwellMs: actionPreviewDwellMs(message),
    language,
    message,
    ...(input.screenPoint ? { screenPoint: input.screenPoint } : {}),
    ...(input.screenRegion ? { screenRegion: input.screenRegion } : {}),
    ...(input.action.target ? { target: input.action.target.slice(0, 80) } : {}),
    taskId: input.taskId,
  };
}
