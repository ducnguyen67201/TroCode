function lastSequence(request, url) {
  const raw = request.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0';
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    const error = new Error('Event replay sequence is invalid.');
    error.status = 400;
    throw error;
  }
  return parsed;
}

function workerStream(controller, input) {
  const encoder = new TextEncoder();
  return (async function* stream() {
    const seen = new Set();
    while (!input.signal.aborted) {
      const items = await controller.pending(input);
      for (const item of items) {
        if (seen.has(item.invocationId)) continue;
        seen.add(item.invocationId);
        yield encoder.encode(
          `id: ${item.invocationId}\nevent: tool.requested\ndata: ${JSON.stringify(item)}\n\n`,
        );
      }
      yield encoder.encode(': heartbeat\n\n');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  })();
}

export class AgentRuntimeHttpController {
  constructor({ desktopWorkerController, eventStream, rolloutPolicy, runService }) {
    this.desktopWorkerController = desktopWorkerController;
    this.eventStream = eventStream;
    this.runService = runService;
    this.rolloutPolicy = rolloutPolicy;
  }

  matches(path) {
    return path === '/v1/agent-runtime/status' || path === '/v1/tasks' || path.startsWith('/v1/tasks/') || path.startsWith('/v1/desktop-worker/');
  }

  async handle({ access, helpers, request, response, session, url }) {
    const path = url.pathname;
    const enabledForUser = this.rolloutPolicy?.enabledFor(session.user.id) ?? true;
    if (request.method === 'GET' && path === '/v1/agent-runtime/status') {
      helpers.sendJson(response, 200, {
        enabled: enabledForUser,
        protocolVersion: 2,
        workerRequired:
          enabledForUser ||
          await this.runService.hasActive(session.user.id),
      });
      return true;
    }
    if (!enabledForUser && request.method === 'POST' && path === '/v1/tasks') {
      const error = new Error('The durable agent runtime is not enabled for this user.');
      error.code = 'backend_agent_not_enabled';
      error.status = 409;
      throw error;
    }
    const taskMatch = /^\/v1\/tasks\/([0-9a-f-]+)(?:\/(events|steering|cancel|approval))?$/iu.exec(path);
    if (request.method === 'POST' && path === '/v1/tasks') {
      const body = await helpers.readJson(request, 64_000);
      const run = await this.runService.submit({ ...session.user, plan: access.plan }, body);
      helpers.sendJson(response, run.newlyCreated ? 201 : 200, run, { Location: `/v1/tasks/${run.id}` });
      return true;
    }
    if (request.method === 'GET' && path === '/v1/tasks') {
      helpers.sendJson(response, 200, { items: await this.runService.list(session.user.id, {}) });
      return true;
    }
    if (taskMatch) {
      const [, runId, operation] = taskMatch;
      if (request.method === 'GET' && !operation) {
        const run = await this.runService.get(session.user.id, runId);
        if (!run) return helpers.notFound();
        helpers.sendJson(response, 200, run);
        return true;
      }
      if (request.method === 'GET' && operation === 'events') {
        const run = await this.runService.get(session.user.id, runId);
        if (!run) return helpers.notFound();
        const controller = new AbortController();
        response.once('close', () => controller.abort());
        await helpers.sendStream(
          response,
          200,
          this.eventStream.runEvents({
            afterSequence: lastSequence(request, url),
            runId,
            signal: controller.signal,
            userId: session.user.id,
          }),
          'text/event-stream; charset=utf-8',
          { Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
        );
        return true;
      }
      if ((request.method === 'DELETE' && !operation) || (request.method === 'POST' && operation === 'cancel')) {
        const run = await this.runService.cancel(session.user.id, runId);
        if (!run) return helpers.notFound();
        helpers.sendJson(response, 200, run);
        return true;
      }
      if (request.method === 'POST' && operation === 'steering') {
        const event = await this.runService.steer(
          { ...session.user, plan: access.plan },
          runId,
          await helpers.readJson(request, 16_000),
        );
        if (!event) return helpers.notFound();
        helpers.sendJson(response, 202, event);
        return true;
      }
      if (request.method === 'POST' && operation === 'approval') {
        const event = await this.runService.decideApproval(
          session.user.id,
          runId,
          await helpers.readJson(request, 16_000),
        );
        if (!event) return helpers.notFound();
        helpers.sendJson(response, 202, event);
        return true;
      }
    }

    if (request.method === 'POST' && path === '/v1/desktop-worker/connect') {
      const worker = await this.desktopWorkerController.connect({
        capabilities: await helpers.readJson(request, 64_000),
        deviceSessionId: session.sessionId,
        userId: session.user.id,
      });
      helpers.sendJson(response, 201, worker);
      return true;
    }
    if (request.method === 'GET' && path === '/v1/desktop-worker/events') {
      const workerSessionId = url.searchParams.get('workerSessionId');
      if (!workerSessionId) throw Object.assign(new Error('workerSessionId is required.'), { status: 400 });
      const controller = new AbortController();
      response.once('close', () => controller.abort());
      await helpers.sendStream(
        response,
        200,
        workerStream(this.desktopWorkerController, {
          signal: controller.signal,
          userId: session.user.id,
          workerSessionId,
        }),
        'text/event-stream; charset=utf-8',
        { Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
      );
      return true;
    }
    const workerAction = /^\/v1\/desktop-worker\/([0-9a-f-]+)\/(heartbeat|executing|result|disconnect)$/iu.exec(path);
    if (request.method === 'POST' && workerAction) {
      const [, workerSessionId, operation] = workerAction;
      if (operation === 'heartbeat') {
        const result = await this.desktopWorkerController.heartbeat({ userId: session.user.id, workerSessionId });
        if (!result) return helpers.notFound();
        helpers.sendJson(response, 200, result);
        return true;
      }
      if (operation === 'disconnect') {
        helpers.sendJson(response, 200, await this.desktopWorkerController.disconnect({ userId: session.user.id, workerSessionId }));
        return true;
      }
      const body = await helpers.readJson(request, 1_000_000);
      if (operation === 'executing') {
        helpers.sendJson(response, 200, await this.desktopWorkerController.grantExecution({
          input: body,
          userId: session.user.id,
          workerSessionId,
        }));
        return true;
      }
      helpers.sendJson(response, 200, await this.desktopWorkerController.recordResult({
        input: body,
        userId: session.user.id,
        workerSessionId,
      }));
      return true;
    }
    return false;
  }
}
