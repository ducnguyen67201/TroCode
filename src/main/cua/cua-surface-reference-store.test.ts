import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CuaSurfaceReferenceStore,
  type CuaSurfaceBinding,
} from './cua-surface-reference-store';

function binding(taskId: string, observationId: string): CuaSurfaceBinding {
  return {
    observationId,
    observationFingerprint: 'observation-fingerprint',
    processId: 42,
    references: new Map([
      [
        'e1',
        {
          publicElement: { ref: 'e1', role: 'button', name: 'Run' },
          raw: {
            kind: 'window',
            elementIndex: 7,
            elementToken: 'secret-token',
            snapshotId: 's12345678',
          },
          semanticFingerprint: 'run-fingerprint',
        },
      ],
    ]),
    route: 'window_accessibility',
    surface: { kind: 'code_editor', application: 'Code' },
    surfaceIdentityHash: 'surface-fingerprint',
    taskId,
    windowId: 9,
  };
}

describe('CuaSurfaceReferenceStore', () => {
  it('keeps only the latest observation per task', () => {
    const taskId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const store = new CuaSurfaceReferenceStore();
    store.replace(binding(taskId, first));
    store.replace(binding(taskId, second));

    expect(() => store.require(taskId, first)).toThrow('stale');
    expect(store.resolve(taskId, second, 'e1').raw).toMatchObject({
      kind: 'window',
      elementToken: 'secret-token',
    });
  });

  it('rebinds only one exact semantic fingerprint', () => {
    const taskId = randomUUID();
    const next = binding(taskId, randomUUID());
    const store = new CuaSurfaceReferenceStore();
    expect(store.findUniqueMatch(next, 'run-fingerprint')?.publicElement.ref).toBe(
      'e1',
    );
    next.references.set('e2', {
      ...next.references.get('e1')!,
      publicElement: { ref: 'e2', role: 'button', name: 'Run' },
    });
    expect(store.findUniqueMatch(next, 'run-fingerprint')).toBeUndefined();
  });

  it('clears private references at task end', () => {
    const taskId = randomUUID();
    const store = new CuaSurfaceReferenceStore();
    store.replace(binding(taskId, randomUUID()));
    store.clearTask(taskId);
    expect(store.current(taskId)).toBeUndefined();
  });
});
