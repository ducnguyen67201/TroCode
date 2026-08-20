import type {
  RuntimeToolId,
  TaskBehavior,
  TaskEvent,
  TaskSnapshot,
} from '../shared/contracts';

const ACTIVITY_DAY_COUNT = 42;
const FINISHED_PHASES = new Set(['completed', 'failed', 'cancelled']);
const LEARNING_TOPIC_MAX_LENGTH = 140;
const ACADEMIC_CONTEXT_PATTERN =
  /\b(assignment|homework|study|lesson|quiz|exam|essay|worksheet|problem set|equation|algebra|geometry|calculus|math|physics|chemistry|biology|science|history|literature|grammar|thesis|citation|research paper)\b/iu;
const EXPLICIT_SUPPORT_PATTERN =
  /\b(help|explain|understand|struggl\w*|stuck|confus\w*|difficult|hard time|review|check my)\b/iu;
const QUANTITATIVE_TOPIC_PATTERN =
  /\b(equation|algebra|geometry|calculus|math|physics|statistics|probability)\b/iu;
const WRITING_TOPIC_PATTERN =
  /\b(essay|writing|paragraph|thesis|citation|literature|grammar|research paper)\b/iu;
const SCIENCE_TOPIC_PATTERN =
  /\b(chemistry|biology|science|experiment|molecule|reaction|cell)\b/iu;

const QUANTITATIVE_RECOMMENDATION =
  'Work through one smaller example step by step, explain why each operation is valid, then retry the assignment problem.';
const WRITING_RECOMMENDATION =
  'Outline the claim, evidence, and explanation first; draft one paragraph, then revise it with feedback.';
const SCIENCE_RECOMMENDATION =
  'List what is known, name the concept or formula that connects it, and test it on one simpler example.';
const GENERAL_RECOMMENDATION =
  'Break the assignment into one smaller question, explain the first step in your own words, then practise a similar example.';

export interface BehaviorUsage {
  behavior: TaskBehavior;
  count: number;
  percentage: number;
}

export interface ToolUsage {
  count: number;
  percentage: number;
  toolId: RuntimeToolId;
}

export interface ActivityDay {
  count: number;
  date: string;
  label: string;
  level: 0 | 1 | 2 | 3 | 4;
  weekday: string;
}

export interface InsightsSummary {
  activityDays: ActivityDay[];
  approvalDecisions: number;
  legacyBehaviorUsage: BehaviorUsage[];
  completedTasks: number;
  completionRate: number;
  currentStreak: number;
  errorEvents: number;
  eventCount: number;
  finishedTasks: number;
  longestStreak: number;
  stepsObserved: number;
  taskCount: number;
  toolUsage: ToolUsage[];
}

export interface LearningFocus {
  recommendation: string;
  topic: string;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function uniqueTasks(tasks: readonly TaskSnapshot[]): TaskSnapshot[] {
  const byTaskId = new Map<string, TaskSnapshot>();
  for (const task of tasks) byTaskId.set(task.taskId, task);
  return [...byTaskId.values()];
}

function uniqueEvents(events: readonly TaskEvent[]): TaskEvent[] {
  const byEventId = new Map<string, TaskEvent>();
  for (const event of events) byEventId.set(event.eventId, event);
  return [...byEventId.values()];
}

function learningRecommendation(topic: string): string {
  if (QUANTITATIVE_TOPIC_PATTERN.test(topic)) {
    return QUANTITATIVE_RECOMMENDATION;
  }
  if (WRITING_TOPIC_PATTERN.test(topic)) return WRITING_RECOMMENDATION;
  if (SCIENCE_TOPIC_PATTERN.test(topic)) return SCIENCE_RECOMMENDATION;
  return GENERAL_RECOMMENDATION;
}

function conciseLearningTopic(request: string): string {
  const normalized = request.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= LEARNING_TOPIC_MAX_LENGTH) return normalized;

  const truncated = normalized.slice(0, LEARNING_TOPIC_MAX_LENGTH - 1);
  const finalWordBoundary = truncated.lastIndexOf(' ');
  const topic =
    finalWordBoundary >= LEARNING_TOPIC_MAX_LENGTH * 0.65
      ? truncated.slice(0, finalWordBoundary)
      : truncated;
  return `${topic}…`;
}

export function createLearningFocus(
  taskSnapshots: readonly TaskSnapshot[],
): LearningFocus | null {
  const tasks = uniqueTasks(taskSnapshots);

  const task = tasks
    .filter((candidate) => {
      if (!ACADEMIC_CONTEXT_PATTERN.test(candidate.request)) return false;

      const conversation = [
        candidate.request,
        ...candidate.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.text),
      ].join(' ');
      const supportTurns = candidate.messages.filter((message) =>
        ['answer', 'clarification', 'steering'].includes(message.kind),
      ).length;

      return (
        EXPLICIT_SUPPORT_PATTERN.test(conversation) ||
        supportTurns >= 2
      );
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (!task) return null;

  return {
    recommendation: learningRecommendation(task.request),
    topic: conciseLearningTopic(task.request),
  };
}

function calculateLongestStreak(activeDates: ReadonlySet<string>): number {
  const sortedDates = [...activeDates].sort();
  let longestStreak = 0;
  let runningStreak = 0;
  let previousDate: Date | null = null;

  for (const dateKey of sortedDates) {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const followsPrevious =
      previousDate !== null &&
      utcDateKey(addUtcDays(previousDate, 1)) === dateKey;
    runningStreak = followsPrevious ? runningStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, runningStreak);
    previousDate = date;
  }

  return longestStreak;
}

