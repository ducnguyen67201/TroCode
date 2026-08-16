import { useState } from 'react';

import type { MembershipStatus } from '../shared/contracts';

import { BrandMark } from './BrandMark';
import { formatMembershipExpiry } from './membership';

interface MembershipGateProps {
  error: string | null;
  isActivating: boolean;
  isChecking: boolean;
  isSigningOut: boolean;
  onActivate(code: string): void;
  onRefresh(): void;
  onSignOut(): void;
  status: MembershipStatus | null;
}

export function MembershipGate({
  error,
  isActivating,
  isChecking,
  isSigningOut,
  onActivate,
  onRefresh,
  onSignOut,
  status,
}: MembershipGateProps) {
  const [activationCode, setActivationCode] = useState('');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const normalizedCode = activationCode.trim();
  const expiry = formatMembershipExpiry(status?.expiresAt ?? null);
  const busy = isActivating || isChecking || isSigningOut;

  const copyReferenceCode = async (): Promise<void> => {
    if (!status?.referenceCode) return;
    try {
      await navigator.clipboard.writeText(status.referenceCode);
      setCopyMessage('Copied');
    } catch {
      setCopyMessage('Select and copy the code');
    }
  };

  if (!status && isChecking) {
    return (
      <main className="membership-screen" aria-live="polite">
        <div>
          <BrandMark className="auth-loading-mark" />
          <span className="auth-status">Checking your membership…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="membership-screen">
      <div className="membership-screen__brand">
        <BrandMark />
        <div>
          <strong>TroCode</strong>
          <span>Desktop agent</span>
        </div>
      </div>

      <section
        aria-labelledby="membership-heading"
        className="membership-card"
      >
        <span className="membership-card__step">Final setup step</span>
        <p className="eyebrow">Membership access</p>
        <h1 id="membership-heading">
          {status?.state === 'expired'
            ? 'Renew your TroCode membership'
            : 'Activate your TroCode membership'}
        </h1>
        <p className="membership-card__description">
          Send your reference code to the TroCode team. When your access is
          approved, paste the activation code you receive below.
        </p>

        <div className="membership-reference">
          <div>
            <span>Your reference code</span>
            <strong>{status?.referenceCode ?? 'Unavailable'}</strong>
          </div>
          <button
            disabled={busy || !status?.referenceCode}
            onClick={() => void copyReferenceCode()}
            type="button"
          >
            {copyMessage ?? 'Copy'}
          </button>
        </div>

        {expiry && (
          <p className="membership-expiry">
            Previous access ended on <strong>{expiry}</strong>.
          </p>
        )}

        <label className="membership-code-field" htmlFor="activation-code">
          <span>Activation code</span>
          <textarea
            autoCapitalize="none"
            autoComplete="off"
            disabled={busy}
            id="activation-code"
            onChange={(event) => setActivationCode(event.target.value)}
            placeholder="Paste your activation code"
            rows={4}
            spellCheck={false}
            value={activationCode}
          />
        </label>

        {(error || status?.state === 'error') && (
          <div className="membership-error" role="alert">
            <strong>Membership needs attention</strong>
            <span>{error ?? status?.summary}</span>
          </div>
        )}

        <div className="membership-actions">
          <button
            className="primary-button"
            disabled={busy || normalizedCode.length < 40}
            onClick={() => onActivate(normalizedCode)}
            type="button"
          >
            {isActivating ? 'Activating…' : 'Activate membership'}
            {!isActivating && <span aria-hidden="true">→</span>}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onRefresh}
            type="button"
          >
            {isChecking ? 'Checking…' : 'Check again'}
          </button>
        </div>

        <button
          className="membership-sign-out"
          disabled={busy}
          onClick={onSignOut}
          type="button"
        >
          {isSigningOut ? 'Signing out…' : 'Use another Google account'}
        </button>
      </section>
    </main>
  );
}
