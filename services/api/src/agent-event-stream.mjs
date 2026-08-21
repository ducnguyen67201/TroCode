const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_000;

function encodeEvent(event) {
  return Buffer.from(
    `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    'utf8',
  );
}

function wait(milliseconds, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export class AgentEventStream {
  constructor({ repository, listEvents, pollMs = POLL_MS }) {
    this.repository = repository;
    this.listEvents = listEvents ?? ((userId, runId, afterSequence) =>
      repository.eventsAfter(userId, runId, afterSequence, 500));
    this.pollMs = pollMs;
  }

  async *runEvents({ afterSequence = 0, runId, signal, userId }) {
    let cursor = afterSequence;
    let heartbeatAt = Date.now() + HEARTBEAT_MS;
    while (!signal?.aborted) {
      const events = await this.listEvents(userId, runId, cursor);
      for (const event of events) {
        cursor = event.sequence;
        yield encodeEvent(event);
      }
      const run = await this.repository.getOwned(userId, runId);
      if (!run || ['completed', 'blocked', 'failed', 'cancelled', 'expired'].includes(run.state)) return;
      if (Date.now() >= heartbeatAt) {
        yield Buffer.from(': heartbeat\n\n', 'utf8');
        heartbeatAt = Date.now() + HEARTBEAT_MS;
      }
      await wait(this.pollMs, signal);
    }
  }
}
