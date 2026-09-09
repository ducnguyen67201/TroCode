import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeSpaceSummary } from '../shared/contracts';

import {
  SpaceDetailPage,
  type SpaceDetailTab,
} from './SpaceDetailPage';

const space: KnowledgeSpaceSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Saturday Scratch',
  description: 'Build and review Scratch projects.',
  purposeLabel: 'Scratch class',
  role: 'participant',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

function render(
  role: KnowledgeSpaceSummary['role'],
  initialTab: SpaceDetailTab = 'library',
  overrides: Partial<KnowledgeSpaceSummary> = {},
): string {
  return renderToStaticMarkup(
    <SpaceDetailPage
      appLanguage="en"
      initialTab={initialTab}
      onBack={vi.fn()}
      space={{ ...space, ...overrides, role }}
    />,
  );
}

describe('SpaceDetailPage role presentation', () => {
  it('keeps teacher material and room controls out of the student surface', () => {
    const markup = render('participant');

    expect(markup).toContain('Your Teacher has not shared class materials yet.');
    expect(markup).toContain('Saturday Scratch');
    expect(markup).toContain('Class workspace');
    expect(markup).toContain('Materials and activities shared with this class.');
    expect(markup).not.toContain(
      'Materials, activities, and people for this class.',
    );
    expect(markup).not.toContain('Add files');
    expect(markup).not.toContain('Upload options');
    expect(markup).not.toContain('People');
    expect(markup).not.toContain('Activities</button>');
    expect(markup).toContain('Sessions');
  });

  it.each(['owner', 'facilitator'] as const)(
    'shows the intentional teacher progression for %s',
    (role) => {
      const markup = render(role);

      expect(markup).toContain('Add files');
      expect(markup).toContain('Add a folder');
      expect(markup).toContain('Upload options');
      expect(markup).toContain('Materials');
      expect(markup).toContain('Activities');
      expect(markup).toContain('Sessions');
      expect(markup).toContain('People');
      expect(markup).toContain('Start with what you teach');
      expect(markup).not.toContain('Add members');
      expect(markup).not.toContain('Content role');
    },
  );

  it('keeps roster language in the Teacher class identity', () => {
    const markup = render('owner', 'library', { description: '' });

    expect(markup).toContain(
      'Materials, activities, and people for this class.',
    );
    expect(markup).not.toContain(
      'Materials and activities shared with this class.',
    );
  });

  it('keeps member management inside the People section', () => {
    const markup = render('owner', 'people');

    expect(markup).toContain('Build the roster');
    expect(markup).toContain('Registered account emails');
    expect(markup).toContain('Add to class');
    expect(markup).not.toContain('Student join code');
  });

  it('places the student join code inside the class Session surface', () => {
    const markup = render('participant', 'sessions');

    expect(markup).toContain('Join your Teacher');
    expect(markup).toContain('Session code');
    expect(markup).toContain('Join Session');
    expect(markup).not.toContain('Open approved class links automatically');
  });

  it('makes Sessions the teacher launch surface', () => {
    const markup = render('owner', 'sessions');

    expect(markup).toContain('Open a Session lobby, invite learners, then start class.');
    expect(markup).toContain('New Session');
    expect(markup).not.toContain('Create room lobby');
    expect(markup).not.toContain('Direct assignment');
  });
});

it('places lesson controls after class identity and navigation, before materials', () => {
  const markup = renderToStaticMarkup(<SpaceDetailPage appLanguage="en" onBack={vi.fn()} space={space} lessonPanels={<section>Current lesson controls</section>} />);
  expect(markup.indexOf('class-workspace-identity')).toBeLessThan(markup.indexOf('Current lesson controls'));
  expect(markup.indexOf('role="tablist"')).toBeLessThan(markup.indexOf('Current lesson controls'));
  expect(markup.indexOf('Current lesson controls')).toBeLessThan(markup.indexOf('class="space-panel'));
});
