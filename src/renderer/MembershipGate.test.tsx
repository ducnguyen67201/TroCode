import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MembershipGate } from './MembershipGate';

describe('MembershipGate Free onboarding', () => {
  it.each([
    ['inactive', 'Enter an access code or continue with Free.'],
    ['error', "Your teacher's access code has no seats available. Ask your teacher to increase capacity."],
    ['error', "Your teacher's access code is paused. Ask your teacher to restore access."],
    ['error', 'Your classes use different access codes. Ask your teacher to confirm your access.'],
  ] as const)('offers Free for %s membership: %s', (state, summary) => {
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
          state,
          summary,
        }}
      />,
    );

    expect(markup).toContain('Continue with access code');
    expect(markup).toContain('Continue with Free');
    expect(markup).toContain('Final setup step');
    if (state === 'error') {
      expect(markup).toContain('Membership needs attention');
      expect(markup).toContain('role="alert"');
    }
  });
});
