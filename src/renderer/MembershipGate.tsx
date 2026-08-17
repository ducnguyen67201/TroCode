import { useState } from 'react';

import type { AppLanguage, MembershipStatus } from '../shared/contracts';

import { appLocale, translate } from './app-language';
import { BrandMark } from './BrandMark';
import { formatMembershipExpiry } from './membership';

interface MembershipGateProps {
  appLanguage: AppLanguage;
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
  appLanguage,
  error,
  isActivating,
  isChecking,
  isSigningOut,
  onActivate,
  onRefresh,
  onSignOut,
  status,
}: MembershipGateProps) {
  const t = (message: string) => translate(appLanguage, message);
  const [activationCode, setActivationCode] = useState('');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const normalizedCode = activationCode.trim();
  const expiry = formatMembershipExpiry(
    status?.expiresAt ?? null,
    appLocale(appLanguage),
  );
  const busy = isActivating || isChecking || isSigningOut;

  const copyReferenceCode = async (): Promise<void> => {
    if (!status?.referenceCode) return;
    try {
      await navigator.clipboard.writeText(status.referenceCode);
      setCopyMessage(t('Copied'));
    } catch {
      setCopyMessage(t('Select and copy the code'));
    }
  };

  if (!status && isChecking) {
    return (
      <main className="membership-screen" aria-live="polite">
        <div>
          <BrandMark className="auth-loading-mark" />
          <span className="auth-status">{t('Checking your membership…')}</span>
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
          <span>{t('Desktop agent')}</span>
        </div>
      </div>

      <section
        aria-labelledby="membership-heading"
        className="membership-card"
      >
        <span className="membership-card__step">{t('Final setup step')}</span>
        <p className="eyebrow">{t('Membership access')}</p>
        <h1 id="membership-heading">
          {status?.state === 'expired'
            ? t('Renew your TroCode membership')
            : t('Activate your TroCode membership')}
        </h1>
        <p className="membership-card__description">
          {t(
            'Send your reference code to the TroCode team. When your access is approved, paste the activation code you receive below.',
          )}
        </p>

        <div className="membership-reference">
          <div>
            <span>{t('Your reference code')}</span>
            <strong>{status?.referenceCode ?? t('Unavailable')}</strong>
          </div>
          <button
            disabled={busy || !status?.referenceCode}
            onClick={() => void copyReferenceCode()}
            type="button"
          >
            {copyMessage ?? t('Copy')}
          </button>
        </div>

        {expiry && (
          <p className="membership-expiry">
            {t('Previous access ended on')} <strong>{expiry}</strong>.
          </p>
        )}

        <label className="membership-code-field" htmlFor="activation-code">
          <span>{t('Activation code')}</span>
          <textarea
            autoCapitalize="none"
            autoComplete="off"
            disabled={busy}
            id="activation-code"
            onChange={(event) => setActivationCode(event.target.value)}
            placeholder={t('Paste your activation code')}
            rows={4}
            spellCheck={false}
            value={activationCode}
          />
        </label>

        {(error || status?.state === 'error') && (
          <div className="membership-error" role="alert">
            <strong>{t('Membership needs attention')}</strong>
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
            {isActivating ? t('Activating…') : t('Activate membership')}
            {!isActivating && <span aria-hidden="true">→</span>}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onRefresh}
            type="button"
          >
            {isChecking ? t('Checking…') : t('Check again')}
          </button>
        </div>

        <button
          className="membership-sign-out"
          disabled={busy}
          onClick={onSignOut}
          type="button"
        >
          {isSigningOut ? t('Signing out…') : t('Use another Google account')}
        </button>
      </section>
    </main>
  );
}
