import { randomUUID } from 'node:crypto';

import type { DesktopObservation } from '../agent/execution-contracts';

import { lessonDigest } from './classroom-lesson-policy';
import { lessonStateFixture } from './classroom-lesson.fixture';

export function desktopLessonFixture() {
  const state = lessonStateFixture();
  const resource = { id: state.envelope.plan.resources[0]!.id, kind: 'source_text' as const, title: 'python.md', sourceVersionId: randomUUID() };
  state.envelope.plan.schemaVersion = 3;
  state.envelope.plan.resources = [resource];
  state.envelope.plan.steps[0]!.surface = { kind: 'resource_app', navigation: 'student' };
  state.envelope.planDigest = lessonDigest(state.envelope.plan);
  state.material = { resource, text: 'print("Hello")', chunks: [], nextOrdinal: null };
  state.effect = 'none';
  const observation: DesktopObservation = {
    observationId: randomUUID(), taskId: state.envelope.lessonId, capturedAt: new Date().toISOString(),
    fingerprint: 'a'.repeat(64), text: 'print("Hello")', degraded: false, route: 'window_accessibility',
    surface: { kind: 'native_app', application: 'TextEdit', title: 'python.md', bounds: { x: 100, y: 100, width: 800, height: 600 } },
    elements: [{ ref: 'e1', role: 'text area', name: 'Python example', value: 'print("Hello")', bounds: { x: 120, y: 150, width: 300, height: 200 } }],
  };
  return { state, resource, observation };
}
