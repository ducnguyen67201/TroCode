import type {
  RequestedMode,
  SubmitTaskRequest,
  TaskRoute,
} from '../../shared/contracts';

export interface TaskRouteDecision {
  requiresObservation: boolean;
  route: TaskRoute;
}

export interface TaskRouteInput {
  activityLaunchTarget: 'none' | 'workspace' | 'current_surface' | null;
  executionProfile: SubmitTaskRequest['executionProfile'];
  intent: SubmitTaskRequest['activityIntent'];
  requestedMode: RequestedMode;
  screenContext: SubmitTaskRequest['screenContext'];
  text: string;
}

const MUTATION_INTENT = /\b(?:click|type|edit|create|send|submit|run|install|delete|remove|upload|download|open|launch|move|drag|drop|paste|write|fix|build|make)\b|(?:^|\s)(?:bấm|nhấn|gõ|sửa|tạo|gửi|nộp|chạy|cài|xóa|xoá|tải|mở|di chuyển|kéo|thả|dán|viết|làm hộ|làm giúp)(?:$|\s|[.,!?;:])/iu;
const EXPLICIT_AGENT = /\b(?:do it for me|take over|handle it|perform it|execute it)\b|(?:^|\s)(?:làm hộ tôi|làm giúp tôi|thực hiện giúp|tự làm đi)(?:$|\s|[.,!?;:])/iu;
const COACH_INTENT = /\b(?:show|teach|guide|explain|help|check|how do i|how to|what should i do)\b|(?:^|\s)(?:chỉ|hướng dẫn|giải thích|giúp|kiểm tra|làm sao|cách làm|em nên làm gì)(?:$|\s|[.,!?;:])/iu;

/** Pure intent routing. It grants no authority and performs no effects. */
export function routeTaskRequest(input: TaskRouteInput): TaskRouteDecision {
  if (input.intent === 'check' && input.activityLaunchTarget !== null) return coach(input.activityLaunchTarget === 'current_surface' && input.screenContext !== 'disabled');
  if (input.requestedMode === 'agent') return agent();
  if (input.requestedMode === 'coach') {
    return coach(requiresVisibleContext(input));
  }
  if (
    input.executionProfile === 'workspace' ||
    (input.activityLaunchTarget === 'workspace' && input.intent === 'work')
  ) return agent();

  const text = normalize(input.text);
  if (EXPLICIT_AGENT.test(text) || MUTATION_INTENT.test(text)) return agent();
  if (input.intent === 'help' || input.intent === 'check' || COACH_INTENT.test(text)) {
    return coach(input.screenContext !== 'disabled');
  }
  if (input.screenContext === 'required') return coach(true);
  return coach(false);
}

function requiresVisibleContext(input: TaskRouteInput): boolean {
  if (input.screenContext === 'disabled') return false;
  return input.screenContext === 'required' || input.activityLaunchTarget === 'current_surface';
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('vi');
}

function coach(requiresObservation: boolean): TaskRouteDecision {
  return { requiresObservation, route: 'coach' };
}

function agent(): TaskRouteDecision {
  return { requiresObservation: false, route: 'agent' };
}
