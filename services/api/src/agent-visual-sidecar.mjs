const DEFAULT_TTL_MS = 2 * 60_000;

export class AgentVisualSidecar {
  constructor({ maxBytes = 40_000_000, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  put(invocationId, visual) {
    const bytes = Buffer.byteLength(visual.dataBase64, 'base64');
    if (bytes > this.maxBytes) throw new Error('Visual sidecar payload exceeds the in-memory limit.');
    this.sweep();
    this.items.set(invocationId, {
      expiresAt: Date.now() + this.ttlMs,
      visual: {
        detail: visual.detail,
        imageUrl: `data:${visual.mimeType};base64,${visual.dataBase64}`,
        observationId: visual.observationId,
      },
    });
  }

  take(invocationId) {
    const item = this.items.get(invocationId);
    this.items.delete(invocationId);
    return item && item.expiresAt > Date.now() ? item.visual : null;
  }

  sweep() {
    const now = Date.now();
    for (const [id, item] of this.items) {
      if (item.expiresAt <= now) this.items.delete(id);
    }
  }
}
