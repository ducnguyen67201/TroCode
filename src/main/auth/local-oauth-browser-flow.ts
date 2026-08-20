import { createServer, type Server } from 'node:http';

const CALLBACK_PATH = '/oauth2/callback';
const DEFAULT_TIMEOUT_MS = 120_000;

export interface OAuthBrowserAuthorizationOptions {
  buildAuthorizationUrl(redirectUri: string): URL;
  state: string;
}

export interface OAuthAuthorizationResult {
  code: string;
  redirectUri: string;
}

export interface OAuthBrowserFlow {
  authorize(
    options: OAuthBrowserAuthorizationOptions,
  ): Promise<OAuthAuthorizationResult>;
}

export interface LocalOAuthBrowserFlowOptions {
  openExternal(url: string): Promise<unknown>;
  timeoutMs?: number;
}

function completionPage(success: boolean): string {
  const title = success ? 'Signed in to Tro' : 'Tro sign-in failed';
  const message = success
    ? 'You can close this tab and return to Tro.'
    : 'Return to Tro and try signing in again.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>body{background:#f3f3ef;color:#252521;font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center}.card{border:1px solid #d5d5ce;border-radius:18px;padding:32px;max-width:460px;background:#fff;box-shadow:0 24px 70px rgba(51,48,38,.12)}h1{margin-top:0;color:#765600}p{color:#62625c}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export class LocalOAuthBrowserFlow implements OAuthBrowserFlow {
  private activeServer: Server | null = null;

  constructor(private readonly options: LocalOAuthBrowserFlowOptions) {}

  authorize(
    options: OAuthBrowserAuthorizationOptions,
  ): Promise<OAuthAuthorizationResult> {
    if (this.activeServer) {
      return Promise.reject(new Error('Google sign-in is already in progress.'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let redirectUri = '';
      const server = createServer((request, response) => {
        const requestUrl = new URL(
          request.url ?? '/',
          redirectUri || 'http://127.0.0.1',
        );
        if (requestUrl.pathname !== CALLBACK_PATH) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }

        const receivedState = requestUrl.searchParams.get('state');
        const code = requestUrl.searchParams.get('code');
        const oauthError = requestUrl.searchParams.get('error');
        if (oauthError || !code || receivedState !== options.state) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(completionPage(false));
          finish(
            new Error(
              oauthError === 'access_denied'
                ? 'Google sign-in was cancelled.'
                : 'Google sign-in response could not be verified.',
            ),
          );
          return;
        }

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(completionPage(true));
        finish(null, { code, redirectUri });
      });
      this.activeServer = server;

      const timeout = setTimeout(
        () => finish(new Error('Google sign-in timed out. Please try again.')),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      timeout.unref?.();

      const finish = (
        error: Error | null,
        result?: OAuthAuthorizationResult,
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.activeServer === server) this.activeServer = null;
        server.close();
        if (error) reject(error);
        else if (result) resolve(result);
      };

      server.once('error', (error) => finish(error));
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          finish(new Error('Could not start the Google sign-in callback.'));
          return;
        }
        redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
        const authorizationUrl = options.buildAuthorizationUrl(redirectUri);
        void this.options
          .openExternal(authorizationUrl.toString())
          .catch((error: unknown) =>
            finish(
              error instanceof Error
                ? error
                : new Error('Could not open Google sign-in.'),
            ),
          );
      });
    });
  }

  shutdown(): void {
    this.activeServer?.close();
    this.activeServer = null;
  }
}
