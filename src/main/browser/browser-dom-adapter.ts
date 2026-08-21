export type BrowserDomOperation =
  | 'observe'
  | 'click'
  | 'fill'
  | 'press'
  | 'scroll'
  | 'read'
  | 'assert';

export interface BrowserDomInvocation {
  assertion?: string;
  key?: string;
  observationId: string;
  operation: BrowserDomOperation;
  ref?: string;
  text?: string;
}

export interface BrowserDomResult {
  facts?: Array<{ name: string; ref: string; role: string; value?: string }>;
  status: 'confirmed' | 'failed' | 'not_executed' | 'unknown';
  summary: string;
}

export interface BrowserDomAdapter {
  closeTask(taskId: string): Promise<void>;
  execute(
    taskId: string,
    invocation: BrowserDomInvocation,
    signal?: AbortSignal,
  ): Promise<BrowserDomResult>;
}

export interface AuthorizedCdpGrant {
  endpoint: string;
  expiresAt: string;
  observationId: string;
  targetUrl: string;
}

export interface BrowserCdpAuthorizationProvider {
  consume(taskId: string, observationId: string): Promise<AuthorizedCdpGrant>;
}