export function createInsightsSummary(
  taskSnapshots: readonly TaskSnapshot[],
  taskEvents: readonly TaskEvent[],
  now = new Date(),
): InsightsSummary {
  const tasks = uniqueTasks(taskSnapshots);
  const events = uniqueEvents(taskEvents);
  const completedTasks = tasks.filter(
    (task) => task.phase === 'completed',
  ).length;
  const finishedTasks = tasks.filter((task) =>
    FINISHED_PHASES.has(task.phase),
  ).length;
  const behaviorCounts = new Map<TaskBehavior, number>();

  for (const task of tasks) {
    if (!task.goal || task.goal.schemaVersion !== 2) continue;
    const behavior = task.goal.behavior;
    behaviorCounts.set(behavior, (behaviorCounts.get(behavior) ?? 0) + 1);
  }

  const highestBehaviorCount = Math.max(
    1,
    ...behaviorCounts.values(),
  );
  const behaviorUsage = [...behaviorCounts.entries()]
    .map(([behavior, count]) => ({
      behavior,
      count,
      percentage: Math.round((count / highestBehaviorCount) * 100),
    }))
    .sort((left, right) =>
      right.count === left.count
        ? left.behavior.localeCompare(right.behavior)
        : right.count - left.count,
    );

  const toolCounts = new Map<RuntimeToolId, number>();
  for (const event of events) {
    if (event.phase !== 'verifying' || !event.tool) continue;
    toolCounts.set(
      event.tool.toolId,
      (toolCounts.get(event.tool.toolId) ?? 0) + 1,
    );
  }
  const highestToolCount = Math.max(1, ...toolCounts.values());
  const toolUsage = [...toolCounts.entries()]
    .map(([toolId, count]) => ({
      toolId,
      count,
      percentage: Math.round((count / highestToolCount) * 100),
    }))
    .sort((left, right) =>
      right.count === left.count
        ? left.toolId.localeCompare(right.toolId)
        : right.count - left.count,
    );

  const eventCountsByDate = new Map<string, number>();
  for (const event of events) {
    const dateKey = event.timestamp.slice(0, 10);
    eventCountsByDate.set(dateKey, (eventCountsByDate.get(dateKey) ?? 0) + 1);
  }

  const today = new Date(`${utcDateKey(now)}T00:00:00.000Z`);
  const firstDay = addUtcDays(today, -(ACTIVITY_DAY_COUNT - 1));
  const recentCounts = Array.from({ length: ACTIVITY_DAY_COUNT }, (_, index) => {
    const date = addUtcDays(firstDay, index);
    const dateKey = utcDateKey(date);
    return { date, dateKey, count: eventCountsByDate.get(dateKey) ?? 0 };
  });
  const maximumDailyEvents = Math.max(
    1,
    ...recentCounts.map((day) => day.count),
  );
  const activityDays: ActivityDay[] = recentCounts.map(
    ({ count, date, dateKey }) => ({
      count,
      date: dateKey,
      label: new Intl.DateTimeFormat('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(date),
      level: (count === 0
        ? 0
        : Math.max(1, Math.ceil((count / maximumDailyEvents) * 4))) as
        | 0
        | 1
        | 2
        | 3
        | 4,
      weekday: new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
      }).format(date),
    }),
  );

  const activeDates = new Set(
    [...eventCountsByDate.entries()]
      .filter(([, count]) => count > 0)
      .map(([date]) => date),
  );
  const longestStreak = calculateLongestStreak(activeDates);
  let currentStreak = 0;
  let cursor = today;
  while (activeDates.has(utcDateKey(cursor))) {
    currentStreak += 1;
    cursor = addUtcDays(cursor, -1);
  }

  const approvalMessageIds = new Set<string>();
  for (const task of tasks) {
    for (const message of task.messages) {
      if (message.kind === 'approval_decision') {
        approvalMessageIds.add(message.messageId);
      }
    }
  }

  return {
    activityDays,
    approvalDecisions: approvalMessageIds.size,
    legacyBehaviorUsage: behaviorUsage,
    completedTasks,
    completionRate:
      finishedTasks === 0
        ? 0
        : Math.round((completedTasks / finishedTasks) * 100),
    currentStreak,
    errorEvents: events.filter((event) => event.status === 'error').length,
    eventCount: events.length,
    finishedTasks,
    longestStreak,
    stepsObserved: tasks.reduce(
      (total, task) => {
        const progress = task.progress;
        if (!progress) return total;
        return (
          total + ('kind' in progress ? progress.completed : progress.currentStep)
        );
      },
      0,
    ),
    taskCount: tasks.length,
    toolUsage,
  };
}
