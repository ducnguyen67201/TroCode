import type {
  DriverAuthorizationAction,
  DriverAuthorizationDecision,
  DriverAuthorizationHost,
  DriverAuthorizationRequest,
} from '@trycua/cua-driver';

interface AuthorizationActions {
  allow: DriverAuthorizationAction;
  cancel: DriverAuthorizationAction;
  deny: DriverAuthorizationAction;
}

export interface CuaAuthorizationGrant {
  expiresUnixMs: number;
  matchesResource(resource: unknown): boolean;
  publicSession: string;
}

interface PendingGrant extends CuaAuthorizationGrant {
  consumed: boolean;
}

export class CuaAuthorizationBroker implements DriverAuthorizationHost {
  private readonly pending = new Map<string, PendingGrant>();

  constructor(
    private readonly actions: AuthorizationActions,
    private readonly now: () => number = Date.now,
  ) {}

  arm(grant: CuaAuthorizationGrant): () => void {
    if (this.pending.has(grant.publicSession)) {
      throw new Error('A CUA authorization grant is already armed for this task.');
    }
    this.pending.set(grant.publicSession, { ...grant, consumed: false });
    return () => this.pending.delete(grant.publicSession);
  }

  async authorize(
    request: DriverAuthorizationRequest,
    asyncOptions?: { signal: AbortSignal },
  ): Promise<DriverAuthorizationDecision> {
    if (asyncOptions?.signal.aborted) {
      return {
        action: this.actions.cancel,
        requestDigest: request.requestDigest,
      };
    }

    const grant = this.pending.get(request.publicSession);
    if (!grant || grant.consumed || grant.expiresUnixMs < this.now()) {
      this.pending.delete(request.publicSession);
      return {
        action: this.actions.deny,
        requestDigest: request.requestDigest,
      };
    }

    grant.consumed = true;
    this.pending.delete(request.publicSession);
    let resource: unknown;
    try {
      if (request.resourceJson.length > 32_000) throw new Error('oversize');
      resource = JSON.parse(request.resourceJson);
    } catch {
      return {
        action: this.actions.deny,
        requestDigest: request.requestDigest,
      };
    }

    return {
      action: grant.matchesResource(resource)
        ? this.actions.allow
        : this.actions.deny,
      requestDigest: request.requestDigest,
    };
  }

  clear(): void {
    this.pending.clear();
  }
}
