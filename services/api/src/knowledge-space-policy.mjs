const OPERATIONS = Object.freeze({
  owner: new Set([
    'space.read', 'space.update', 'space.delete', 'member.manage', 'group.manage',
    'source.read', 'source.upload', 'source.delete', 'activity.read', 'activity.write',
    'activity.publish', 'run.manage', 'attempt.read_all', 'insight.read', 'help.resolve',
  ]),
  facilitator: new Set([
    'space.read', 'group.manage', 'source.read', 'source.upload', 'activity.read',
    'activity.write', 'activity.publish', 'run.manage', 'attempt.read_all',
    'insight.read', 'help.resolve',
  ]),
  participant: new Set([
    'space.read', 'source.read_pinned', 'activity.read_assigned', 'attempt.read_own',
    'attempt.start_own', 'attempt.help_own', 'attempt.submit_own',
  ]),
});

export function canSpaceRole(role, operation) {
  return Boolean(OPERATIONS[role]?.has(operation));
}

export function assertSpaceRole(role, operation) {
  if (!canSpaceRole(role, operation)) {
    const error = new Error('This Space operation is not available.');
    error.status = 403;
    error.code = 'space_forbidden';
    throw error;
  }
}

export function canRecordEvidence({
  attemptUserId,
  criterionIds,
  insightPolicy,
  policyAcknowledged,
  provenance,
  sessionAttemptId,
  targetAttemptId,
  tagAllowlist,
  userId,
  criterionId,
  tag,
}) {
  if (sessionAttemptId !== targetAttemptId) return false;
  if (!criterionIds.includes(criterionId) || !tagAllowlist.includes(tag)) return false;
  if (provenance === 'participant') return attemptUserId === userId;
  if (provenance === 'agent_candidate') {
    return insightPolicy === 'evidence_candidates' && policyAcknowledged;
  }
  return provenance === 'host' || provenance === 'facilitator';
}

export function deriveSupportSuggestions({ activeParticipants, criterionEvidence, participants }) {
  const suggestions = [];
  for (const participant of participants) {
    if (participant.helpRequested || participant.blockedSessionCount >= 2) {
      suggestions.push({
        kind: 'individual_follow_up',
        participantId: participant.id,
        reason: participant.helpRequested ? 'explicit_help_request' : 'repeated_blocked_sessions',
      });
    }
  }
  if (activeParticipants < 5) return suggestions;
  for (const evidence of criterionEvidence) {
    const ratio = evidence.participantCount / activeParticipants;
    if (evidence.participantCount >= 5 && ratio >= 0.3 && evidence.corroboratedCount >= 2) {
      suggestions.push({
        kind: 'group_clarification',
        criterionId: evidence.criterionId,
        participantCount: evidence.participantCount,
        activeParticipants,
        confidence: ratio >= 0.6 ? 'high' : 'moderate',
      });
    } else if (evidence.agentCandidateCount > 0) {
      suggestions.push({ kind: 'review_evidence', criterionId: evidence.criterionId });
    }
  }
  return suggestions;
}

export const SPACE_OPERATIONS = Object.freeze(
  Object.fromEntries(Object.entries(OPERATIONS).map(([role, operations]) => [role, Object.freeze([...operations])])),
);
