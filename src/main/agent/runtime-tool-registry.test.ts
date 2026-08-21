import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RuntimeToolDefinition } from './runtime-tool-registry';
import { RuntimeToolRegistry } from './runtime-tool-registry';

function activityGoal(insightPolicy: 'explicit_and_operational' | 'evidence_candidates') {
  return {
    schemaVersion: 6 as const,
    id: randomUUID(),
    originalRequest: 'Help with the Activity',
    runtimeKind: 'openai_agents' as const,
    executionProfile: 'everyday' as const,
    autonomyMode: 'balanced' as const,
    workspace: null,
    activity: {
      attemptId: randomUUID(), workSessionId: randomUUID(), activityVersionId: randomUUID(), runId: randomUUID(),
      space: { id: randomUUID(), name: 'Incident response' },
      activity: {
        title: 'Triage drill', objective: 'Find the fault', instructions: 'Inspect safely.', launchTarget: 'none' as const,
        guidancePolicy: { answerReveal: 'allowed' as const, hintMode: 'direct' as const, maxHintLevel: 3 },
        criteria: [{ id: 'triage', title: 'Triage', description: '', tags: ['logs'] }],
        completionPolicy: { requiresSubmission: false, requiresFacilitatorConfirmation: false },
      },
      insightPolicy,
      insightPolicyVersion: '1', policyAcknowledged: insightPolicy === 'evidence_candidates',
      sourceCatalog: [{ title: 'Runbook', role: 'reference' as const }],
      priorProgress: { completedCriterionIds: [], sessionCount: 0, summary: 'No prior Work Sessions.' },
    },
    approvalPolicy: { alwaysConfirm: [] },
    limits: { maxImages: 20, maxMicroUsd: 500_000, maxMinutes: 10, maxModelSamples: 40, maxToolCalls: 30 },
  };
}

