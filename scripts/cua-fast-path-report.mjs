import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const EVENT_PREFIX = '[cua] performance';
const ALLOWED_KEYS = new Set([
  'durationMs',
  'fallbackReason',
  'operation',
  'route',
  'screenshotAttached',
  'status',
]);
const ROUTES = new Set([
  'browser_semantic',
  'window_accessibility',
  'window_vision',
  'desktop_vision',
]);
const STATUSES = new Set(['confirmed', 'error', 'not_executed', 'unknown']);
const FALLBACK_REASONS = new Set([
  'none',
  'semantic_unavailable',
  'semantic_error',
  'screenshot_required',
]);

function validateEvent(value, lineNumber) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Line ${lineNumber}: CUA performance event must be an object.`);
  }
  const extraKeys = Object.keys(value).filter((key) => !ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    throw new Error(
      `Line ${lineNumber}: disallowed CUA performance fields: ${extraKeys.join(', ')}.`,
    );
  }
  if (!Number.isFinite(value.durationMs) || value.durationMs < 0) {
    throw new Error(`Line ${lineNumber}: durationMs must be non-negative.`);
  }
  if (typeof value.operation !== 'string' || value.operation.length > 100) {
    throw new Error(`Line ${lineNumber}: operation is invalid.`);
  }
  if (!ROUTES.has(value.route)) {
    throw new Error(`Line ${lineNumber}: route is invalid.`);
  }
  if (!STATUSES.has(value.status)) {
    throw new Error(`Line ${lineNumber}: status is invalid.`);
  }
  if (!FALLBACK_REASONS.has(value.fallbackReason)) {
    throw new Error(`Line ${lineNumber}: fallbackReason is invalid.`);
  }
  if (typeof value.screenshotAttached !== 'boolean') {
    throw new Error(`Line ${lineNumber}: screenshotAttached must be boolean.`);
  }
  return value;
}

export function parsePerformanceLog(contents) {
  const events = [];
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    const prefixIndex = line.indexOf(EVENT_PREFIX);
    if (prefixIndex < 0) continue;
    const jsonIndex = line.indexOf('{', prefixIndex + EVENT_PREFIX.length);
    if (jsonIndex < 0) {
      throw new Error(`Line ${index + 1}: missing CUA performance JSON.`);
    }
    let value;
    try {
      value = JSON.parse(line.slice(jsonIndex));
    } catch {
      throw new Error(`Line ${index + 1}: malformed CUA performance JSON.`);
    }
    events.push(validateEvent(value, index + 1));
  }
  if (events.length === 0) {
    throw new Error('No content-free CUA performance events were found.');
  }
  return events;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index];
}

function summarize(events) {
  const durations = events.map((event) => event.durationMs);
  const confirmed = events.filter((event) => event.status === 'confirmed').length;
  return {
    count: events.length,
    confirmedRate: confirmed / events.length,
    desktopVisionCount: events.filter(
      (event) => event.route === 'desktop_vision',
    ).length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    screenshotCount: events.filter((event) => event.screenshotAttached).length,
  };
}

function ratio(candidate, baseline) {
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return candidate / baseline;
}

export function buildFastPathReport(baselineEvents, candidateEvents) {
  const baseline = summarize(baselineEvents);
  const candidate = summarize(candidateEvents);
  const gates = {
    confirmedRate: candidate.confirmedRate >= baseline.confirmedRate - 0.02,
    desktopVision: candidate.desktopVisionCount <= baseline.desktopVisionCount * 0.25,
    p50Latency: ratio(candidate.p50Ms, baseline.p50Ms) <= 0.7,
    p95Latency: ratio(candidate.p95Ms, baseline.p95Ms) <= 0.8,
    screenshots: candidate.screenshotCount <= baseline.screenshotCount * 0.25,
  };
  return {
    baseline,
    candidate,
    gates,
    passed: Object.values(gates).every(Boolean),
  };
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') {
      result.json = true;
    } else if (value === '--baseline' || value === '--candidate') {
      const path = argv[index + 1];
      if (!path) throw new Error(`${value} requires a file path.`);
      result[value.slice(2)] = path;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!result.baseline || !result.candidate) {
    throw new Error('Usage: npm run cua:report -- --baseline <log> --candidate <log> [--json]');
  }
  return result;
}

function markdown(report) {
  const row = (label, baseline, candidate, gate = '') =>
    `| ${label} | ${baseline} | ${candidate} | ${gate} |`;
  return [
    '# CUA semantic fast-path report',
    '',
    '| Metric | Baseline | Candidate | Gate |',
    '|---|---:|---:|:---:|',
    row('p50 operation latency (ms)', report.baseline.p50Ms, report.candidate.p50Ms, report.gates.p50Latency ? 'pass' : 'fail'),
    row('p95 operation latency (ms)', report.baseline.p95Ms, report.candidate.p95Ms, report.gates.p95Latency ? 'pass' : 'fail'),
    row('Screenshot-bearing operations', report.baseline.screenshotCount, report.candidate.screenshotCount, report.gates.screenshots ? 'pass' : 'fail'),
    row('Desktop-vision operations', report.baseline.desktopVisionCount, report.candidate.desktopVisionCount, report.gates.desktopVision ? 'pass' : 'fail'),
    row('Confirmed rate', report.baseline.confirmedRate.toFixed(3), report.candidate.confirmedRate.toFixed(3), report.gates.confirmedRate ? 'pass' : 'fail'),
    '',
    `Overall: ${report.passed ? 'PASS' : 'FAIL'}`,
  ].join('\n');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const [baselineContents, candidateContents] = await Promise.all([
    readFile(args.baseline, 'utf8'),
    readFile(args.candidate, 'utf8'),
  ]);
  const report = buildFastPathReport(
    parsePerformanceLog(baselineContents),
    parsePerformanceLog(candidateContents),
  );
  process.stdout.write(`${args.json ? JSON.stringify(report, null, 2) : markdown(report)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
