import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MembershipGate } from './MembershipGate';

describe('MembershipGate Free onboarding', () => {
  it('requires a choice while offering access code and Free paths', () => {
    const markup = renderToStaticMarkup(
      <MembershipGate
        appLanguage="en"
        error={null}
        isActivating={false}
        isChecking={false}
        isContinuingFree={false}
        isSigningOut={false}
        onActivate={vi.fn()}
        onContinueFree={vi.fn()}
        onRefresh={vi.fn()}
        onSignOut={vi.fn()}
        status={{
          expiresAt: null,
          plan: 'free',
          referenceCode: null,
          required: true,
          state: 'inactive',
          summary: 'Enter an access code or continue with Free.',
        }}
      />,
    );

    expect(markup).toContain('Continue with access code');
    expect(markup).toContain('Continue with Free');
    expect(markup).toContain('Final setup step');
  });
});