describe('RuntimeToolRegistry', () => {
  it('advertises only concrete host-installed model tools', () => {
    const registry = new RuntimeToolRegistry();

    expect(registry.modelVisibleSpecs().map((tool) => tool.name)).toEqual([
      'observe_desktop',
      'control_desktop',
      'open_url',
      'open_application',
      'show_guidance',
      'request_user_input',
    ]);
    expect(registry.modelVisibleSpecs().every((tool) => tool.strict)).toBe(true);
  });

  it('exposes knowledge and evidence tools only for the trusted Activity policy', () => {
    const registry = new RuntimeToolRegistry();
    const normal = registry.modelVisibleSpecs({ taskId: randomUUID() }).map((tool) => tool.name);
    const explicit = registry.modelVisibleSpecs({ goal: activityGoal('explicit_and_operational'), taskId: randomUUID() }).map((tool) => tool.name);
    const evidence = registry.modelVisibleSpecs({ goal: activityGoal('evidence_candidates'), taskId: randomUUID() }).map((tool) => tool.name);
    expect(normal).not.toContain('search_activity_knowledge');
    expect(normal).not.toContain('record_activity_signal');
    expect(explicit).toContain('search_activity_knowledge');
    expect(explicit).not.toContain('record_activity_signal');
    expect(evidence).toContain('search_activity_knowledge');
    expect(evidence).toContain('record_activity_signal');
  });

  it('bounds each narrated guidance step to one concise 240-character instruction', () => {
    const guidance = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'show_guidance');
    const properties = guidance?.parameters.properties as
      | Record<string, Record<string, unknown>>
      | undefined;

    expect(properties?.description?.maxLength).toBe(240);
    expect(guidance?.description).toContain('exactly one visible target');
    expect(guidance?.description).toContain('playback controls');
    expect(guidance?.description).toContain('highlight');
  });

  it('publishes a strict nullable target region for spatial guidance', () => {
    const guidance = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'show_guidance');
    const region = guidance?.parameters.properties.region as
      | {
          anyOf?: Array<{
            additionalProperties?: boolean;
            properties?: Record<string, Record<string, unknown>>;
            required?: string[];
            type?: string;
          }>;
        }
      | undefined;

    expect(guidance?.parameters.required).toContain('region');
    expect(region?.anyOf?.[0]).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
    });
    expect(region?.anyOf?.[1]).toEqual({ type: 'null' });
  });

  it('defines every visual coordinate in one explicit normalized image space', () => {
    const tools = new RuntimeToolRegistry().modelVisibleSpecs();
    const guidance = tools.find((tool) => tool.name === 'show_guidance');
    const control = tools.find((tool) => tool.name === 'control_desktop');
    const coordinateDescription =
      'Normalized image coordinate from 0 to 1000; do not use screenshot pixels.';
    const guidanceProperties = guidance?.parameters.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    const guidanceRegion = guidanceProperties?.region as
      | {
          anyOf?: Array<{
            properties?: Record<string, Record<string, unknown>>;
          }>;
        }
      | undefined;
    const controlVariants = (
      control?.parameters.properties.command as {
        anyOf?: Array<{
          properties?: Record<string, Record<string, unknown>>;
        }>;
      }
    ).anyOf;

    expect(guidance?.description).toContain('normalized 0-1000 image space');
    expect(control?.description).toContain('normalized 0-1000 image space');
    expect(guidanceProperties?.x?.description).toBe(coordinateDescription);
    expect(guidanceProperties?.y?.description).toBe(coordinateDescription);
    for (const axis of ['x', 'y', 'width', 'height']) {
      expect(guidanceRegion?.anyOf?.[0]?.properties?.[axis]?.description).toBe(
        coordinateDescription,
      );
    }
    for (const variant of controlVariants ?? []) {
      const properties = variant.properties ?? {};
      for (const axis of ['x', 'y', 'fromX', 'fromY', 'toX', 'toY']) {
        if (properties[axis]) {
          expect(properties[axis]?.description).toBe(coordinateDescription);
        }
      }
    }
  });

  it('publishes provider-compatible strict command variants that correlate consequences', () => {
    const controlTool = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'control_desktop');
    const variants = (
      controlTool?.parameters.properties.command as {
        anyOf?: Array<{
          properties?: Record<
            string,
            {
              const?: string;
              enum?: string[];
              properties?: Record<string, unknown>;
            }
          >;
        }>;
      }
    ).anyOf;
    const kindFor = (variant: NonNullable<typeof variants>[number]) =>
      variant.properties?.kind as
        | { const?: string; type?: string }
        | undefined;

    expect(variants).toHaveLength(9);
    expect(
      (controlTool?.parameters as unknown as { anyOf?: unknown[] }).anyOf,
    ).toBeUndefined();
    expect(controlTool?.parameters.required).toEqual(
      expect.arrayContaining(['effect', 'attendees']),
    );
    expect(variants?.map(kindFor)).toEqual([
      { type: 'string', const: 'click' },
      { type: 'string', const: 'click' },
      { type: 'string', const: 'drag' },
      { type: 'string', const: 'type_text' },
      { type: 'string', const: 'type_text' },
      { type: 'string', const: 'paste_table' },
      { type: 'string', const: 'keypress' },
      { type: 'string', const: 'keypress' },
      { type: 'string', const: 'scroll' },
    ]);

    const consequencesFor = (kind: string) =>
      variants
        ?.filter((variant) => kindFor(variant)?.const === kind)
        .flatMap((variant) => {
          const consequence = variant.properties?.consequence;
          return consequence?.const
            ? [consequence.const]
            : (consequence?.enum ?? []);
        });
    const clickConsequences = consequencesFor('click');
    expect(clickConsequences).toEqual(
      expect.arrayContaining([
        'click_element',
        'login',
        'send',
        'submit',
        'upload',
        'download',
        'delete',
        'purchase',
        'install',
        'run_command',
        'write_file',
      ]),
    );
    expect(clickConsequences).not.toContain('guide');
    expect(consequencesFor('type_text')).toEqual(
      expect.arrayContaining(['type_text', 'login', 'send', 'submit', 'upload']),
    );
    expect(consequencesFor('paste_table')).toEqual(['type_text']);
    expect(consequencesFor('keypress')).toEqual(
      expect.arrayContaining(['press_key', 'login', 'send', 'submit', 'delete']),
    );
    expect(consequencesFor('drag')).toEqual(['drag']);
    expect(consequencesFor('scroll')).toEqual(['scroll']);
    for (const variant of variants ?? []) {
      if (variant.properties?.consequence?.const === 'send') continue;
      expect(variant.properties?.sendPayload).toEqual({ type: 'null' });
    }
  });

  it('requires exact send payload fields in every structural send variant', () => {
    const controlTool = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'control_desktop');
    const variants = (
      controlTool?.parameters.properties.command as {
        anyOf?: Array<{
          properties?: Record<string, Record<string, unknown>>;
          required?: string[];
        }>;
      }
    ).anyOf;
    const sendVariants = variants?.filter(
      (variant) => variant.properties?.consequence?.const === 'send',
    );

    expect(sendVariants).toHaveLength(3);
    for (const variant of sendVariants ?? []) {
      expect(variant.required).toContain('sendPayload');
      expect(variant.properties?.sendPayload).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: [
          'account',
          'recipients',
          'subject',
          'body',
          'threadId',
          'attachments',
        ],
      });
    }
  });

  it('keeps show_guidance separate from desktop control variants', () => {
    const guidance = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'show_guidance');

    expect(
      (guidance?.parameters as unknown as { anyOf?: unknown[] }).anyOf,
    ).toBeUndefined();
    expect(guidance?.parameters.properties).toHaveProperty('observationId');
  });

  it('normalizes a bounded guidance region with the authoritative observation', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();
    const invocation = registry.resolve(
      {
        callId: 'call-region-guide',
        name: 'show_guidance',
        arguments: JSON.stringify({
          observationId,
          description: 'Notice the time marker before choosing the tense.',
          target: 'Question one',
          x: 500,
          y: 200,
          region: { x: 250, y: 100, width: 500, height: 300 },
        }),
      },
      {
        taskId,
        latestObservation: {
          observationId,
          taskId,
          capturedAt: '2026-08-17T00:00:00.000Z',
          route: 'desktop_vision',
          text: 'A worksheet is visible.',
          degraded: false,
          fingerprint: 'a'.repeat(64),
          coordinateSpace: {
            screenHeight: 500,
            screenWidth: 1000,
            screenshotHeight: 1000,
            screenshotWidth: 2000,
          },
        },
      },
    );

    expect(invocation.input).toMatchObject({
      x: 1000,
      y: 200,
      region: { x: 500, y: 100, width: 1000, height: 300 },
    });
  });

  it('rejects guidance regions that do not contain the target point', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();

    expect(() =>
      registry.preview(
        {
          callId: 'call-invalid-region-guide',
          name: 'show_guidance',
          arguments: JSON.stringify({
            observationId,
            description: 'Look here.',
            target: 'Question one',
            x: 900,
            y: 900,
            region: { x: 100, y: 100, width: 200, height: 200 },
          }),
        },
        {
          taskId,
          latestObservation: {
            observationId,
            taskId,
            capturedAt: '2026-08-17T00:00:00.000Z',
            route: 'desktop_vision',
            text: 'A worksheet is visible.',
            degraded: false,
            fingerprint: 'a'.repeat(64),
            coordinateSpace: {
              screenHeight: 500,
              screenWidth: 1000,
              screenshotHeight: 1000,
              screenshotWidth: 2000,
            },
          },
        },
      ),
    ).toThrow('contain the guidance point');
  });

  it('retains the trusted parser defense for invalid command/consequence pairs', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();

    expect(() =>
      registry.preview(
        {
          callId: 'call-invalid-guide-click',
          name: 'control_desktop',
          arguments: JSON.stringify({
            observationId,
            consequence: 'guide',
            description: 'Invalidly mix guidance with a click.',
            target: null,
            sendPayload: null,
            command: {
              kind: 'click',
              x: 500,
              y: 250,
              button: 'left',
              count: 1,
            },
          }),
        },
        {
          taskId,
          latestObservation: {
            observationId,
            taskId,
            capturedAt: '2026-08-17T00:00:00.000Z',
            route: 'desktop_vision',
            text: 'A button is visible.',
            degraded: false,
            fingerprint: 'a'.repeat(64),
            coordinateSpace: {
              screenHeight: 500,
              screenWidth: 1000,
              screenshotHeight: 1000,
              screenshotWidth: 2000,
            },
          },
        },
      ),
    ).toThrow('desktop command and declared consequence do not agree');
  });

  it('normalizes the nested model command shape to the existing trusted input', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();
    const invocation = registry.resolve(
      {
        callId: 'call-nested-click',
        name: 'control_desktop',
        arguments: JSON.stringify({
          observationId,
          description: 'Click the visible button.',
          target: null,
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
            consequence: 'click_element',
            sendPayload: null,
          },
        }),
      },
      {
        taskId,
        latestObservation: {
          observationId,
          taskId,
          capturedAt: '2026-08-17T00:00:00.000Z',
          route: 'desktop_vision',
          text: 'A button is visible.',
          degraded: false,
          fingerprint: 'a'.repeat(64),
          coordinateSpace: {
            screenHeight: 500,
            screenWidth: 1000,
            screenshotHeight: 1000,
            screenshotWidth: 2000,
          },
        },
      },
    );

    expect(invocation.input).toMatchObject({
      consequence: 'click_element',
      command: { kind: 'click' },
    });
    expect(invocation.action).toMatchObject({
      action: 'click_element',
      operation: 'click',
    });
  });

  it('retains an explicit coordinate-lane effect for consequence and retry policy', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();
    const invocation = registry.resolve(
      {
        callId: 'call-calendar-save',
        name: 'control_desktop',
        arguments: JSON.stringify({
          observationId,
          description: 'Save the private calendar event.',
          target: 'Save',
          effect: {
            kind: 'create_resource',
            resourceKind: 'calendar_event',
            reversibility: 'reversible',
            externality: 'cloud_private',
            communication: 'none',
            overwrite: 'none',
            sensitiveDataTransfer: false,
          },
          attendees: null,
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
            consequence: 'click_element',
            sendPayload: null,
          },
        }),
      },
      {
        taskId,
        latestObservation: {
          observationId,
          taskId,
          capturedAt: '2026-08-21T00:00:00.000Z',
          route: 'desktop_vision',
          text: 'A calendar Save button is visible.',
          degraded: false,
          fingerprint: 'a'.repeat(64),
          coordinateSpace: {
            screenHeight: 500,
            screenWidth: 1000,
            screenshotHeight: 1000,
            screenshotWidth: 2000,
          },
        },
      },
    );

    expect(invocation.action?.effect).toMatchObject({
      kind: 'create_resource',
      resourceKind: 'calendar_event',
    });
  });

  it('normalizes a spreadsheet table to a bounded type-text action', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();
    const invocation = registry.resolve(
      {
        callId: 'call-paste-table',
        name: 'control_desktop',
        arguments: JSON.stringify({
          observationId,
          description: 'Fill the selected worksheet with an expense tracker.',
          target: 'Selected worksheet cell',
          command: {
            kind: 'paste_table',
            rows: [
              ['Ngày', 'Danh mục', 'Số tiền (VND)'],
              ['18/08/2026', 'Ăn uống', '50000'],
            ],
            consequence: 'type_text',
            sendPayload: null,
          },
        }),
      },
      {
        taskId,
        latestObservation: {
          observationId,
          taskId,
          capturedAt: '2026-08-18T00:00:00.000Z',
          route: 'desktop_vision',
          text: 'A worksheet cell is selected.',
          degraded: false,
          fingerprint: 'a'.repeat(64),
          coordinateSpace: {
            screenHeight: 500,
            screenWidth: 1000,
            screenshotHeight: 1000,
            screenshotWidth: 2000,
          },
        },
      },
    );

    expect(invocation).toMatchObject({
      kind: 'desktop',
      operation: 'paste_table',
      action: {
        action: 'type_text',
        operation: 'paste_table',
        parameters: {
          columnCount: '3',
          rowCount: '2',
          text: 'Ngày\tDanh mục\tSố tiền (VND)\n18/08/2026\tĂn uống\t50000',
        },
      },
      input: {
        command: { kind: 'paste_table' },
      },
    });
  });

  it('rejects invalid strict schemas locally before they reach the provider', () => {
    const invalidTool: RuntimeToolDefinition = {
      id: 'music.generate',
      modelName: 'generate_music',
      description: 'Invalid test tool.',
      operations: ['create_track'],
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { kind: { const: 'track' } },
        required: ['kind'],
      },
      parse: () => ({}),
      normalize: (_input, call) => ({
        callId: call.callId,
        input: {},
        kind: 'direct',
        modelName: call.name,
        operation: 'create_track',
        toolId: 'music.generate',
      }),
    };

    expect(() =>
      new RuntimeToolRegistry([invalidTool]).modelVisibleSpecs(),
    ).toThrow('uses const without an explicit type');
  });

  it('supplies trusted tool identity while parsing model arguments', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const invocation = registry.resolve(
      {
        callId: 'call-open',
        name: 'open_url',
        arguments: JSON.stringify({
          url: 'https://mail.google.com/',
          reason: 'Open Gmail.',
        }),
      },
      { taskId },
    );

    expect(invocation).toMatchObject({
      callId: 'call-open',
      toolId: 'browser.navigate',
      operation: 'open_url',
      kind: 'direct',
    });
    expect(invocation.action).toMatchObject({
      toolId: 'browser.navigate',
      operation: 'open_url',
    });
    expect(() =>
      registry.resolve(
        {
          callId: 'call-open',
          name: 'open_url',
          arguments: JSON.stringify({
            url: 'https://example.com/',
            reason: 'Try again.',
          }),
        },
        { taskId },
      ),
    ).toThrow('already resolved');
  });

  it('normalizes Chrome launch as a narrow direct host action', () => {
    const registry = new RuntimeToolRegistry();
    const invocation = registry.resolve(
      {
        callId: 'call-open-chrome',
        name: 'open_application',
        arguments: JSON.stringify({
          application: 'chrome',
          reason: 'Open Google Chrome.',
        }),
      },
      { taskId: randomUUID() },
    );

    expect(invocation).toMatchObject({
      callId: 'call-open-chrome',
      input: { application: 'chrome' },
      kind: 'direct',
      operation: 'launch',
      toolId: 'application.launch',
    });
    expect(invocation.action).toMatchObject({
      action: 'open_application',
      target: 'chrome',
      operation: 'launch',
      toolId: 'application.launch',
    });
  });

  it('requires the latest observation for normalized desktop control', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    expect(() =>
      registry.resolve(
        {
          callId: 'call-click',
          name: 'control_desktop',
          arguments: JSON.stringify({
            observationId: randomUUID(),
            consequence: 'click_element',
            description: 'Open the newest email.',
            command: {
              kind: 'click',
              x: 500,
              y: 250,
              button: 'left',
              count: 1,
            },
          }),
        },
        { taskId },
      ),
    ).toThrow('Observe the desktop');
  });

  it('derives desktop action identity from the trusted command', () => {
    const registry = new RuntimeToolRegistry();
    const taskId = randomUUID();
    const observationId = randomUUID();
    const invocation = registry.resolve(
      {
        callId: 'call-delete',
        name: 'control_desktop',
        arguments: JSON.stringify({
          observationId,
          consequence: 'delete',
          description: 'Click the visible delete button.',
          target: 'Delete button',
          command: {
            kind: 'click',
            x: 500,
            y: 250,
            button: 'left',
            count: 1,
          },
        }),
      },
      {
        taskId,
        latestObservation: {
          observationId,
          taskId,
          capturedAt: '2026-08-17T00:00:00.000Z',
          route: 'desktop_vision',
          text: 'A delete button is visible.',
          degraded: false,
          fingerprint: 'a'.repeat(64),
          coordinateSpace: {
            screenHeight: 500,
            screenWidth: 1000,
            screenshotHeight: 1000,
            screenshotWidth: 2000,
          },
        },
      },
    );

    expect(invocation.action).toMatchObject({
      action: 'click_element',
      toolId: 'desktop.control',
      operation: 'click',
      parameters: { declaredConsequence: 'delete' },
    });
  });

  it('can register an optional music provider without changing the agent', () => {
    const musicTool: RuntimeToolDefinition<{ prompt: string }> = {
      id: 'music.generate',
      modelName: 'generate_music',
      description: 'Generate a music track through a configured provider.',
      operations: ['create_track'],
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
      },
      parse: (argumentsJson) => JSON.parse(argumentsJson) as { prompt: string },
      normalize: (input, call) => ({
        action: {
          action: 'write_file',
          description: 'Generate a playable music track.',
          toolId: 'music.generate',
          operation: 'create_track',
        },
        callId: call.callId,
        input,
        kind: 'direct',
        modelName: call.name,
        operation: 'create_track',
        toolId: 'music.generate',
      }),
    };
    const registry = new RuntimeToolRegistry([musicTool]);

    expect(registry.modelVisibleSpecs()[0]?.name).toBe('generate_music');
    expect(
      registry.supports({
        action: 'write_file',
        description: 'Generate a playable music track.',
        toolId: 'music.generate',
        operation: 'create_track',
      }),
    ).toBe(true);
  });

  it('hides unavailable tools and rejects duplicate model names', () => {
    const unavailable: RuntimeToolDefinition = {
      id: 'music.generate',
      modelName: 'generate_music',
      description: 'Configured later.',
      operations: ['create_track'],
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: [],
      },
      available: () => false,
      parse: () => ({}),
      normalize: (_input, call) => ({
        callId: call.callId,
        input: {},
        kind: 'direct',
        modelName: call.name,
        operation: 'create_track',
        toolId: 'music.generate',
      }),
    };
    expect(new RuntimeToolRegistry([unavailable]).modelVisibleSpecs()).toEqual([]);
    expect(
      () =>
        new RuntimeToolRegistry([
          unavailable,
          { ...unavailable, id: 'music.render' },
        ]),
    ).toThrow('already registered');
  });
});
