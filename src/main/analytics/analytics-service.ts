import { randomUUID } from 'node:crypto';

import { PostHog, type EventMessage, type IdentifyMessage } from 'posthog-node';
import { z } from 'zod';

import {
  AgentActivityUpdateSchema,
  RecordVoiceTranscriptRequestSchema,
  TaskUpdateSchema,
  type TaskSnapshot,
} from '../../shared/contracts';
import { toolIdentityForAction } from '../agent/runtime-tool-registry';

import type {
  AnalyticsIdentity,
  AnalyticsIdentityStore,
} from './analytics-identity-store';

const AnalyticsUserSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  email: z.string().trim().email().max(320).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  loginMethod: z.enum(['email', 'oauth', 'sso', 'unknown']).default('unknown'),
});

const TRACKED_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'clarifying',
  'ready',
  'awaiting_approval',
  'awaiting_input',
  'planning',
  'verifying',
  'completed',
  'failed',
  'cancelled',
]);

const TERMINAL_PHASES: ReadonlySet<TaskSnapshot['phase']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

type AnalyticsProperties = Record<
  string,
  string | number | boolean | string[]
>;

export interface AnalyticsClient {
  alias(data: {
    alias: string;
    disableGeoip?: boolean;
    distinctId: string;
  }): void;
  capture(message: EventMessage): void;
  identify(message: IdentifyMessage): void;
  shutdown(timeoutMs?: number): Promise<void>;
}

interface AnalyticsServiceOptions {
  appVersion: string;
  architecture: string;
  client?: AnalyticsClient | null;
  createAnonymousId?: () => string;
  environment: string;
  host?: string;
  identityStore: AnalyticsIdentityStore;
  now?: () => Date;
  platform: string;
  projectToken?: string;
}

export type AnalyticsUser = z.input<typeof AnalyticsUserSchema>;

function createPostHogClient(
  projectToken: string | undefined,
  host: string | undefined,
): AnalyticsClient | null {
  const normalizedProjectToken = projectToken?.trim();
  if (!normalizedProjectToken) return null;

  return new PostHog(normalizedProjectToken, {
    disableGeoip: true,
    enableExceptionAutocapture: false,
    flushAt: 20,
    flushInterval: 10_000,
    host: host?.trim() || 'https://us.i.posthog.com',
    isServer: false,
    privacyMode: true,
    requestTimeout: 5_000,
  });
}

export class AnalyticsService {
  private readonly client: AnalyticsClient | null;

  private readonly createAnonymousId: () => string;

  private readonly identityStore: AnalyticsIdentityStore;

  private readonly now: () => Date;

  private readonly sharedProperties: AnalyticsProperties;

  private identity: AnalyticsIdentity | null = null;

  private sessionStartedAt: Date | null = null;

  private startPromise: Promise<void> | null = null;

  private shutdownPromise: Promise<void> | null = null;

  private readonly seenEventIds = new Set<string>();

  private readonly seenTaskIds = new Set<string>();

  private readonly seenFirstDeltaTaskIds = new Set<string>();

  private readonly pendingFirstDeltaAt = new Map<string, number>();

  private readonly taskApprovalCounts = new Map<string, number>();

  private readonly taskStartedAt = new Map<string, number>();

  constructor(options: AnalyticsServiceOptions) {
    this.client =
      options.client === undefined
        ? createPostHogClient(options.projectToken, options.host)
        : options.client;
    this.createAnonymousId = options.createAnonymousId ?? randomUUID;
    this.identityStore = options.identityStore;
    this.now = options.now ?? (() => new Date());
    this.sharedProperties = {
      app_version: options.appVersion,
      architecture: options.architecture,
      environment: options.environment,
      platform: options.platform,
    };
  }

  start(): Promise<void> {
    this.startPromise ??= this.initialize();
    return this.startPromise;
  }

