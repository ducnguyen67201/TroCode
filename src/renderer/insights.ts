import type {
  TaskBehavior,
  TaskEvent,
  TaskSnapshot,
} from '../shared/contracts';

const ACTIVITY_DAY_COUNT = 42;
const FINISHED_PHASES = new Set(['completed', 'failed', 'cancelled']);

export interface BehaviorUsage {
  behavior: TaskBehavior;
  count: number;
  percentage: number;
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
  behaviorUsage: BehaviorUsage[];
  completedTasks: number;
  completionRate: number;
  currentStreak: number;
  errorEvents: number;
  eventCount: number;
  finishedTasks: number;
  longestStreak: number;
  stepsObserved: number;
  taskCount: number;
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
    if (!task.goal) continue;
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
    behaviorUsage,
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
      (total, task) => total + (task.progress?.currentStep ?? 0),
      0,
    ),
    taskCount: tasks.length,
  };
}
