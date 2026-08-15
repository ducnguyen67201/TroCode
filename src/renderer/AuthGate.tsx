import { useCallback, useEffect, useState } from 'react';

import type { AuthStatus, AuthUser, CuaStatus } from '../shared/contracts';

import { App } from './App';

type PermissionState = 'not_requested' | 'requesting' | 'enabled' | 'error';

const EMPTY_AUTH_STATUS: AuthStatus = {
  state: 'signed_out',
  configured: true,
  user: null,
  summary: 'Checking your Google session…',
};

function permissionStorageKey(user: AuthUser): string {
  return `trocode.permissions.v1:${user.id}`;
}

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
        <div className="auth-brand-mark" aria-hidden="true">
          T
        </div>
        <p className="eyebrow">Welcome to TroCode</p>
        <h1 id="auth-heading">Your desktop agent, connected to you.</h1>
        <p className="auth-description">
          Sign in once with Google. TroCode stores your session securely on
          this computer and asks separately before using your microphone or
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
          {isLoading ? 'Finish sign-in in your browser…' : 'Continue with Google'}
        </button>
        <p className="auth-status" aria-live="polite">
          {error ?? status.summary}
        </p>
      </section>
    </main>
  );
}

function CapabilityOnboarding({
  onComplete,
  user,
}: {
  onComplete: () => void;
  user: AuthUser;
}) {
  const [microphone, setMicrophone] =
    useState<PermissionState>('not_requested');
  const [computer, setComputer] = useState<PermissionState>('not_requested');
  const [computerSummary, setComputerSummary] = useState(
    'Accessibility and Screen Recording permissions let TroCode carry out approved actions.',
  );

  useEffect(() => {
    let mounted = true;
    void window.tro
      .getComputerStatus()
      .then((status: CuaStatus) => {
        if (!mounted) return;
        setComputer(status.state === 'ready' ? 'enabled' : 'not_requested');
        setComputerSummary(status.summary);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const enableMicrophone = useCallback(async () => {
    setMicrophone('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setMicrophone('enabled');
    } catch {
      setMicrophone('error');
    }
  }, []);

  const enableComputer = useCallback(async () => {
    setComputer('requesting');
    try {
      const status = await window.tro.connectComputer();
      setComputerSummary(status.summary);
      setComputer(status.state === 'ready' ? 'enabled' : 'error');
    } catch (error) {
      setComputerSummary(
        error instanceof Error
          ? error.message
          : 'Computer access could not be enabled.',
      );
      setComputer('error');
    }
  }, []);

  const finish = (): void => {
    localStorage.setItem(permissionStorageKey(user), 'complete');
    onComplete();
  };

  return (
    <main className="auth-screen">
      <section
        className="auth-card auth-card--permissions"
        aria-labelledby="permissions-heading"
      >
        <p className="eyebrow">You’re signed in</p>
        <h1 id="permissions-heading">Choose what TroCode can use.</h1>
        <p className="auth-description">
          Hi {user.name}. These operating-system permissions stay separate
          from Google sign-in. TroCode still asks for approval before any
          consequential action.
        </p>

        <div className="permission-grid">
          <section className="permission-card">
            <span className="permission-icon" aria-hidden="true">
              ◉
            </span>
            <div>
              <h2>Voice input</h2>
              <p>Use the microphone only while you hold the voice shortcut.</p>
            </div>
            <button
              className="secondary-button"
              disabled={microphone === 'requesting' || microphone === 'enabled'}
              onClick={() => void enableMicrophone()}
              type="button"
            >
              {microphone === 'enabled'
                ? 'Microphone enabled'
                : microphone === 'requesting'
                  ? 'Waiting for permission…'
                  : microphone === 'error'
                    ? 'Try microphone again'
                    : 'Enable microphone'}
            </button>
          </section>

          <section className="permission-card">
            <span className="permission-icon" aria-hidden="true">
              ▣
            </span>
            <div>
              <h2>Computer control</h2>
              <p>{computerSummary}</p>
            </div>
            <button
              className="secondary-button"
              disabled={computer === 'requesting' || computer === 'enabled'}
              onClick={() => void enableComputer()}
              type="button"
            >
              {computer === 'enabled'
                ? 'Computer enabled'
                : computer === 'requesting'
                  ? 'Opening permissions…'
                  : computer === 'error'
                    ? 'Check permissions again'
                    : 'Enable computer'}
            </button>
          </section>
        </div>

        <div className="permission-actions">
          <span>You can change these later in System Settings.</span>
          <button className="primary-button" onClick={finish} type="button">
            Continue to TroCode <span aria-hidden="true">→</span>
          </button>
        </div>
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
  const [permissionsComplete, setPermissionsComplete] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.tro
      .getAuthStatus()
      .then((nextStatus) => {
        if (!mounted) return;
        setStatus(nextStatus);
        if (nextStatus.user) {
          setPermissionsComplete(
            localStorage.getItem(permissionStorageKey(nextStatus.user)) ===
              'complete',
          );
        }
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
      const nextStatus = await window.tro.signInWithGoogle();
      setStatus(nextStatus);
      setPermissionsComplete(
        nextStatus.user
          ? localStorage.getItem(permissionStorageKey(nextStatus.user)) ===
              'complete'
          : false,
      );
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
      setPermissionsComplete(false);
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
        <div className="auth-loading-mark">T</div>
        <span className="auth-status">Checking your Google session…</span>
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

  if (!permissionsComplete) {
    return (
      <CapabilityOnboarding
        onComplete={() => setPermissionsComplete(true)}
        user={status.user}
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
