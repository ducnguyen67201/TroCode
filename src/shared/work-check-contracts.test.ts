import { expect, it } from 'vitest';

import { workCheckFixture } from '../main/knowledge/work-check.fixture';

import {
  HostedAttemptContextSchema,
  WorkCheckProjectionSchema,
  WorkCheckReportSchema,
} from './contracts';

it('keeps older attempt responses compatible and rejects mismatched result phases or excessive payloads', () => {
  const f = workCheckFixture();
  expect(HostedAttemptContextSchema.parse(f.attempt).startedAt).toBeUndefined();
  expect(
    WorkCheckReportSchema.safeParse({ ...f.report, screenshot: 'raw' }).success,
  ).toBe(false);
  expect(
    WorkCheckProjectionSchema.safeParse({
      phase: 'failed',
      report: f.report,
      message: null,
    }).success,
  ).toBe(false);
  expect(
    WorkCheckReportSchema.safeParse({ ...f.report, summary: 'x'.repeat(1201) })
      .success,
  ).toBe(false);
});
