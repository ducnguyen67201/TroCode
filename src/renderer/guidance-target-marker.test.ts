import { resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { readStylesheet } from '../test-support/read-stylesheet';

import { GuidanceTargetMarker } from './GuidanceTargetMarker';

describe('guidance target marker', () => {
  it('renders a glass ring, curved pointer, and center target without input', () => {
    const markup = renderToStaticMarkup(createElement(GuidanceTargetMarker));

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('guidance-target-marker__ring');
    expect(markup).toContain('guidance-target-marker__highlight');
    expect(markup).toContain('guidance-target-marker__pointer');
    expect(markup).toContain('guidance-target-marker__pointer-line');
    expect(markup).toContain('guidance-target-marker__target');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('tabindex');
  });

  it('keeps the teaching target steady instead of blinking or shimmering', () => {
    const css = readStylesheet(resolve(__dirname, '../index.css'));

    expect(css).toMatch(
      /\.guidance-target-marker__highlight\s*\{[^}]*display: none;/u,
    );
    expect(css).not.toContain('guidance-target-pulse');
    expect(css).not.toContain('guidance-target-highlight');
  });
});
