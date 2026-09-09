import { expect, it } from 'vitest';

import { desktopLessonFixture } from '../knowledge/classroom-desktop-teaching.fixture';

import { normalizeLocalToolResult } from './local-tool-result';

it('retains observation evidence and reviewed tool context across the SDK boundary', () => {
  const f = desktopLessonFixture();
  const result = normalizeLocalToolResult({ status: 'confirmed', summary: 'Observed', observation: f.observation, data: { lesson: { instruction: 'Explain this example' } } });
  expect(result).toMatchObject({ status: 'completed', data: { lesson: { instruction: 'Explain this example' }, observation: { observationId: f.observation.observationId, fingerprint: f.observation.fingerprint, surface: f.observation.surface } } });
  expect(JSON.stringify(result.data)).not.toContain('processId');
});
