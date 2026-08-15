import { useEffect, useState } from 'react';

import type { AuthStatus } from '../shared/contracts';

import { App } from './App';
import { BrandMark } from './BrandMark';

const EMPTY_AUTH_STATUS: AuthStatus = {
  state: 'signed_out',
  configured: true,
  user: null,
  summary: 'Checking your Google session…',
};

function LoginScreen({
  error,
  isLoading,
  onSignIn,
  status,
}: {
  error: string | null;
  isLoading: boolean;
  onSignIn: () => void;
  status: AuthStatus;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-heading">
        <BrandMark className="auth-brand-mark" />
        <p className="eyebrow">Welcome to TroCode</p>
        <h1 id="auth-heading">Your desktop agent, connected to you.</h1>
        <p className="auth-description">
          Sign in once with Google. TroCode stores your session securely on
          this computer, then asks separately before using your microphone or
          controlling the screen.
        </p>
        <button
          className="google-sign-in-button"
          disabled={isLoading || !status.configured}
          onClick={onSignIn}
          type="button"
        >
          <span className="google-g" aria-hidden="true">
            G
          </span>
          {isLoading
            ? 'Finish sign-in in your browser…'
            : 'Continue with Google'}
        </button>
        <p className="auth-status" aria-live="polite">
          {error ?? status.summary}
        </p>
      </section>
    </main>
  );
}

export function AuthGate() {
  const [status, setStatus] = useState<AuthStatus>(EMPTY_AUTH_STATUS);
  const [isChecking, setIsChecking] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.tro
      .getAuthStatus()
      .then((nextStatus) => {
        if (mounted) setStatus(nextStatus);
      })
      .catch((authError: unknown) => {
        if (mounted) {
          setError(
            authError instanceof Error
              ? authError.message
              : 'Could not check your Google session.',
          );
        }
      })
      .finally(() => {
        if (mounted) setIsChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = async (): Promise<void> => {
    setError(null);
    setIsSigningIn(true);
    try {
      setStatus(await window.tro.signInWithGoogle());
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : 'Google sign-in did not complete.',
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setError(null);
    setIsSigningOut(true);
    try {
      setStatus(await window.tro.signOutGoogle());
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : 'Could not sign out.',
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  if (isChecking) {
    return (
      <main className="auth-screen" aria-live="polite">
        <div>
          <BrandMark className="auth-loading-mark" />
          <span className="auth-status">Checking your Google session…</span>
        </div>
      </main>
    );
  }

  if (status.state !== 'signed_in' || !status.user) {
    return (
      <LoginScreen
        error={error}
        isLoading={isSigningIn}
        onSignIn={() => void signIn()}
        status={status}
      />
    );
  }

  return (
    <App
      currentUser={status.user}
      isSigningOut={isSigningOut}
      onSignOut={() => void signOut()}
    />
  );
}
