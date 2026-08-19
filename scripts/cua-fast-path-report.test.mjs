import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildFastPathReport,
  parsePerformanceLog,
} from './cua-fast-path-report.mjs';

function line(durationMs, route, screenshotAttached, status = 'confirmed') {
  return `[cua] performance ${JSON.stringify({
    durationMs,
    fallbackReason: route === 'desktop_vision' ? 'semantic_unavailable' : 'none',
    operation: route === 'desktop_vision' ? 'observe' : 'get_window_state',
    route,
    screenshotAttached,
    status,
  })}`;
}

describe('CUA fast-path report', () => {
  it('passes a materially faster, screenshot-free candidate', () => {
    const baseline = parsePerformanceLog(
      [line(100, 'desktop_vision', true), line(200, 'desktop_vision', true)].join('\n'),
    );
    const candidate = parsePerformanceLog(
      [
        line(50, 'window_accessibility', false),
        line(100, 'window_accessibility', false),
      ].join('\n'),
    );

    assert.equal(buildFastPathReport(baseline, candidate).passed, true);
  });

  it('rejects fields that could carry sensitive content', () => {
    assert.throws(
      () =>
        parsePerformanceLog(
          `${line(10, 'window_accessibility', false).slice(0, -1)},"windowTitle":"Private.py"}`,
        ),
      /disallowed CUA performance fields/u,
    );
  });
});
