import { describe, expect, it } from 'vitest';

import { lessonExecutionRoute } from './lesson-execution-policy';
import { lessonFixture } from '../main/knowledge/classroom-lesson.fixture';

describe('lesson execution ownership', () => {
  it.each([1, 2] as const)('normalizes version %s web work into the shared executor without rewriting the plan', (schemaVersion) => {
    const { plan } = lessonFixture('demonstrate');
    plan.schemaVersion = schemaVersion;
    const before = structuredClone(plan);
    for (const mode of ['open', 'explain', 'demonstrate', 'practice', 'help'] as const)
      expect(lessonExecutionRoute(plan, mode)).toBe('shared_agent');
    expect(lessonExecutionRoute(plan, 'check')).toBe('coach');
    expect(plan).toEqual(before);
  });
  it.each(['open', 'explain', 'demonstrate', 'practice', 'help'] as const)(
    'uses the same shared executor for desktop %s', (mode) => {
      expect(lessonExecutionRoute({ schemaVersion: 3 }, mode)).toBe('shared_agent');
    },
  );
  it.each([1, 2, 3] as const)('retains assessment semantics for version %s', (schemaVersion) => {
    expect(lessonExecutionRoute({ schemaVersion }, 'check')).toBe('coach');
  });
  it.each([1, 2] as const)('makes remaining version %s compatibility paths explicit', (schemaVersion) => {
    expect(lessonExecutionRoute({ schemaVersion }, 'open')).toBe('material_viewer');
    expect(lessonExecutionRoute({ schemaVersion }, 'practice')).toBe('material_viewer');
    expect(() => lessonExecutionRoute({ schemaVersion }, 'demonstrate')).toThrow('external material');
    expect(lessonExecutionRoute({ schemaVersion }, 'explain')).toBe('coach');
    expect(lessonExecutionRoute({ schemaVersion }, 'help')).toBe('coach');
  });
});
