import { describe, expect, it } from 'vitest';

import { desktopActionOutcome } from './desktop-action-outcome';

describe('desktop action recovery receipts', () => {
  it.each(['click', 'keypress', 'scroll'])('preserves observe recovery for %s', (kind) => {
    expect(desktopActionOutcome(kind, { isError: false, text: 'Input sent.', action: { effect: 2 } }))
      .toMatchObject({ status: 'unknown', recovery: 'observe' });
  });
  it('does not make failed, refused, or missing receipts recoverable', () => {
    for (const result of [{ isError: true, text: 'Failed.' }, { isError: false, text: 'Refused.', action: { effect: 4 } }, { isError: false, text: 'No receipt.' }])
      expect(desktopActionOutcome('click', result).recovery).toBeUndefined();
  });
});
