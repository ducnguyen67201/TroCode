import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ClassSessionsPanel } from './ClassSessionsPanel';

describe('ClassSessionsPanel', () => {
  it('gives Teachers one Session-level launch action', () => {
    const markup = renderToStaticMarkup(
      <ClassSessionsPanel
        appLanguage="en"
        canFacilitate
        refreshToken={0}
        spaceId="11111111-1111-4111-8111-111111111111"
      />,
    );

    expect(markup).toContain('Sessions');
    expect(markup).toContain('New Session');
    expect(markup).toContain('Open a Session lobby, invite learners, then start class.');
    expect(markup).not.toContain('Direct assignment');
    expect(markup).not.toContain('Create room lobby');
  });

  it('keeps the student join action inside the selected class', () => {
    const onJoined = vi.fn();
    const markup = renderToStaticMarkup(
      <ClassSessionsPanel
        appLanguage="en"
        canFacilitate={false}
        onJoined={onJoined}
        refreshToken={0}
        spaceId="11111111-1111-4111-8111-111111111111"
      />,
    );

    expect(markup).toContain('Session code');
    expect(markup).toContain('Join Session');
    expect(markup).toContain('All Activities for this Session');
    expect(markup).not.toContain('Open approved class links automatically');
    expect(onJoined).not.toHaveBeenCalled();
  });
});
