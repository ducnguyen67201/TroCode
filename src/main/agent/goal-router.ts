import { randomUUID } from 'node:crypto';

import type {
  Capability,
  Domain,
  GoalSpec,
  InteractionMode,
  SensitiveAction,
} from '../../shared/contracts';
import { GoalSpecSchema } from '../../shared/contracts';

const DOMAIN_TERMS: Readonly<Record<Domain, readonly string[]>> = {
  education: [
    'bai tap',
    'bài tập',
    'explain',
    'giai',
    'giải',
    'học',
    'learn',
    'lesson',
    'math',
    'school',
    'solve',
    'student',
    'teach',
    'tieng anh',
    'tiếng anh',
    'toán',
  ],
  productivity: [
    'calendar',
    'email',
    'file',
    'folder',
    'open',
    'organize',
    'remind',
    'schedule',
  ],
  coding: [
    'bug',
    'build',
    'code',
    'compile',
    'debug',
    'repository',
    'test',
  ],
  research: [
    'compare',
    'competitor',
    'find sources',
    'investigate',
    'research',
  ],
  business: [
    'crm',
    'expense',
    'form',
    'invoice',
    'report',
    'spreadsheet',
  ],
  creative: [
    'audio',
    'design',
    'image',
    'presentation',
    'video',
    'write',
  ],
  general: [],
};

const ACT_TERMS = [
  'book',
  'create',
  'delete',
  'download',
  'draft',
  'fill',
  'fix',
  'install',
  'open',
  'organize',
  'reply',
  'run',
  'schedule',
  'send',
  'submit',
  'upload',
] as const;

const GUIDE_PREFIXES = [
  'can you show',
  'cách ',
  'giai ',
  'giải ',
  'help me learn',
  'how can i',
  'how do i',
  'hướng dẫn',
  'huong dan',
  'lam sao',
  'lam the nao',
  'làm sao',
  'làm thế nào',
  'show me how',
  'solve ',
  'teach me',
  'toi giai ',
  'tôi giải ',
] as const;

const ANSWER_PREFIXES = [
  'explain',
  'tell me',
  'what does',
  'what is',
  'why does',
  'why is',
] as const;

const SENSITIVE_TERMS: ReadonlyArray<readonly [string, SensitiveAction]> = [
  ['log in', 'login'],
  ['login', 'login'],
  ['send', 'send'],
  ['submit', 'submit'],
  ['upload', 'upload'],
  ['download', 'download'],
  ['delete', 'delete'],
  ['buy', 'purchase'],
  ['purchase', 'purchase'],
  ['install', 'install'],
  ['run', 'run_command'],
  ['fix', 'write_file'],
  ['edit', 'write_file'],
] as const;

const BASE_APPROVALS: readonly SensitiveAction[] = [
  'login',
  'send',
  'submit',
  'upload',
  'delete',
  'purchase',
  'install',
];

const VISUAL_SURFACE_TERMS = [
  'app',
  'browser',
  'click',
  'screen',
  'website',
  'youtube',
  'màn hình',
  'trang này',
] as const;

const VISUAL_REFERENCE_PATTERNS = [
  /\bthis\s+(?:(?:english|math)\s+)?(?:document|exercise|image|page|picture|problem|question|screen|worksheet)\b/u,
  /(?:bai(?: tap)?|cau hoi|cua so|hinh|man hinh|tai lieu|trang).{0,60}nay/u,
  /(?:bài(?: tập)?|câu hỏi|cửa sổ|hình|màn hình|tài liệu|trang).{0,60}này/u,
] as const;

function includesTerm(request: string, term: string): boolean {
  return request.includes(term);
}

function refersToVisualSurface(request: string): boolean {
  return (
    VISUAL_SURFACE_TERMS.some((term) => includesTerm(request, term)) ||
    VISUAL_REFERENCE_PATTERNS.some((pattern) => pattern.test(request))
  );
}

export function inferDomain(request: string): Domain {
  const normalizedRequest = request.toLowerCase();
  const scoredDomains = Object.entries(DOMAIN_TERMS)
    .filter(([domain]) => domain !== 'general')
    .map(([domain, terms]) => ({
      domain: domain as Domain,
      score: terms.filter((term) => includesTerm(normalizedRequest, term)).length,
    }))
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredDomains[0];
  return bestMatch && bestMatch.score > 0 ? bestMatch.domain : 'general';
}

