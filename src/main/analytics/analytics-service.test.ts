import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { EventMessage, IdentifyMessage } from 'posthog-node';
import { describe, expect, it } from 'vitest';

import { TaskRuntime } from '../agent/task-runtime';

import {
  FileAnalyticsIdentityStore,
  type AnalyticsIdentity,
  type AnalyticsIdentityStore,
} from './analytics-identity-store';
import { AnalyticsService, type AnalyticsClient } from './analytics-service';

class MemoryIdentityStore implements AnalyticsIdentityStore {
  readonly saved: AnalyticsIdentity[] = [];

  constructor(private identity: AnalyticsIdentity) {}

  async load(): Promise<AnalyticsIdentity> {
    return this.identity;
  }

  async save(identity: AnalyticsIdentity): Promise<void> {
    this.identity = identity;
    this.saved.push(identity);
  }
}

class RecordingAnalyticsClient implements AnalyticsClient {
  readonly aliases: Array<{
    alias: string;
    disableGeoip?: boolean;
    distinctId: string;
  }> = [];

  readonly events: EventMessage[] = [];

  readonly identifies: IdentifyMessage[] = [];

  readonly shutdownTimeouts: Array<number | undefined> = [];

  alias(data: {
    alias: string;
    disableGeoip?: boolean;
    distinctId: string;
  }): void {
    this.aliases.push(data);
  }

  capture(message: EventMessage): void {
    this.events.push(message);
  }

  identify(message: IdentifyMessage): void {
    this.identifies.push(message);
  }

  async shutdown(timeoutMs?: number): Promise<void> {
    this.shutdownTimeouts.push(timeoutMs);
  }
}

function createService(
  client: RecordingAnalyticsClient,
  identityStore: AnalyticsIdentityStore,
  now: () => Date = () => new Date('2026-08-15T06:00:00.000Z'),
): AnalyticsService {
  return new AnalyticsService({
    appVersion: '0.1.0',
    architecture: 'arm64',
    client,
    environment: 'test',
    identityStore,
    now,
    platform: 'darwin',
  });
}

