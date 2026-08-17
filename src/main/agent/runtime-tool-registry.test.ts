import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RuntimeToolDefinition } from './runtime-tool-registry';
import { RuntimeToolRegistry } from './runtime-tool-registry';

describe('RuntimeToolRegistry', () => {
  it('advertises only concrete host-installed model tools', () => {
    const registry = new RuntimeToolRegistry();

    expect(registry.modelVisibleSpecs().map((tool) => tool.name)).toEqual([
      'observe_desktop',
      'control_desktop',
      'open_url',
      'show_guidance',
      'request_user_input',
    ]);
    expect(registry.modelVisibleSpecs().every((tool) => tool.strict)).toBe(true);
  });

  it('publishes explicitly typed discriminators in strict command variants', () => {
    const controlTool = new RuntimeToolRegistry()
      .modelVisibleSpecs()
      .find((tool) => tool.name === 'control_desktop');
    const properties = controlTool?.parameters.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    const variants = properties?.command?.anyOf as
      | Array<{ properties?: Record<string, unknown> }>
      | undefined;

    expect(variants).toHaveLength(5);
    expect(
      variants?.map((variant) => variant.properties?.kind),
    ).toEqual([
      { type: 'string', const: 'click' },
      { type: 'string', const: 'drag' },
      { type: 'string', const: 'type_text' },
      { type: 'string', const: 'keypress' },
      { type: 'string', const: 'scroll' },
    ]);
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
      parameters: { type: 'object' },
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
