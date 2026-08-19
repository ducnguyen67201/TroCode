import { describe, expect, it } from 'vitest';

import {
  advanceWalkthrough,
  createWalkthroughState,
  evaluateWalkthroughTool,
  parseWalkthroughCompletion,
  requestsGuidedWalkthrough,
} from './walkthrough-policy';

describe('guided walkthrough policy', () => {
  it.each([
    'Guide me through this exercise.',
    'Walk me through filtering my inbox.',
    'Teach me step by step how to use this form.',
    'Give me guidance on how to do this exercise.',
    'Show me how to do this in the app.',
    'Help me do this assignment myself.',
    'Let me solve this exercise myself.',
    'I want to complete this on-screen task myself.',
    'Guide how to do this form.',
    'Hướng dẫn tôi từng bước làm bài này.',
    'Chỉ mình từng bước cách lọc email.',
    'Dạy em từng bước cách làm bài.',
    'Chỉ cho tôi cách làm việc này.',
    'Hướng dẫn cách làm bài này.',
    'Giúp tôi tự làm bài tập này.',
    'Để tôi tự làm bài này.',
    'Tôi muốn tự giải bài tập này.',
    'Show me each area and explain it, then continue.',
    'Point to each question and walk me through it.',
    'Circle the relevant area, explain it, and move to the next one.',
    'Point here, explain, then continue one area at a time.',
    'Chỉ vào từng phần rồi giải thích, sau đó tiếp tục.',
    'Khoanh vùng từng câu, giải thích rồi chuyển sang câu tiếp theo.',
  ])('recognizes explicit user-controlled tutoring intent: %s', (request) => {
    expect(requestsGuidedWalkthrough(request)).toBe(true);
  });

  it.each([
    'Explain this exercise.',
    'Solve this equation step by step.',
    'Write a step-by-step guide for onboarding.',
    'Open Gmail and read the latest email.',
    'Giải thích bài tập này.',
    'Giải thích cách làm bài tập này.',
    'Teach me about the present simple tense.',
    'Help me understand this explanation myself.',
    'Viết hướng dẫn sử dụng cho khách hàng.',
    'I remember OpenClicky used to circle areas, explain them, then continue.',
    'Highlights should use arrows when a walkthrough is active.',
    'Tôi nhớ ứng dụng từng khoanh vùng rồi giải thích từng phần.',
  ])('keeps ordinary text work on the direct path: %s', (request) => {
    expect(requestsGuidedWalkthrough(request)).toBe(false);
  });

  it('requires a fresh observation before exactly one guidance call', () => {
    const initial = createWalkthroughState('Guide me through this form.');
    expect(initial).toMatchObject({ enabled: true, phase: 'needs_observation' });
    expect(evaluateWalkthroughTool(initial, 'show_guidance').allowed).toBe(false);
    expect(evaluateWalkthroughTool(initial, 'observe_desktop').allowed).toBe(true);

    const observed = advanceWalkthrough(initial, 'observe_desktop');
    expect(observed.phase).toBe('needs_guidance');
    expect(evaluateWalkthroughTool(observed, 'observe_desktop').allowed).toBe(
      false,
    );
    expect(evaluateWalkthroughTool(observed, 'show_guidance').allowed).toBe(true);

    const guided = advanceWalkthrough(observed, 'show_guidance');
    expect(guided).toMatchObject({
      completedSteps: 1,
      phase: 'needs_observation',
    });
  });

  it('does not constrain tools for a normal direct request', () => {
    const direct = createWalkthroughState('Explain this exercise.');
    expect(direct.enabled).toBe(false);
    expect(evaluateWalkthroughTool(direct, 'show_guidance').allowed).toBe(true);
    expect(advanceWalkthrough(direct, 'show_guidance')).toEqual(direct);
  });

  it('accepts only an exact, concise, single-line, non-list completion sentinel', () => {
    expect(
      parseWalkthroughCompletion(
        'WALKTHROUGH_COMPLETE: You completed the guided exercise.',
      ),
    ).toBe('You completed the guided exercise.');
    expect(
      parseWalkthroughCompletion('Here are all fourteen answers at once.'),
    ).toBeNull();
    expect(
      parseWalkthroughCompletion(
        'WALKTHROUGH_COMPLETE: 1. First answer 2. Second answer',
      ),
    ).toBeNull();
    expect(
      parseWalkthroughCompletion(
        'WALKTHROUGH_COMPLETE: Finished step one.\nHere are the remaining steps.',
      ),
    ).toBeNull();
    expect(
      parseWalkthroughCompletion(
        `WALKTHROUGH_COMPLETE: ${'A'.repeat(181)}`,
      ),
    ).toBeNull();
  });
});
