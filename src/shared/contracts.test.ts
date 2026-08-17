import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ActivateMembershipRequestSchema,
  AgentTaskContractV3Schema,
  AgentTaskContractV4Schema,
  CompanionSpeechPlaybackReportSchema,
  CompanionSpeechSchema,
  MembershipStatusSchema,
  TaskHistorySchema,
  TaskProgressSchema,
  UsageBudgetSnapshotSchema,
} from './contracts';

function snapshot(goal: Record<string, unknown>, progress: unknown) {
  const taskId = randomUUID();
  const timestamp = '2026-08-17T00:00:00.000Z';
  return {
    taskId,
    request: String(goal.originalRequest),
    phase: 'completed',
    goal,
    messages: [],
    pendingInteraction: null,
    approvalGrant: null,
    progress,
    queuedSteering: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    lastEvent: null,
  };
}

const legacyBase = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  originalRequest: 'Open Gmail for me',
  behavior: 'act',
  objective: 'Open Gmail',
  successCriteria: [{ description: 'Gmail opens', verifier: 'Observe Gmail' }],
  limits: { maxSteps: 12, maxMinutes: 10 },
};

describe('shared task contracts', () => {
  it('accepts only credential-free private companion audio URLs', () => {
    const id = randomUUID();
    expect(
      CompanionSpeechSchema.parse({
        id,
        mediaUrl: `trocode-audio://speech/${id}`,
        mimeType: 'audio/mpeg',
        source: 'elevenlabs',
      }),
    ).toMatchObject({ id, source: 'elevenlabs' });

    for (const mediaUrl of [
      `https://speech/${id}`,
      `file:///tmp/${id}`,
      `data:audio/mpeg;base64,AQID`,
      `trocode-audio://speech/${id}?token=secret`,
      `trocode-audio://other/${id}`,
    ]) {
      expect(() =>
        CompanionSpeechSchema.parse({
          id,
          mediaUrl,
          mimeType: 'audio/mpeg',
          source: 'elevenlabs',
        }),
      ).toThrow();
    }
  });

  it('bounds speech playback reports to fixed status and reason enums', () => {
    const id = randomUUID();
    expect(
      CompanionSpeechPlaybackReportSchema.parse({
        id,
        phase: 'fallback_started',
        reason: 'startup_timeout',
        source: 'elevenlabs',
      }),
    ).toMatchObject({ id, reason: 'startup_timeout' });
    expect(() =>
      CompanionSpeechPlaybackReportSchema.parse({
        id,
        phase: 'failed',
        reason: 'provider said secret key invalid',
        source: 'elevenlabs',
      }),
    ).toThrow();
  });

  it('accepts hosted access-code membership contracts', () => {
    expect(
      MembershipStatusSchema.parse({
        expiresAt: null,
        referenceCode: null,
        required: true,
        state: 'inactive',
        summary: 'Enter an access code to continue.',
      }),
    ).toMatchObject({ referenceCode: null, state: 'inactive' });
    expect(ActivateMembershipRequestSchema.parse({ code: 'CODEA' })).toEqual({
      code: 'CODEA',
    });
  });

  it('parses v3 contract and tool-call progress', () => {
    expect(
      AgentTaskContractV3Schema.parse({
        schemaVersion: 3,
        id: randomUUID(),
        originalRequest: 'Write a chord progression.',
        approvalPolicy: { alwaysConfirm: ['send', 'delete'] },
        limits: { maxToolCalls: 30, maxMinutes: 10 },
      }),
    ).not.toHaveProperty('behavior');
    expect(
      TaskProgressSchema.parse({ kind: 'tool_calls', completed: 2, limit: 30 }),
    ).toEqual({ kind: 'tool_calls', completed: 2, limit: 30 });
  });

  it('parses v4 cost limits and sanitized budget snapshots', () => {
    expect(
      AgentTaskContractV4Schema.parse({
        approvalPolicy: { alwaysConfirm: ['send'] },
        id: randomUUID(),
        limits: {
          maxImages: 20,
          maxMicroUsd: 500_000,
          maxMinutes: 10,
          maxModelSamples: 40,
          maxToolCalls: 30,
        },
        originalRequest: 'Complete a useful task.',
        schemaVersion: 4,
      }),
    ).toMatchObject({ schemaVersion: 4 });
    expect(
      UsageBudgetSnapshotSchema.parse({
        actualMicroUsd: 1_000,
        daily: { limitMicroUsd: 2_000_000, remainingMicroUsd: 1_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
        enforcementMode: 'enforce',
        estimatedMicroUsd: 0,
        monthEndsAt: '2026-09-01T00:00:00.000Z',
        monthly: { limitMicroUsd: 20_000_000, remainingMicroUsd: 19_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
        periodStartsAt: '2026-08-01T00:00:00.000Z',
        source: 'hosted',
        task: { limitMicroUsd: 500_000, remainingMicroUsd: 499_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
        warningThresholdMicroUsd: 16_000_000,
      }),
    ).not.toHaveProperty('prompt');
  });

  it('loads mixed persisted v1, v2, and v3 history', () => {
    const history = TaskHistorySchema.parse({
      events: [],
      persistence: { mode: 'postgres', summary: 'Saved.' },
      snapshots: [
        snapshot(
          {
            ...legacyBase,
            interactionMode: 'mixed',
            capabilities: ['browser'],
            approvals: { alwaysConfirm: ['send'] },
          },
          { currentStep: 1, maxSteps: 12 },
        ),
        snapshot(
          {
            ...legacyBase,
            schemaVersion: 2,
            approvalPolicy: { alwaysConfirm: ['send'] },
          },
          { currentStep: 2, maxSteps: 12 },
        ),
        snapshot(
          {
            schemaVersion: 3,
            id: randomUUID(),
            originalRequest: 'What is 27 × 14?',
            approvalPolicy: { alwaysConfirm: ['send'] },
            limits: { maxToolCalls: 30, maxMinutes: 10 },
          },
          { kind: 'tool_calls', completed: 0, limit: 30 },
        ),
      ],
    });

    expect(history.snapshots.map((item) => item.goal?.schemaVersion)).toEqual([
      2, 2, 3,
    ]);
  });
});
