import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DesktopControlIndicator } from './DesktopControlIndicator';

describe('desktop control indicator', () => {
  it('renders a visible status border without interactive controls', () => {
    const markup = renderToStaticMarkup(createElement(DesktopControlIndicator));

    expect(markup).toContain('desktop-control-indicator');
    expect(markup).toContain('TroCode is controlling');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('tabindex');
  });
});
