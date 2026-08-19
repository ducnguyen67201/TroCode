import { describe, expect, it } from 'vitest';

import { classifyActionRisk } from './action-risk-classifier';
import { createTaskContract } from './task-contract';

const routineClick = {
  action: 'click_element' as const,
  toolId: 'desktop.control' as const,
  operation: 'click',
  description: 'Open the visible inbox row.',
  target: 'Newest inbox row',
};

describe('ActionRiskClassifier', () => {
  it('allows routine desktop work under balanced autonomy', () => {
    expect(
      classifyActionRisk(createTaskContract('Open the newest email.'), routineClick),
    ).toMatchObject({ level: 'routine' });
  });

  it.each([
    ['click_element', 'click'],
    ['drag', 'drag'],
    ['type_text', 'type_text'],
    ['press_key', 'keypress'],
    ['scroll', 'scroll'],
  ] as const)(
    'keeps strict confirmation for routine desktop %s mutations',
    (action, operation) => {
      expect(
        classifyActionRisk(
          createTaskContract('Open the newest email.', { autonomyMode: 'strict' }),
          { ...routineClick, action, operation },
        ),
      ).toMatchObject({ level: 'sensitive' });
    },
  );

  it('lets host-visible cues raise risk but never lets benign text lower a declared consequence', () => {
    const contract = createTaskContract('Handle the displayed message.');
    expect(
      classifyActionRisk(contract, {
        ...routineClick,
        description: 'Click the visible Submit button.',
      }).level,
    ).toBe('sensitive');
    expect(
      classifyActionRisk(contract, {
        ...routineClick,
        description: 'A totally routine action.',
        parameters: { declaredConsequence: 'send' },
      }).level,
    ).toBe('sensitive');
  });

  it('does not treat reversible draft contents as the consequence of typing', () => {
    expect(
      classifyActionRisk(createTaskContract('Draft a reply.'), {
        action: 'type_text',
        description: 'Type the requested draft into the reply editor.',
        operation: 'type_text',
        parameters: {
          declaredConsequence: 'type_text',
          text: 'Please send the private document after we approve it.',
        },
        target: 'Reply body editor',
        toolId: 'desktop.control',
      }),
    ).toMatchObject({ level: 'routine' });
  });

  it('applies the same monotonic risk rules to semantic computer control', () => {
    expect(
      classifyActionRisk(createTaskContract('Work with the current editor.'), {
        action: 'click_element',
        toolId: 'computer.control',
        operation: 'click_element',
        description: 'Click the visible control.',
        parameters: {
          application: 'Chrome',
          ariaLabel: 'Submit solution',
          declaredConsequence: 'click_element',
        },
      }),
    ).toMatchObject({ level: 'sensitive' });
  });
});