  async trackVoiceTranscript(input: unknown): Promise<void> {
    const transcript = RecordVoiceTranscriptRequestSchema.parse(input);
    if (!this.client) return;
    await this.start();
    if (!this.identity) return;

    this.capture('voice transcription completed', {
      character_count: transcript.text.length,
    });
  }

  async trackTaskUpdate(input: unknown): Promise<void> {
    if (!this.client) return;
    await this.start();
    if (!this.identity) return;

    const parsedUpdate = TaskUpdateSchema.safeParse(input);
    if (!parsedUpdate.success) return;
    const update = parsedUpdate.data;
    if (this.seenEventIds.has(update.event.eventId)) return;
    this.seenEventIds.add(update.event.eventId);

    const snapshot = update.snapshot;
    const isNewTask = !this.seenTaskIds.has(snapshot.taskId);
    if (isNewTask) {
      this.seenTaskIds.add(snapshot.taskId);
      this.taskStartedAt.set(snapshot.taskId, Date.parse(snapshot.createdAt));
      this.capture('task created', {
        initial_phase: snapshot.phase,
      });
      const pendingFirstDeltaAt = this.pendingFirstDeltaAt.get(snapshot.taskId);
      if (pendingFirstDeltaAt !== undefined) {
        this.captureFirstDelta(snapshot.taskId, pendingFirstDeltaAt);
      }
    }

    if (!TRACKED_PHASES.has(snapshot.phase)) return;

    const goalProperties: AnalyticsProperties = snapshot.goal
      ? {
          contract_version: snapshot.goal.schemaVersion,
          ...(snapshot.goal.schemaVersion === 5
            ? {
                autonomy_mode: snapshot.goal.autonomyMode,
                execution_profile: snapshot.goal.executionProfile,
                runtime_kind: snapshot.goal.runtimeKind,
              }
            : {}),
          ...(snapshot.goal.schemaVersion === 2
            ? { legacy_behavior: snapshot.goal.behavior }
            : {}),
        }
      : {};

    if (snapshot.phase === 'ready') {
      this.capture('task ready', goalProperties);
      return;
    }
    if (snapshot.phase === 'planning') {
      this.capture('model sample', goalProperties);
      return;
    }
    if (snapshot.phase === 'clarifying' || snapshot.phase === 'awaiting_input') {
      this.capture('clarification requested');
      return;
    }
    if (snapshot.phase === 'awaiting_approval') {
      const action =
        snapshot.pendingInteraction?.kind === 'approval'
          ? snapshot.pendingInteraction.action
          : null;
      const toolIdentity = action ? toolIdentityForAction(action) : null;
      this.taskApprovalCounts.set(
        snapshot.taskId,
        (this.taskApprovalCounts.get(snapshot.taskId) ?? 0) + 1,
      );
      this.capture('approval requested', {
        action_type: action?.action ?? 'unknown',
        operation: toolIdentity?.operation ?? 'unknown',
        tool_id: toolIdentity?.toolId ?? 'unknown',
      });
      return;
    }
    if (snapshot.phase === 'verifying' && update.event.tool) {
      this.capture('tool call completed', {
        operation: update.event.tool.operation,
        tool_id: update.event.tool.toolId,
      });
      return;
    }
    if (TERMINAL_PHASES.has(snapshot.phase)) {
      const toolCount = snapshot.progress
        ? 'kind' in snapshot.progress
          ? snapshot.progress.completed
          : snapshot.progress.currentStep
        : 0;
      this.capture('task ended', {
        ...goalProperties,
        approval_count: this.taskApprovalCounts.get(snapshot.taskId) ?? 0,
        outcome: snapshot.phase,
        tool_count: toolCount,
      });
    }
  }

