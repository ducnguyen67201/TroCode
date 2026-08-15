import { describe, expect, it } from 'vitest';

import { LocalOAuthBrowserFlow } from './local-oauth-browser-flow';

describe('LocalOAuthBrowserFlow', () => {
  it('accepts a code only through the loopback callback with matching state', async () => {
    const flow = new LocalOAuthBrowserFlow({
      openExternal: async (url) => {
        const authorizationUrl = new URL(url);
        const redirectUri = authorizationUrl.searchParams.get('redirect_uri');
        expect(redirectUri).toMatch(
          /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/,
        );
        const callbackUrl = new URL(redirectUri ?? '');
        callbackUrl.searchParams.set('code', 'authorization-code');
        callbackUrl.searchParams.set('state', 'trusted-state');
        const response = await fetch(callbackUrl);
        expect(response.status).toBe(200);
      },
      timeoutMs: 5_000,
    });

    await expect(
      flow.authorize({
        state: 'trusted-state',
        buildAuthorizationUrl: (redirectUri) => {
          const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          url.searchParams.set('redirect_uri', redirectUri);
          return url;
        },
      }),
    ).resolves.toEqual({
      code: 'authorization-code',
      redirectUri: expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/,
      ),
    });
  });
});
