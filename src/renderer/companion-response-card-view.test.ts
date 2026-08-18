import { randomUUID } from 'node:crypto';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionResponseCard as CompanionResponse } from '../shared/contracts';

import {
  CompanionResponseCard,
  getCompanionCalloutKind,
  getCompanionResponseNumberAction,
  getCompanionResponseStatus,
} from './CompanionResponseCard';

function response(
  overrides: Partial<CompanionResponse> = {},
): CompanionResponse {
  return {
    cardId: randomUUID(),
    message: 'I found the latest message and summarized it for you.',
    phase: 'completed',
    side: 'right',
    taskId: randomUUID(),
    ...overrides,
  };
}

function renderResponse(
  value: CompanionResponse,
  audioStatus: Parameters<typeof CompanionResponseCard>[0]['audioStatus'] = null,
): string {
  return renderToStaticMarkup(
    createElement(CompanionResponseCard, {
      audioStatus,
      onAction: vi.fn(),
      response: value,
    }),
  );
}

describe('companion response card view', () => {
  it('keeps approval or clarification above guidance and responses', () => {
    expect(
      getCompanionCalloutKind({
        hasGuidance: true,
        hasInteraction: true,
        hasResponse: true,
      }),
    ).toBe('interaction');
    expect(
      getCompanionCalloutKind({
        hasGuidance: true,
        hasInteraction: false,
        hasResponse: true,
      }),
    ).toBe('guidance');
    expect(
      getCompanionCalloutKind({
        hasGuidance: false,
        hasInteraction: false,
        hasResponse: true,
      }),
    ).toBe('response');
  });

  it('announces streaming responses in a labelled, polite region', () => {
    const markup = renderResponse(response({ phase: 'streaming' }));

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-labelledby="companion-response-title"');
    expect(markup).toContain('id="companion-response-title"');
    expect(markup).toContain('Responding');
  });

  it('keeps streaming responses read-only until the completed card is interactive', () => {
    const markup = renderResponse(response({ phase: 'streaming' }));

    expect(markup).not.toContain('>Done</button>');
    expect(markup).not.toContain('>Open task</button>');
    expect(markup).not.toContain('>Ask follow-up</button>');
    expect(markup).not.toContain('>Read aloud</button>');
  });

  it('renders model output only as plain text and never turns URLs into actions', () => {
    const markup = renderResponse(
      response({
        message:
          '<img src=x onerror=alert(1)> Visit https://malicious.example now.\nSecond line.',
      }),
    );

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<a href');
    expect(markup).toContain('https://malicious.example');
    expect(markup).toContain('companion-response-card__message');
  });

  it('offers fixed, keyboard-native response controls', () => {
    const markup = renderResponse(response());

    expect(markup).toContain('aria-keyshortcuts="1"');
    expect(markup).toContain('<kbd>1</kbd>Done');
    expect(markup).toContain('aria-keyshortcuts="2"');
    expect(markup).toContain('<kbd>2</kbd>Open task');
    expect(markup).toContain('aria-keyshortcuts="3"');
    expect(markup).toContain('<kbd>3</kbd>Ask follow-up');
    expect(markup).toContain('aria-keyshortcuts="4"');
    expect(markup).toContain('<kbd>4</kbd>Read aloud');
    expect(markup).not.toContain('href=');
  });

  it('maps unmodified number keys to the four visible response actions', () => {
    const key = (value: string) => ({
      altKey: false,
      ctrlKey: false,
      key: value,
      metaKey: false,
      repeat: false,
      shiftKey: false,
      target: null,
    });

    expect(getCompanionResponseNumberAction(key('1'), 'read_aloud')).toBe(
      'dismiss',
    );
    expect(getCompanionResponseNumberAction(key('2'), 'read_aloud')).toBe(
      'open_task',
    );
    expect(getCompanionResponseNumberAction(key('3'), 'read_aloud')).toBe(
      'ask_follow_up',
    );
    expect(getCompanionResponseNumberAction(key('4'), 'stop_reading')).toBe(
      'stop_reading',
    );
    expect(
      getCompanionResponseNumberAction(
        { ...key('1'), metaKey: true },
        'read_aloud',
      ),
    ).toBeNull();
    expect(getCompanionResponseNumberAction(key('5'), 'read_aloud')).toBeNull();
  });

  it('shows Stop while speech is active and reports the active voice source', () => {
    expect(getCompanionResponseStatus('completed', 'speaking')).toBe(
      'Speaking',
    );
    expect(getCompanionResponseStatus('completed', 'fallback')).toBe(
      'Fallback voice',
    );

    const markup = renderResponse(response(), 'speaking');

    expect(markup).toContain('Speaking');
    expect(markup).toContain('<kbd>4</kbd>Stop');
    expect(markup).not.toContain('<kbd>4</kbd>Read aloud');
  });
});
