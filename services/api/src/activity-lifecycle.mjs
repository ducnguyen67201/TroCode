const TRANSITIONS = Object.freeze({
  activity: {
    draft: new Set(['published', 'archived']),
    published: new Set(['archived']),
    archived: new Set(),
  },
  run: {
    draft: new Set(['open', 'archived']),
    open: new Set(['closed']),
    closed: new Set(['archived']),
    archived: new Set(),
  },
  attempt: {
    assigned: new Set(['in_progress', 'withdrawn']),
    in_progress: new Set(['blocked', 'submitted', 'completed', 'withdrawn']),
    blocked: new Set(['in_progress', 'submitted', 'withdrawn']),
    submitted: new Set(['completed', 'in_progress']),
    completed: new Set(),
    withdrawn: new Set(),
  },
  workSession: {
    created: new Set(['active', 'cancelled']),
    active: new Set(['paused', 'completed', 'cancelled', 'failed']),
    paused: new Set(['active', 'completed', 'cancelled']),
    completed: new Set(),
    cancelled: new Set(),
    failed: new Set(),
  },
});

export function canTransition(entity, from, to) {
  return Boolean(TRANSITIONS[entity]?.[from]?.has(to));
}

export function assertTransition(entity, from, to) {
  if (!canTransition(entity, from, to)) {
    const error = new Error(`Invalid ${entity} transition.`);
    error.status = 409;
    error.code = 'invalid_transition';
    throw error;
  }
}

export function isRunOpen(run, now = new Date()) {
  if (run.state !== 'open') return false;
  const time = now.getTime();
  if (run.opensAt && time < new Date(run.opensAt).getTime()) return false;
  if (run.closesAt && time >= new Date(run.closesAt).getTime()) return false;
  return true;
}

export function nextAttemptState({ current, helpRequested, submitted }) {
  if (submitted) return current === 'submitted' ? current : 'submitted';
  if (helpRequested && (current === 'assigned' || current === 'in_progress')) return 'blocked';
  if (current === 'assigned') return 'in_progress';
  return current;
}

export const ACTIVITY_TRANSITIONS = TRANSITIONS;