  async trackAgentActivity(input: unknown): Promise<void> {
    if (!this.client) return;
    await this.start();
    if (!this.identity) return;

    const activity = AgentActivityUpdateSchema.safeParse(input);
    if (
      !activity.success ||
      activity.data.kind !== 'text_delta' ||
      this.seenFirstDeltaTaskIds.has(activity.data.taskId)
    ) {
      return;
    }
    const startedAt = this.taskStartedAt.get(activity.data.taskId);
    const deltaAt = Date.parse(activity.data.timestamp);
    if (startedAt === undefined) {
      const pending = this.pendingFirstDeltaAt.get(activity.data.taskId);
      this.pendingFirstDeltaAt.set(
        activity.data.taskId,
        pending === undefined ? deltaAt : Math.min(pending, deltaAt),
      );
      return;
    }
    this.captureFirstDelta(activity.data.taskId, deltaAt);
  }

  private captureFirstDelta(taskId: string, deltaAt: number): void {
    if (this.seenFirstDeltaTaskIds.has(taskId)) return;
    const startedAt = this.taskStartedAt.get(taskId);
    if (startedAt === undefined) return;
    this.seenFirstDeltaTaskIds.add(taskId);
    this.pendingFirstDeltaAt.delete(taskId);
    this.capture('agent first delta', {
      time_to_first_delta_ms: Math.max(0, deltaAt - startedAt),
    });
  }

  async identifyUser(input: AnalyticsUser): Promise<void> {
    if (!this.client) return;
    const user = AnalyticsUserSchema.parse(input);
    await this.start();
    if (!this.identity) return;

    const anonymousId = this.identity.anonymousId;
    if (!this.identity.userId && anonymousId !== user.userId) {
      this.safeClientCall(() =>
        this.client?.alias({
          alias: user.userId,
          disableGeoip: true,
          distinctId: anonymousId,
        }),
      );
    }

    const properties: Record<string, string> = {};
    if (user.email) properties.email = user.email;
    if (user.name) properties.name = user.name;
    this.safeClientCall(() =>
      this.client?.identify({
        distinctId: user.userId,
        properties,
        disableGeoip: true,
      }),
    );

    this.identity = { ...this.identity, userId: user.userId };
    await this.saveIdentity();
    this.capture('user logged in', { login_method: user.loginMethod });
  }

  async resetUser(): Promise<void> {
    if (!this.client) return;
    await this.start();
    if (!this.identity) return;

    this.capture('user logged out');
    this.identity = { anonymousId: this.createAnonymousId() };
    await this.saveIdentity();
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.finishShutdown();
    return this.shutdownPromise;
  }

  private async initialize(): Promise<void> {
    if (!this.client) return;

    try {
      this.identity = await this.identityStore.load();
      this.sessionStartedAt = this.now();
      this.capture('application opened');
    } catch {
      this.identity = null;
      this.sessionStartedAt = null;
    }
  }

  private capture(
    event: string,
    properties: AnalyticsProperties = {},
  ): void {
    if (!this.client || !this.identity) return;

    const hasIdentifiedUser = Boolean(this.identity.userId);
    this.safeClientCall(() =>
      this.client?.capture({
        distinctId: this.identity?.userId ?? this.identity?.anonymousId,
        event,
        properties: {
          ...this.sharedProperties,
          ...properties,
          $process_person_profile: hasIdentifiedUser,
        },
      }),
    );
  }

  private async finishShutdown(): Promise<void> {
    if (!this.client || !this.startPromise) return;
    await this.startPromise;
    if (!this.identity) return;

    const sessionDurationSeconds = this.sessionStartedAt
      ? Math.max(
          0,
          Math.round(
            (this.now().getTime() - this.sessionStartedAt.getTime()) / 1_000,
          ),
        )
      : 0;
    this.capture('application closed', {
      session_duration_seconds: sessionDurationSeconds,
    });

    try {
      await this.client.shutdown(1_500);
    } catch {
      // Analytics delivery must never prevent the desktop application from exiting.
    }
  }

  private async saveIdentity(): Promise<void> {
    if (!this.identity) return;
    try {
      await this.identityStore.save(this.identity);
    } catch {
      // Keep the current in-memory identity; analytics persistence is best-effort.
    }
  }

  private safeClientCall(operation: () => void): void {
    try {
      operation();
    } catch {
      // Product analytics must never affect the application's control flow.
    }
  }
}
