import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../shared/contracts';
import {
  GoogleAuthService,
  type AuthSession,
  type AuthSessionStore,
} from './google-auth-service';
import type {
  OAuthBrowserAuthorizationOptions,
  OAuthBrowserFlow,
} from './local-oauth-browser-flow';

const TEST_USER: AuthUser = {
  id: 'google-user-123',
  email: 'person@example.com',
  name: 'Test Person',
};

function memoryStore(initial: AuthSession | null = null): {
  clear: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  store: AuthSessionStore;
  write: ReturnType<typeof vi.fn>;
} {
  let session = initial;
  const read = vi.fn(async () => session);
  const write = vi.fn(async (nextSession: AuthSession) => {
    session = nextSession;
  });
  const clear = vi.fn(async () => {
    session = null;
  });
  return { clear, read, store: { clear, read, write }, write };
}

function browserFlow(
  inspectUrl: (url: URL) => void = () => undefined,
): OAuthBrowserFlow {
  return {
    authorize: vi.fn(async (options: OAuthBrowserAuthorizationOptions) => {
      const redirectUri = 'http://127.0.0.1:43210/oauth2/callback';
      inspectUrl(options.buildAuthorizationUrl(redirectUri));
      return { code: 'authorization-code', redirectUri };
    }),
  };
}

describe('GoogleAuthService', () => {
  it('reports missing configuration without starting OAuth', async () => {
    const { store } = memoryStore();
    const flow = browserFlow();
    const service = new GoogleAuthService({ browserFlow: flow, sessionStore: store });

    await expect(service.getStatus()).resolves.toMatchObject({
      configured: false,
      state: 'error',
      user: null,
    });
    await expect(service.signIn()).rejects.toThrow(
      'GOOGLE_OAUTH_CLIENT_ID',
    );
    expect(flow.authorize).not.toHaveBeenCalled();
  });

  it('uses PKCE and stores the verified Google session', async () => {
    const { store, write } = memoryStore();
    let authorizationUrl: URL | null = null;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          id_token: 'signed-google-id-token',
          refresh_token: 'refresh-token',
        }),
        { status: 200 },
      ),
    );
    const verifyIdToken = vi.fn(async () => TEST_USER);
    const service = new GoogleAuthService({
      browserFlow: browserFlow((url) => {
        authorizationUrl = url;
      }),
      clientId: 'desktop-client.apps.googleusercontent.com',
      clientSecret: 'desktop-client-secret',
      fetchImpl,
      sessionStore: store,
      verifyIdToken,
    });

    await expect(service.signIn()).resolves.toMatchObject({
      configured: true,
      state: 'signed_in',
      user: TEST_USER,
    });

    expect(authorizationUrl).not.toBeNull();
    expect(authorizationUrl?.origin).toBe('https://accounts.google.com');
    expect(authorizationUrl?.searchParams.get('scope')).toBe(
      'openid email profile',
    );
    expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe(
      'S256',
    );
    expect(authorizationUrl?.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizationUrl?.searchParams.get('nonce')).toBeTruthy();
    expect(authorizationUrl?.searchParams.get('access_type')).toBe('offline');

    const request = fetchImpl.mock.calls[0]?.[1];
    const body = new URLSearchParams(String(request?.body));
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('client_secret')).toBe('desktop-client-secret');
    expect(verifyIdToken).toHaveBeenCalledWith(
      'signed-google-id-token',
      expect.objectContaining({
        clientId: 'desktop-client.apps.googleusercontent.com',
        expectedNonce: authorizationUrl?.searchParams.get('nonce'),
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'refresh-token',
        user: TEST_USER,
      }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'signed_in',
      user: TEST_USER,
    });
  });

  it('restores and clears a persisted session', async () => {
    const { clear, store } = memoryStore({
      signedInAt: '2026-08-15T06:00:00.000Z',
      user: TEST_USER,
    });
    const service = new GoogleAuthService({
      browserFlow: browserFlow(),
      clientId: 'desktop-client.apps.googleusercontent.com',
      sessionStore: store,
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'signed_in',
      user: TEST_USER,
    });
    await expect(service.assertSignedIn()).resolves.toBeUndefined();
    await expect(service.signOut()).resolves.toMatchObject({
      state: 'signed_out',
      user: null,
    });
    expect(clear).toHaveBeenCalledOnce();
    await expect(service.assertSignedIn()).rejects.toThrow(
      'Sign in with Google',
    );
  });
});
