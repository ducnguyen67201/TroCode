import { describe, expect, it } from 'vitest';

import { RuntimeToolRegistry } from './runtime-tool-registry';

describe('RuntimeToolRegistry', () => {
  it('advertises concrete runtime tools instead of inferred domains', () => {
    const registry = new RuntimeToolRegistry();

    expect(registry.list().map((tool) => tool.id)).toEqual([
      'browser.navigate',
      'desktop.control',
      'task.guidance',
    ]);
    expect(
      registry.supports({
        action: 'drag',
        toolId: 'desktop.control',
        operation: 'drag',
        description: 'Drag the audio clip onto the timeline.',
      }),
    ).toBe(true);
  });

  it('accepts a future music provider without changing intent classification', () => {
    const registry = new RuntimeToolRegistry([
      {
        id: 'music.generate',
        description: 'Generate an audio artifact through a configured provider.',
        operations: ['create_track'],
      },
    ]);

    expect(
      registry.supports({
        action: 'write_file',
        toolId: 'music.generate',
        operation: 'create_track',
        description: 'Generate a playable track.',
      }),
    ).toBe(true);
  });

  it('rejects duplicate IDs and does not advertise unavailable tools', () => {
    expect(
      () =>
        new RuntimeToolRegistry([
          { id: 'music.generate', description: 'One', operations: ['create'] },
          { id: 'music.generate', description: 'Two', operations: ['create'] },
        ]),
    ).toThrow('already registered');

    const registry = new RuntimeToolRegistry([
      {
        id: 'music.generate',
        description: 'Configured later.',
        operations: ['create_track'],
        available: () => false,
      },
    ]);
    expect(registry.list()).toEqual([]);
  });
});