describe('FileAnalyticsIdentityStore', () => {
  it('creates and then reloads a stable anonymous installation ID', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'trocode-analytics-'));
    const filePath = path.join(directory, 'identity.json');
    const anonymousId = '6990a250-dfaa-411e-bd60-988c500cf84f';

    try {
      const store = new FileAnalyticsIdentityStore(filePath, () => anonymousId);
      await expect(store.load()).resolves.toEqual({ anonymousId });
      await store.save({ anonymousId, userId: 'account-42' });
      await expect(store.load()).resolves.toEqual({ anonymousId });
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ anonymousId });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('replaces invalid analytics state without failing application startup', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'trocode-analytics-'));
    const filePath = path.join(directory, 'identity.json');
    const anonymousId = '2813dbfb-53ed-42c3-8657-f5df1863efb4';

    try {
      await writeFile(filePath, '{"anonymousId":"not-a-uuid"}', 'utf8');
      const store = new FileAnalyticsIdentityStore(filePath, () => anonymousId);

      await expect(store.load()).resolves.toEqual({ anonymousId });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe('AnalyticsService', () => {
  it('captures only allowlisted content-free CUA performance fields', async () => {
    const client = new RecordingAnalyticsClient();
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      }),
    );

    await service.trackCuaPerformance({
      durationMs: 24.6,
      fallbackReason: 'none',
      operation: 'get_window_state',
      route: 'window_accessibility',
      screenshotAttached: false,
      status: 'confirmed',
    });

    expect(client.events.at(-1)).toEqual(
      expect.objectContaining({
        event: 'cua operation completed',
        properties: expect.objectContaining({
          duration_ms: 25,
          fallback_reason: 'none',
          operation: 'get_window_state',
          route: 'window_accessibility',
          screenshot_attached: false,
          status: 'confirmed',
        }),
      }),
    );
    expect(JSON.stringify(client.events)).not.toContain('windowTitle');
  });

  it('captures an application open without creating an anonymous person profile', async () => {
    const client = new RecordingAnalyticsClient();
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      }),
    );

    await service.start();

    expect(client.events).toEqual([
      {
        distinctId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
        event: 'application opened',
        properties: {
          $process_person_profile: false,
          app_version: '0.1.0',
          architecture: 'arm64',
          environment: 'test',
          platform: 'darwin',
        },
      },
    ]);
  });

  it('captures only allowlisted task metadata and never the request text', async () => {
    const client = new RecordingAnalyticsClient();
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      }),
    );
    const runtime = new TaskRuntime({
      now: () => new Date('2026-08-15T06:00:00.000Z'),
    });
    const snapshot = runtime.submit(
      {
        text: 'Research private acquisition documents in /Users/example',
        executionProfile: 'workspace',
        workspaceSelectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      {
        autonomyMode: 'balanced',
        executionProfile: 'workspace',
        runtimeKind: 'openai_agents',
        workspace: {
          canonicalPath: '/Users/example',
          displayName: 'example',
          selectedAt: '2026-08-15T05:59:00.000Z',
          selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      },
    );

    await service.start();
    await service.trackTaskUpdate({
      event: snapshot.lastEvent,
      snapshot,
    });

    const serializedEvents = JSON.stringify(client.events);
    expect(client.events.map((event) => event.event)).toEqual([
      'application opened',
      'task created',
      'task ready',
    ]);
    expect(serializedEvents).not.toContain('private acquisition');
    expect(serializedEvents).not.toContain('/Users/example');
    expect(client.events.at(-1)?.properties).toMatchObject({
      autonomy_mode: 'balanced',
      contract_version: 6,
      execution_profile: 'workspace',
      runtime_kind: 'openai_agents',
    });
    expect(client.events.at(-1)?.properties).not.toHaveProperty('behavior');
  });

  it('captures first-delta latency once without capturing streamed text', async () => {
    const client = new RecordingAnalyticsClient();
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      }),
    );
    const runtime = new TaskRuntime({
      now: () => new Date('2026-08-15T06:00:00.000Z'),
    });
    const snapshot = runtime.submit({ text: 'Private prompt' });

    await service.trackTaskUpdate({ event: snapshot.lastEvent, snapshot });
    await service.trackAgentActivity({
      activityId: '58fcc14c-69bd-42e2-914f-fc66cf43a69d',
      kind: 'text_delta',
      sequence: 0,
      taskId: snapshot.taskId,
      textDelta: 'Private streamed answer',
      timestamp: '2026-08-15T06:00:01.250Z',
    });
    await service.trackAgentActivity({
      activityId: '2e6b2da0-232a-4f3a-bfbd-e0d01144056c',
      kind: 'text_delta',
      sequence: 1,
      taskId: snapshot.taskId,
      textDelta: 'Another private chunk',
      timestamp: '2026-08-15T06:00:01.500Z',
    });

    expect(client.events.filter((event) => event.event === 'agent first delta')).toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({ time_to_first_delta_ms: 1_250 }),
      }),
    ]);
    expect(JSON.stringify(client.events)).not.toContain('Private streamed answer');
    expect(JSON.stringify(client.events)).not.toContain('Another private chunk');
  });

  it('records only aggregate approval and tool counts at terminal status', async () => {
    const client = new RecordingAnalyticsClient();
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      }),
    );
    const runtime = new TaskRuntime({
      now: () => new Date('2026-08-15T06:00:00.000Z'),
    });
    const ready = runtime.submit({ text: 'Complete a bounded task.' });
    await service.trackTaskUpdate({ event: ready.lastEvent, snapshot: ready });
    const terminal = {
      ...ready,
      phase: 'completed' as const,
      progress: { kind: 'tool_calls' as const, completed: 2, limit: 30 },
      lastEvent: {
        ...ready.lastEvent,
        eventId: '7bb1510d-51f9-429c-bbde-97112712b7b8',
        phase: 'completed' as const,
        summary: 'Task completed.',
      },
    };

    await service.trackTaskUpdate({ event: terminal.lastEvent, snapshot: terminal });

    expect(client.events.at(-1)).toMatchObject({
      event: 'task ended',
      properties: { approval_count: 0, outcome: 'completed', tool_count: 2 },
    });
  });

  it('captures only voice transcript counts, never transcript content', async () => {
    const client = new RecordingAnalyticsClient();
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
        userId: 'account-42',
      }),
    );

    await service.trackVoiceTranscript({
      text: '  Open YouTube and find the latest Tro demo  ',
    });

    expect(client.events.at(-1)).toMatchObject({
      distinctId: 'account-42',
      event: 'voice transcription completed',
      properties: {
        character_count: 'Open YouTube and find the latest Tro demo'.length,
      },
    });
    expect(JSON.stringify(client.events.at(-1))).not.toContain('Open YouTube');
  });

  it('links login activity to an identified user and rotates identity on logout', async () => {
    const client = new RecordingAnalyticsClient();
    const identityStore = new MemoryIdentityStore({
      anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
    });
    const service = new AnalyticsService({
      appVersion: '0.1.0',
      architecture: 'arm64',
      client,
      createAnonymousId: () => 'd261a8fb-d6e0-4d9e-a419-7a00da2d962b',
      environment: 'test',
      identityStore,
      platform: 'darwin',
    });

    await service.identifyUser({
      email: 'person@example.com',
      loginMethod: 'oauth',
      name: 'Example Person',
      userId: 'account-42',
    });
    await service.resetUser();

    expect(client.aliases).toEqual([
      {
        alias: 'account-42',
        disableGeoip: true,
        distinctId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      },
    ]);
    expect(client.identifies).toEqual([
      {
        disableGeoip: true,
        distinctId: 'account-42',
        properties: {
          email: 'person@example.com',
          name: 'Example Person',
        },
      },
    ]);
    expect(client.events.map((event) => [event.event, event.distinctId])).toEqual([
      ['application opened', '28824655-b32f-41d3-ab2d-2f7df31363ef'],
      ['user logged in', 'account-42'],
      ['user logged out', 'account-42'],
    ]);
    expect(identityStore.saved.at(-1)).toEqual({
      anonymousId: 'd261a8fb-d6e0-4d9e-a419-7a00da2d962b',
    });
  });

  it('flushes a duration event during graceful shutdown', async () => {
    const client = new RecordingAnalyticsClient();
    const timestamps = [
      new Date('2026-08-15T06:00:00.000Z'),
      new Date('2026-08-15T06:02:03.000Z'),
    ];
    const service = createService(
      client,
      new MemoryIdentityStore({
        anonymousId: '28824655-b32f-41d3-ab2d-2f7df31363ef',
      }),
      () => timestamps.shift() ?? new Date('2026-08-15T06:02:03.000Z'),
    );

    await service.start();
    await service.shutdown();

    expect(client.events.at(-1)).toMatchObject({
      event: 'application closed',
      properties: { session_duration_seconds: 123 },
    });
    expect(client.shutdownTimeouts).toEqual([1_500]);
  });
});
