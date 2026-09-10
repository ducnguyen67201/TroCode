import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RuntimeToolRegistry, toolIdentityForAction } from './runtime-tool-registry';

function activityContext(insightPolicy: 'explicit_and_operational' | 'evidence_candidates') {
  return {
    attemptId: randomUUID(),
    workSessionId: randomUUID(),
    activityVersionId: randomUUID(),
    runId: randomUUID(),
    space: { id: randomUUID(), name: 'Scratch class' },
    activity: {
      title: 'Score exercise',
      objective: 'Build a score variable.',
      instructions: 'Work safely.',
      launchTarget: 'none' as const,
      guidancePolicy: { answerReveal: 'allowed' as const, hintMode: 'direct' as const, maxHintLevel: 3 },
      criteria: [],
      completionPolicy: { requiresSubmission: false, requiresFacilitatorConfirmation: false },
      sessionPolicy: { allowedOrigins: [], allowRoomJoin: true },
    },
    purpose: 'help' as const,
    currentDirective: null,
    insightPolicy,
    insightPolicyVersion: '1',
    policyAcknowledged: insightPolicy === 'evidence_candidates',
    sourceCatalog: [],
    priorProgress: { completedCriterionIds: [], sessionCount: 0, summary: 'No prior work.' },
  };
}

describe('RuntimeToolRegistry', () => {
  it('uses the shared capability catalog for lesson tasks, including app opening and user input', () => {
    const registry = new RuntimeToolRegistry();
    const context = { taskId: randomUUID() };
    const lessonContext = { ...context, lesson: { kind: 'desktop' as const, lessonId: randomUUID(), stepId: randomUUID() } };
    expect(registry.modelVisibleSpecs(lessonContext)).toEqual(registry.modelVisibleSpecs(context));
    const call = { callId: randomUUID(), name: 'open_url', arguments: JSON.stringify({ url: 'https://example.com', reason: 'Open the lesson.' }) };
    expect(registry.preview(call, lessonContext).toolId).toBe('browser.navigate');
    expect(registry.resolve(call, lessonContext).toolId).toBe('browser.navigate');
  });
  it('advertises only Heavy Agent execution tools and excludes Coach presentation', () => {
    const tools = new RuntimeToolRegistry().modelVisibleSpecs();
    expect(tools.map((tool) => tool.name)).toEqual([
      'control_desktop',
      'open_url',
      'open_application',
      'request_user_input',
    ]);
    expect(tools.map((tool) => tool.name)).not.toContain('show_guidance');
    expect(tools.every((tool) => tool.strict)).toBe(true);
  });

  it('routes high-level observations through the unified host tool', () => {
    expect(toolIdentityForAction({
      action: 'observe_screen',
      description: 'Observe the visible exercise.',
    })).toEqual({ toolId: 'computer.observe', operation: 'observe' });
  });

  it('exposes classroom tools only under trusted Activity policy', () => {
    const registry = new RuntimeToolRegistry();
    const explicit = activityContext('explicit_and_operational');
    const evidence = activityContext('evidence_candidates');
    const normal = registry.modelVisibleSpecs({ taskId: randomUUID() }).map((tool) => tool.name);
    const explicitTools = registry.modelVisibleSpecs({
      activity: explicit,
      executionProfile: 'everyday',
      taskId: randomUUID(),
      workspace: null,
    }).map((tool) => tool.name);
    const evidenceTools = registry.modelVisibleSpecs({
      activity: evidence,
      executionProfile: 'everyday',
      taskId: randomUUID(),
      workspace: null,
    }).map((tool) => tool.name);
    expect(normal).not.toContain('search_activity_knowledge');
    expect(explicitTools).toContain('search_activity_knowledge');
    expect(explicitTools).not.toContain('record_activity_signal');
    expect(evidenceTools).toContain('record_activity_signal');
  });

  it('publishes strict normalized desktop command variants', () => {
    const control = new RuntimeToolRegistry().modelVisibleSpecs()
      .find((tool) => tool.name === 'control_desktop');
    const variants = (control?.parameters.properties.command as {
      anyOf?: Array<{ properties?: Record<string, { const?: string; description?: string }> }>;
    }).anyOf ?? [];
    expect(control?.description).toContain('normalized 0-1000 image space');
    expect(variants.map((variant) => variant.properties?.kind?.const)).toEqual([
      'click', 'drag', 'type_text', 'paste_table', 'keypress', 'scroll',
    ]);
    for (const variant of variants) {
      for (const axis of ['x', 'y', 'fromX', 'fromY', 'toX', 'toY']) {
        if (variant.properties?.[axis]) {
          expect(variant.properties[axis]?.description).toContain('0 to 1000');
        }
      }
    }
  });

  it('normalizes grounded coordinates against the authoritative observation', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();
    const invocation = registry.resolve({
      callId: 'click-1',
      name: 'control_desktop',
      arguments: JSON.stringify({
        observationId,
        description: 'Click the visible button.',
        target: null,
        command: { kind: 'click', x: 500, y: 250, button: 'left', count: 1 },
      }),
    }, {
      taskId,
      latestObservation: {
        observationId,
        taskId,
        capturedAt: '2026-09-02T00:00:00.000Z',
        route: 'desktop_vision',
        text: 'A button is visible.',
        degraded: false,
        fingerprint: 'a'.repeat(64),
        coordinateSpace: {
          screenHeight: 500,
          screenWidth: 1_000,
          screenshotHeight: 1_000,
          screenshotWidth: 2_000,
        },
      },
    });
    expect(invocation.input).toMatchObject({
      command: { kind: 'click', x: 1_000, y: 250 },
      observationId,
    });
  });

  it('freezes an immutable per-task catalog', () => {
    const registry = new RuntimeToolRegistry();
    const context = {
      activity: null,
      executionProfile: 'everyday' as const,
      taskId: randomUUID(),
      workspace: null,
    };
    const first = registry.freeze(context);
    const second = registry.freeze(context);
    expect(second.digest).toBe(first.digest);
    expect(second.tools).toEqual(first.tools);
  });
});
