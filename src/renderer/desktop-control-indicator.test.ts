import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  DesktopControlIndicator,
  guidanceConnectorGeometry,
} from './DesktopControlIndicator';

describe('desktop control indicator', () => {
  it('renders a visible status border without interactive controls', () => {
    const markup = renderToStaticMarkup(createElement(DesktopControlIndicator));

    expect(markup).toContain('desktop-control-indicator');
    expect(markup).toContain('Tro is controlling');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('tabindex');
  });

  it('curves from the companion to the nearest edge of the target', () => {
    expect(
      guidanceConnectorGeometry({
        companion: { x: 100, y: 200 },
        moving: true,
        target: { x: 500, y: 250, width: 200, height: 100 },
      }),
    ).toEqual({
      end: { x: 500, y: 300 },
      path: 'M 100 200 Q 318 178 500 300',
    });
  });
});
