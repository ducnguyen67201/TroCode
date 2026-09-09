import { ClassroomLessonPlanSchema, type LessonContext, type LessonStep } from './classroom-lesson-contracts';
import { validateClassroomUrl } from './classroom-url-policy';
import { randomUUID } from './renderer-uuid';

export interface TeachingOptions {
  material: 'auto' | 'current_screen' | string;
  surface: 'current_window' | 'resource_app';
  language: 'en' | 'vi';
  section: string;
}

/** Resolve the supported teaching requests into reviewable steps, never tool calls. */
export function planFromRequest(context: LessonContext, runId: string, request: string, vi: boolean, options?: TeachingOptions) {
  const text = [request.trim(), options?.section.trim() ? `Section: ${options.section.trim()}` : ''].filter(Boolean).join('\n');
  if (options && (context.maxPlanVersion ?? 1) < 3)
    throw new Error(vi ? 'Máy chủ cần cập nhật để dạy trên máy học sinh.' : 'Update the class server to teach in students’ applications.');
  const normalized = text.toLocaleLowerCase();
  const source = options?.material === 'current_screen' ? undefined : context.sources.find((item) => {
    if (options && options.material !== 'auto') return item.sourceVersionId === options.material;
    const title = item.title.toLocaleLowerCase();
    return normalized.includes(title) || normalized.includes(title.replace(/\.md$/u, ''));
  });
  const language = options?.language ?? (/tiếng việt|vietnamese/iu.test(text) ? 'vi' : /\benglish\b|tiếng anh/iu.test(text) ? 'en' : vi ? 'vi' : 'en');
  const wantsOpen = /\b(open(?:ing)?|navigate|visit)\b|(?:^|\s)mở(?:\s|$)/iu.test(text);
  const wantsExplain = /\b(explain(?:ing)?|walk\s*through|teach|summarize|describe)\b|giải thích|hướng dẫn/iu.test(text);
  const wantsDemo = /\b(demonstrate|demo|do it)\b|làm mẫu|thực hiện trên máy/iu.test(text);
  const wantsPractice = /\b(practice|try)\b|thực hành|tự làm/iu.test(text);
  const wantsCheck = /\b(check|review)\b|kiểm tra|chấm/iu.test(text);
  const explicitUrls = text.match(/https?:\/\/[^\s<>]+/giu) ?? [];
  // A known file title is a source, not a hostname. Bare hosts are accepted only for link requests.
  const bareUrls = explicitUrls.length || source || !wantsOpen ? []
    : text.match(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>]*)?/giu) ?? [];
  const targets = [...new Set([...explicitUrls, ...bareUrls].map((value) => value.replace(/[),.!?'"`]+$/u, '')))];
  if (targets.length > 1) throw new Error(vi ? 'Hãy mở một liên kết mỗi lần.' : 'Use one material link per request.');
  const target = options && source ? undefined : targets[0];
  let url: URL | null = null;
  if (target) {
    url = validateClassroomUrl(/^https?:/iu.test(target) ? target : `https://${target}`);
    if (!url) throw new Error(vi ? 'Cần liên kết HTTPS công khai hợp lệ.' : 'Use a valid public HTTPS material link.');
    if (!context.allowedOrigins.includes(url.origin))
      throw new Error(vi ? 'Liên kết này chưa nằm trong danh sách miền được phép.' : 'This URL is not in the approved material origins.');
  }
  if (options?.material !== 'current_screen' && !source && !url && /\b[^\s]+\.md\b/iu.test(text))
    throw new Error(vi ? 'Không tìm thấy tài liệu này trong buổi học.' : 'That material is not attached to this session.');
  if (wantsOpen && !url && !source)
    throw new Error(vi ? 'Hãy ghi liên kết hoặc tên tài liệu của buổi học.' : 'Include the link or the name of a session material to open.');
  if (wantsDemo && !url && !options)
    throw new Error(vi ? 'Hãy thêm liên kết bài tập trình duyệt để làm mẫu.' : 'Include the approved browser exercise URL for a demonstration.');

  const resourceId = randomUUID();
  if (options && !['auto', 'current_screen'].includes(options.material) && !source)
    throw new Error('The selected class material is no longer available.');
  const resource = options?.material === 'current_screen'
    ? { id: resourceId, kind: 'current_screen' as const, title: language === 'vi' ? 'Cửa sổ của học sinh' : 'Student’s current window' }
    : url
    ? { id: resourceId, kind: 'web' as const, title: url.hostname, url: url.href, origin: url.origin }
    : source
      ? { id: resourceId, kind: 'source_text' as const, title: source.title, sourceVersionId: source.sourceVersionId }
      : { id: resourceId, kind: 'assignment' as const, title: context.title };
  const criteria = context.criteria.map((criterion) => criterion.id);
  const makeStep = (mode: LessonStep['mode'], instruction = text): LessonStep => ({
    id: randomUUID(), mode, resourceId, objective: instruction, instruction,
    ...(options ? { surface: { kind: options.surface, navigation: 'tro' as const } } : {}),
    criterionIds: mode === 'check' ? criteria : [],
    demonstration: mode === 'demonstrate'
      ? { exampleDescription: instruction, expectedResult: 'The reviewed example is visible and verified.' } : null,
  });
  const steps: LessonStep[] = [];
  const openOnly = wantsOpen && !wantsExplain && !wantsDemo && !wantsPractice && !wantsCheck;
  if (openOnly) steps.push(makeStep('open'));
  else {
    if (wantsExplain || (!wantsDemo && !wantsPractice && !wantsCheck)) steps.push(makeStep('explain'));
    if (wantsDemo) steps.push(makeStep('demonstrate'));
    if (wantsPractice) steps.push(makeStep('practice'));
    if (wantsCheck) steps.push(makeStep('check'));
  }
  if (openOnly && (context.maxPlanVersion ?? 1) < 2)
    throw new Error(vi ? 'Máy chủ lớp học cần bản cập nhật mở tài liệu.' : 'The class server needs the material-opening update before this lesson can be sent.');
  return ClassroomLessonPlanSchema.parse({
    schemaVersion: options ? 3 : openOnly ? 2 : 1,
    targetRunId: runId, activityVersionId: context.activityVersionId,
    title: openOnly ? `${language === 'vi' ? 'Mở' : 'Open'} ${resource.title}`.slice(0, 240) : context.title,
    objective: text, language, resources: [resource], steps,
  });
}
