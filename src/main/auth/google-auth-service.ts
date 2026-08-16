import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  AuthStatusSchema,
  type AuthStatus,
  type AuthUser,
} from '../../shared/contracts';

import {
  verifyGoogleIdToken,
  type VerifyGoogleIdTokenOptions,
} from './google-token-verifier';
import type { OAuthBrowserFlow } from './local-oauth-browser-flow';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const GoogleTokenResponseSchema = z.object({
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

export interface AuthSession {
  refreshToken?: string;
  signedInAt: string;
  user: AuthUser;
}

export interface AuthSessionStore {
  clear(): Promise<void>;
  read(): Promise<AuthSession | null>;
  write(session: AuthSession): Promise<void>;
}

type VerifyIdToken = (
  idToken: string,
  options: VerifyGoogleIdTokenOptions,
) => Promise<AuthUser>;

export interface GoogleAuthServiceOptions {
  browserFlow: OAuthBrowserFlow;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
  sessionStore: AuthSessionStore;
  verifyIdToken?: VerifyIdToken;
}

function randomUrlSafeValue(size = 32): string {
  return randomBytes(size).toString('base64url');
}

function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class GoogleAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly verifyIdToken: VerifyIdToken;
  private signInPromise: Promise<AuthStatus> | null = null;

  constructor(private readonly options: GoogleAuthServiceOptions) {
    this.clientId = options.clientId?.trim() ?? '';
    this.clientSecret = options.clientSecret?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.verifyIdToken = options.verifyIdToken ?? verifyGoogleIdToken;
  }

  async getStatus(): Promise<AuthStatus> {
    if (!this.clientId) {
      return AuthStatusSchema.parse({
        state: 'error',
        configured: false,
        user: null,
        summary:
          'Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID.',
      });
    }

    try {
      const session = await this.options.sessionStore.read();
      if (!session) {
        return AuthStatusSchema.parse({
          state: 'signed_out',
          configured: true,
          user: null,
          summary: 'Sign in with Google to continue.',
        });
      }
      return AuthStatusSchema.parse({
        state: 'signed_in',
        configured: true,
        user: session.user,
        summary: `Signed in as ${session.user.email}.`,
      });
    } catch {
      return AuthStatusSchema.parse({
        state: 'error',
        configured: true,
        user: null,
        summary: 'The saved Google session could not be read. Sign in again.',
      });
    }
  }

  signIn(): Promise<AuthStatus> {
    if (this.signInPromise) return this.signInPromise;

    const operation = this.performSignIn().finally(() => {
      if (this.signInPromise === operation) this.signInPromise = null;
    });
    this.signInPromise = operation;
    return operation;
  }

  async signOut(): Promise<AuthStatus> {
    await this.options.sessionStore.clear();
    return AuthStatusSchema.parse({
      state: 'signed_out',
      configured: Boolean(this.clientId),
      user: null,
      summary: 'Signed out. Sign in with Google to continue.',
    });
  }

  async assertSignedIn(): Promise<AuthUser> {
    const status = await this.getStatus();
    if (status.state !== 'signed_in' || !status.user) {
      throw new Error('Sign in with Google before using TroCode.');
    }
    return status.user;
  }

  private async performSignIn(): Promise<AuthStatus> {
    if (!this.clientId) {
      throw new Error(
        'Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID.',
      );
    }

    const state = randomUrlSafeValue();
    const nonce = randomUrlSafeValue();
    const verifier = randomUrlSafeValue(64);
    const authorization = await this.options.browserFlow.authorize({
      state,
      buildAuthorizationUrl: (redirectUri) => {
        const url = new URL(GOOGLE_AUTHORIZATION_URL);
        url.search = new URLSearchParams({
          access_type: 'offline',
          client_id: this.clientId,
          code_challenge: codeChallenge(verifier),
          code_challenge_method: 'S256',
          nonce,
          prompt: 'consent select_account',
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          state,
        }).toString();
        return url;
      },
    });

    const tokenRequest = new URLSearchParams({
      client_id: this.clientId,
      code: authorization.code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: authorization.redirectUri,
    });
    if (this.clientSecret) tokenRequest.set('client_secret', this.clientSecret);

    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenRequest,
    });
    if (!response.ok) {
      throw new Error('Google could not complete sign-in. Please try again.');
    }

    const tokens = GoogleTokenResponseSchema.parse(await response.json());
    const user = await this.verifyIdToken(tokens.id_token, {
      clientId: this.clientId,
      expectedNonce: nonce,
      fetchImpl: this.fetchImpl,
    });
    await this.options.sessionStore.write({
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      signedInAt: new Date().toISOString(),
      user,
    });

    return AuthStatusSchema.parse({
      state: 'signed_in',
      configured: true,
      user,
      summary: `Signed in as ${user.email}.`,
    });
  }
}
