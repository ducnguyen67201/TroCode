import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCuaSemanticToolDefinitions } from './cua-semantic-agent-tools';
import { evaluateAction } from './policy';
import { RuntimeToolRegistry } from './runtime-tool-registry';
import { createTaskContract } from './task-contract';

const effectFree = {
  kind: 'none' as const,
  resourceKind: null,
  reversibility: 'none' as const,
  externality: 'local' as const,
  communication: 'none' as const,
  overwrite: 'none' as const,
  sensitiveDataTransfer: false as const,
};

const calendarCreate = {
  kind: 'create_resource' as const,
  resourceKind: 'calendar_event' as const,
  reversibility: 'reversible' as const,
  externality: 'cloud_private' as const,
  communication: 'none' as const,
  overwrite: 'none' as const,
  sensitiveDataTransfer: false as const,
};

function registry() {
  return new RuntimeToolRegistry(
    createCuaSemanticToolDefinitions({
      semanticAvailable: () => true,
      browserPrepareAvailable: () => true,
    }),
  );
}

const observation = {
  observationId: randomUUID(),
  taskId: randomUUID(),
  capturedAt: '2026-08-19T00:00:00.000Z',
  text: 'Run',
  route: 'window_accessibility' as const,
  surface: { kind: 'code_editor' as const, application: 'Code' },
  elements: [{ ref: 'e1', role: 'button', name: 'Run' }],
  degraded: false,
  fingerprint: 'a'.repeat(64),
};

describe('CUA semantic agent tools', () => {
  it('publishes strict curated tools without raw CUA methods', () => {
    const specs = registry().modelVisibleSpecs();
    expect(specs.map((spec) => spec.name)).toEqual([
      'observe_surface',
      'control_surface',
      'prepare_browser_access',
    ]);
    expect(specs.every((spec) => spec.strict)).toBe(true);
    expect(JSON.stringify(specs)).not.toContain('callTool');
  });

  it('normalizes a public element ref into bounded trusted risk cues', () => {
    const invocation = registry().resolve(
      {
        callId: 'call-1',
        name: 'control_surface',
        arguments: JSON.stringify({
          observationId: observation.observationId,
          description: 'Run the visible code.',
          target: 'Run',
          effect: effectFree,
          attendees: null,
          command: {
            kind: 'click_element',
            ref: 'e1',
            button: 'left',
            count: 1,
            consequence: 'click_element',
            sendPayload: null,
          },
        }),
      },
      { taskId: observation.taskId, latestObservation: observation },
    );
    expect(invocation).toMatchObject({
      kind: 'surface',
      toolId: 'computer.control',
      action: {
        action: 'click_element',
        parameters: {
          publicRef: 'e1',
          role: 'button',
          visibleText: 'Run',
          declaredConsequence: 'click_element',
        },
      },
    });
  });

  it('rejects stale observations and benign labels for sensitive commands', () => {
    expect(() =>
      registry().resolve(
        {
          callId: 'call-stale',
          name: 'control_surface',
          arguments: JSON.stringify({
            observationId: randomUUID(),
            description: 'Run.',
            target: null,
            effect: effectFree,
            attendees: null,
            command: {
              kind: 'click_element',
              ref: 'e1',
              button: 'left',
              count: 1,
              consequence: 'scroll',
              sendPayload: null,
            },
          }),
        },
        { taskId: observation.taskId, latestObservation: observation },
      ),
    ).toThrow();
  });

  it('forces browser preparation to a system permission action', () => {
    const browserObservation = {
      ...observation,
      surface: {
        kind: 'browser' as const,
        application: 'Chrome',
        deepAccess: 'available_requires_approval' as const,
      },
    };
    const invocation = registry().resolve(
      {
        callId: 'call-prepare',
        name: 'prepare_browser_access',
        arguments: JSON.stringify({
          observationId: observation.observationId,
          reason: 'Read the active editor accurately.',
        }),
      },
      { taskId: observation.taskId, latestObservation: browserObservation },
    );
    expect(invocation.action).toMatchObject({
      action: 'system_permission',
      toolId: 'browser.prepare',
    });
  });

  it('auto-authorizes one private calendar save and requires approval once attendees exist', () => {
    const tools = registry();
    const base = {
      observationId: observation.observationId,
      description: 'Save the private calendar event.',
      target: 'Save',
      command: {
        kind: 'click_element' as const,
        ref: 'e1',
        button: 'left' as const,
        count: 1,
        consequence: 'click_element' as const,
        sendPayload: null,
      },
    };
    const createInvocation = tools.resolve(
      {
        callId: 'calendar-create',
        name: 'control_surface',
        arguments: JSON.stringify({
          ...base,
          effect: calendarCreate,
          attendees: null,
        }),
      },
      { taskId: observation.taskId, latestObservation: observation },
    );
    expect(
      evaluateAction(
        createTaskContract('Create a calendar event.'),
        createInvocation.action!,
        tools,
      ),
    ).toMatchObject({
      status: 'allowed',
      authorizationSource: 'user_instruction',
      approvalRequired: false,
      consequential: true,
    });

    const inviteInvocation = tools.resolve(
      {
        callId: 'calendar-invite',
        name: 'control_surface',
        arguments: JSON.stringify({
          ...base,
          effect: {
            ...calendarCreate,
            kind: 'send_communication',
            communication: 'invite',
            externality: 'external',
          },
          attendees: ['teammate@example.test'],
        }),
      },
      { taskId: observation.taskId, latestObservation: observation },
    );
    expect(
      evaluateAction(
        createTaskContract('Create a calendar event with an attendee.'),
        inviteInvocation.action!,
        tools,
      ).status,
    ).toBe('needs_approval');
  });
});