export function inferInteractionMode(
  request: string,
  domain = inferDomain(request),
): InteractionMode {
  const normalizedRequest = request.toLowerCase().trim();

  if (GUIDE_PREFIXES.some((prefix) => normalizedRequest.startsWith(prefix))) {
    return 'guide';
  }

  if (ANSWER_PREFIXES.some((prefix) => normalizedRequest.startsWith(prefix))) {
    return 'answer';
  }

  if (ACT_TERMS.some((term) => includesTerm(normalizedRequest, term))) {
    return 'act';
  }

  if (domain === 'education' && refersToVisualSurface(normalizedRequest)) {
    return 'guide';
  }

  return 'mixed';
}

function inferCapabilities(
  domain: Domain,
  mode: InteractionMode,
  request: string,
): Capability[] {
  const capabilities = new Set<Capability>(['conversation']);
  const normalizedRequest = request.toLowerCase();

  if (domain === 'coding') {
    capabilities.add('filesystem');
    capabilities.add('terminal');
    capabilities.add('code_editor');
  }

  if (domain === 'research') {
    capabilities.add('web_search');
    capabilities.add('browser');
    capabilities.add('documents');
  }

  if (domain === 'business') {
    capabilities.add('browser');
    capabilities.add('documents');
    capabilities.add('connectors');
  }

  if (domain === 'creative') {
    capabilities.add('documents');
    capabilities.add('media');
  }

  if (domain === 'productivity') {
    capabilities.add('filesystem');
  }

  if (
    includesTerm(normalizedRequest, 'email') ||
    includesTerm(normalizedRequest, 'gmail')
  ) {
    capabilities.add('email');
  }
  if (includesTerm(normalizedRequest, 'calendar')) capabilities.add('calendar');

  if (includesTerm(normalizedRequest, 'gmail')) capabilities.add('browser');

  const refersToVisibleScreen = refersToVisualSurface(normalizedRequest);

  if (refersToVisibleScreen || mode === 'act') {
    capabilities.add('computer_use');
  }

  const refersToBrowser = [
    'browser',
    'website',
    'youtube',
    'trang này',
  ].some((term) => includesTerm(normalizedRequest, term));
  if (refersToBrowser) {
    capabilities.add('browser');
  }

  return [...capabilities];
}

function inferSensitiveActions(request: string): SensitiveAction[] {
  const normalizedRequest = request.toLowerCase();
  const approvals = new Set<SensitiveAction>(BASE_APPROVALS);

  for (const [term, action] of SENSITIVE_TERMS) {
    if (includesTerm(normalizedRequest, term)) approvals.add(action);
  }

  return [...approvals];
}

function inferAllowedDomains(request: string): string[] {
  const normalizedRequest = request.toLowerCase();
  const domains = new Set<string>();

  if (includesTerm(normalizedRequest, 'youtube')) domains.add('youtube.com');
  if (includesTerm(normalizedRequest, 'gmail')) domains.add('mail.google.com');

  for (const match of request.matchAll(/https?:\/\/([^\s/]+)/gi)) {
    const hostname = match[1]?.replace(/[),.;]+$/, '').toLowerCase();
    if (hostname) domains.add(hostname);
  }

  return [...domains];
}

function createSuccessCriteria(mode: InteractionMode, request: string) {
  if (mode === 'guide') {
    return [
      {
        description: 'The user can identify and complete the next step.',
        verifier: 'User confirmation or observation of the requested state.',
      },
    ];
  }

  if (mode === 'answer') {
    return [
      {
        description: 'The response directly and accurately addresses the request.',
        verifier: 'Answer quality check against the original request.',
      },
    ];
  }

  return [
    {
      description: `The requested outcome is observable: ${request}`,
      verifier: 'Independent inspection of application, document, or system state.',
    },
  ];
}

export function compileGoal(request: string): GoalSpec {
  const normalizedRequest = request.trim();
  const domain = inferDomain(normalizedRequest);
  const interactionMode = inferInteractionMode(normalizedRequest, domain);

  return GoalSpecSchema.parse({
    id: randomUUID(),
    originalRequest: normalizedRequest,
    domain,
    interactionMode,
    objective: normalizedRequest,
    successCriteria: createSuccessCriteria(interactionMode, normalizedRequest),
    capabilities: inferCapabilities(domain, interactionMode, normalizedRequest),
    scope: {
      allowedApps: [],
      allowedDomains: inferAllowedDomains(normalizedRequest),
      allowedPaths: [],
    },
    approvals: {
      alwaysConfirm: inferSensitiveActions(normalizedRequest),
    },
    limits: {
      maxSteps:
        interactionMode === 'act' ? 30 : interactionMode === 'guide' ? 24 : 12,
      maxMinutes:
        interactionMode === 'act' || interactionMode === 'guide' ? 10 : 5,
    },
  });
}

export function requestNeedsClarification(request: string): boolean {
  const words = request.trim().split(/\s+/).filter(Boolean);
  return words.length < 2;
}
