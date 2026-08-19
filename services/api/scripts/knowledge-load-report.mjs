import { performance } from 'node:perf_hooks';

import { deriveSupportSuggestions } from '../src/knowledge-space-policy.mjs';

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

for (const participantCount of [200, 500]) {
  const durations = [];
  const participants = Array.from({ length: participantCount }, (_, index) => ({
    blockedSessionCount: index % 19 === 0 ? 2 : 0,
    helpRequested: index % 23 === 0,
    id: `fixture-user-${index + 1}`,
  }));
  for (let sample = 0; sample < 500; sample += 1) {
    const startedAt = performance.now();
    deriveSupportSuggestions({
      activeParticipants: participantCount,
      criterionEvidence: [{
        agentCandidateCount: 3,
        corroboratedCount: 4,
        criterionId: 'criterion-loop-termination',
        participantCount: Math.ceil(participantCount * 0.35),
      }],
      participants,
    });
    durations.push(performance.now() - startedAt);
  }
  console.info(JSON.stringify({
    event: 'knowledge.dashboard_projection_fixture',
    participantCount,
    p95Milliseconds: Number(percentile(durations, 0.95).toFixed(3)),
    samples: durations.length,
  }));
}

if (!process.env.TEST_DATABASE_URL) {
  console.info(JSON.stringify({
    event: 'knowledge.database_load_skipped',
    reason: 'Set TEST_DATABASE_URL to run the real PostgreSQL 200-participant integration fixture.',
  }));
}
