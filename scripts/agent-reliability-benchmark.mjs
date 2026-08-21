import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarizeReliability(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('A reliability run must contain at least one scenario result.');
  }
  const count = results.length;
  const verified = results.filter((result) => result.verified === true).length;
  const falseCompletions = results.filter(
    (result) => result.completed === true && result.verified !== true,
  ).length;
  const recovered = results.filter((result) => result.faultInjected && result.recovered).length;
  const faulted = results.filter((result) => result.faultInjected).length;
  const durations = results.map((result) => Number(result.durationMs));
  const totalApprovals = results.reduce(
    (sum, result) => sum + Number(result.approvalCount ?? 0),
    0,
  );
  const unnecessaryApprovals = results.reduce(
    (sum, result) => sum + Number(result.unnecessaryApprovals ?? 0),
    0,
  );
  const plannedInterventions = results.filter(
    (result) => result.plannedUserIntervention === true,
  ).length;
  const unplannedInterventions = results.filter(
    (result) => result.unplannedUserIntervention === true,
  ).length;
  return {
    count,
    approvalsPerVerifiedSuccess: verified === 0
      ? Number.POSITIVE_INFINITY
      : totalApprovals / verified,
    costPerVerifiedSuccessMicroUsd: verified === 0
      ? Number.POSITIVE_INFINITY
      : Math.ceil(results.reduce((sum, result) => sum + Number(result.costMicroUsd), 0) / verified),
    duplicateConsequentialActionCount: results.reduce(
      (sum, result) => sum + Number(result.duplicateConsequentialActions ?? 0),
      0,
    ),
    falseCompletionRate: falseCompletions / count,
    hardConfirmBypassCount: results.reduce(
      (sum, result) => sum + Number(result.hardConfirmBypasses ?? 0),
      0,
    ),
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    recoveryRate: faulted === 0 ? 1 : recovered / faulted,
    plannedUserInterventionRate: plannedInterventions / count,
    totalApprovals,
    unnecessaryApprovalRate:
      totalApprovals === 0 ? 0 : unnecessaryApprovals / totalApprovals,
    unnecessaryApprovals,
    unplannedUserInterventionRate: unplannedInterventions / count,
    userInterventionRate: (plannedInterventions + unplannedInterventions) / count,
    verifiedCompletionRate: verified / count,
  };
}

export function buildReliabilityReport(baselineResults, candidateResults) {
  const baseline = summarizeReliability(baselineResults);
  const candidate = summarizeReliability(candidateResults);
  const gates = {
    duplicateConsequentialActions: candidate.duplicateConsequentialActionCount === 0,
    falseCompletions: candidate.falseCompletionRate === 0,
    hardConfirmBypasses: candidate.hardConfirmBypassCount === 0,
    recovery: candidate.recoveryRate >= Math.max(0.95, baseline.recoveryRate),
    userIntervention:
      candidate.userInterventionRate <= baseline.userInterventionRate + 0.02,
    unnecessaryApprovals:
      baseline.unnecessaryApprovalRate === 0
        ? candidate.unnecessaryApprovalRate === 0
        : candidate.unnecessaryApprovalRate <= baseline.unnecessaryApprovalRate * 0.8,
    verifiedCompletion:
      candidate.verifiedCompletionRate >= Math.max(0.9, baseline.verifiedCompletionRate),
  };
  return { baseline, candidate, gates, passed: Object.values(gates).every(Boolean) };
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--json') args.json = true;
    else if (name === '--baseline' || name === '--candidate') {
      args[name.slice(2)] = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown argument: ${name}`);
  }
  if (!args.baseline || !args.candidate) {
    throw new Error('Usage: npm run agent:benchmark -- --baseline <json> --candidate <json> [--json]');
  }
  return args;
}

function markdown(report) {
  return [
    '# Agent reliability benchmark',
    '',
    '| Metric | Baseline | Candidate |',
    '|---|---:|---:|',
    `| Verified completion rate | ${report.baseline.verifiedCompletionRate.toFixed(3)} | ${report.candidate.verifiedCompletionRate.toFixed(3)} |`,
    `| False completion rate | ${report.baseline.falseCompletionRate.toFixed(3)} | ${report.candidate.falseCompletionRate.toFixed(3)} |`,
    `| Recovery rate | ${report.baseline.recoveryRate.toFixed(3)} | ${report.candidate.recoveryRate.toFixed(3)} |`,
    `| Duplicate consequential actions | ${report.baseline.duplicateConsequentialActionCount} | ${report.candidate.duplicateConsequentialActionCount} |`,
    `| Hard-confirm bypasses | ${report.baseline.hardConfirmBypassCount} | ${report.candidate.hardConfirmBypassCount} |`,
    `| Total approvals | ${report.baseline.totalApprovals} | ${report.candidate.totalApprovals} |`,
    `| Approvals / verified success | ${report.baseline.approvalsPerVerifiedSuccess} | ${report.candidate.approvalsPerVerifiedSuccess} |`,
    `| Unnecessary approval rate | ${report.baseline.unnecessaryApprovalRate.toFixed(3)} | ${report.candidate.unnecessaryApprovalRate.toFixed(3)} |`,
    `| Planned intervention rate | ${report.baseline.plannedUserInterventionRate.toFixed(3)} | ${report.candidate.plannedUserInterventionRate.toFixed(3)} |`,
    `| Unplanned intervention rate | ${report.baseline.unplannedUserInterventionRate.toFixed(3)} | ${report.candidate.unplannedUserInterventionRate.toFixed(3)} |`,
    `| Cost / verified success (micro-USD) | ${report.baseline.costPerVerifiedSuccessMicroUsd} | ${report.candidate.costPerVerifiedSuccessMicroUsd} |`,
    `| p95 duration (ms) | ${report.baseline.p95DurationMs} | ${report.candidate.p95DurationMs} |`,
    '',
    `Overall: ${report.passed ? 'PASS' : 'FAIL'}`,
  ].join('\n');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const [baseline, candidate] = await Promise.all([
    readFile(args.baseline, 'utf8').then(JSON.parse),
    readFile(args.candidate, 'utf8').then(JSON.parse),
  ]);
  const report = buildReliabilityReport(baseline, candidate);
  process.stdout.write(`${args.json ? JSON.stringify(report, null, 2) : markdown(report)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
