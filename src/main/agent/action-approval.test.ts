import { describe, expect, it } from 'vitest';

import { createActionDigest } from './action-approval';

describe('action approval digest', () => {
  it('is stable across parameter key ordering', () => {
    const first = createActionDigest({
      action: 'send',
      capability: 'email',
      description: 'Send an email.',
      parameters: {
        body: 'Hello',
        recipients: ['alex@example.com'],
      },
    });
    const second = createActionDigest({
      action: 'send',
      capability: 'email',
      description: 'Send an email.',
      parameters: {
        recipients: ['alex@example.com'],
        body: 'Hello',
      },
    });

    expect(first).toBe(second);
  });

  it('changes when a consequential field changes', () => {
    const first = createActionDigest({
      action: 'send',
      capability: 'email',
      description: 'Send an email.',
      parameters: { recipients: ['alex@example.com'] },
    });
    const second = createActionDigest({
      action: 'send',
      capability: 'email',
      description: 'Send an email.',
      parameters: { recipients: ['sam@example.com'] },
    });

    expect(first).not.toBe(second);
  });

  it('binds approval to the exact runtime tool and operation', () => {
    const base = {
      action: 'write_file' as const,
      description: 'Create an audio artifact.',
      operation: 'create_track',
      toolId: 'music.generate',
    };

    expect(createActionDigest(base)).not.toBe(
      createActionDigest({ ...base, toolId: 'desktop.control' }),
    );
    expect(createActionDigest(base)).not.toBe(
      createActionDigest({ ...base, operation: 'overwrite_track' }),
    );
  });

  it('binds desktop approval to coordinates and observation evidence', () => {
    const base = {
      action: 'delete' as const,
      description: 'Delete the selected email.',
      operation: 'click',
      toolId: 'desktop.control',
      parameters: {
        command: 'click',
        x: '100',
        y: '200',
        observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        observationFingerprint: 'a'.repeat(64),
      },
    };

    expect(createActionDigest(base)).not.toBe(
      createActionDigest({
        ...base,
        parameters: { ...base.parameters, x: '101' },
      }),
    );
    expect(createActionDigest(base)).not.toBe(
      createActionDigest({
        ...base,
        parameters: {
          ...base.parameters,
          observationFingerprint: 'b'.repeat(64),
        },
      }),
    );
  });

  it('binds approval to the typed effect and current intent revision', () => {
    const base = {
      action: 'click_element' as const,
      description: 'Save the calendar event.',
      operation: 'click_element',
      toolId: 'computer.control',
      effect: {
        kind: 'create_resource' as const,
        resourceKind: 'calendar_event' as const,
        reversibility: 'reversible' as const,
        externality: 'cloud_private' as const,
        communication: 'none' as const,
        overwrite: 'none' as const,
        sensitiveDataTransfer: false as const,
      },
    };
    expect(createActionDigest(base, 1)).not.toBe(createActionDigest(base, 2));
    expect(createActionDigest(base, 1)).not.toBe(
      createActionDigest({
        ...base,
        effect: {
          ...base.effect,
          kind: 'send_communication',
          communication: 'invite',
          externality: 'external',
        },
      }, 1),
    );
  });

  it('rejects an unbounded action payload', () => {
    const parameters = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`field-${index}`, 'value']),
    );

    expect(() =>
      createActionDigest({
        action: 'send',
        capability: 'email',
        description: 'Send an email.',
        parameters,
      }),
    ).toThrow('more than 64 parameters');
  });
});
