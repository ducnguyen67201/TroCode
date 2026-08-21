import { createHmac } from 'node:crypto';

export class AgentRolloutPolicy {
  constructor({ enabled, hmacKey, canaryUsers = new Set(), rolloutPercent = 0 }) {
    this.enabled = enabled;
    this.hmacKey = hmacKey;
    this.canaryUsers = canaryUsers;
    this.rolloutPercent = rolloutPercent;
  }

  enabledFor(userId) {
    if (!this.enabled) return false;
    if (this.canaryUsers.has(userId)) return true;
    if (this.rolloutPercent <= 0) return false;
    if (this.rolloutPercent >= 100) return true;
    const digest = createHmac('sha256', this.hmacKey)
      .update(`backend-agent-rollout:${userId}`)
      .digest();
    return digest.readUInt32BE(0) % 10_000 < this.rolloutPercent * 100;
  }
}
