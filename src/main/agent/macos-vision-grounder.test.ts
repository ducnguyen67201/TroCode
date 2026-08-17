import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  DesktopActionDecision,
  DesktopObservation,
} from './execution-contracts';
import {
  groundNumberedGuidancePoint,
  parseMacOSVisionOutput,
} from './macos-vision-grounder';

function observation(): DesktopObservation {
  return {
    observationId: randomUUID(),
    taskId: randomUUID(),
    capturedAt: new Date().toISOString(),
    text: 'English worksheet',
    screenshot: { mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
    coordinateSpace: {
      screenHeight: 1_117,
      screenWidth: 1_728,
      screenshotHeight: 2_234,
      screenshotWidth: 3_456,
    },
    degraded: false,
    fingerprint: 'f'.repeat(64),
  };
}

function pointDecision(observationId: string): DesktopActionDecision {
  return {
    kind: 'action',
    observationId,
    intent: 'guide',
    capability: 'computer_use',
    description: 'Look at Question 1 and fill in its first blank.',
    target: 'Question 1',
    guidanceSequence: { index: 1, total: 13 },
    command: { kind: 'point', x: 700, y: 1_400 },
  };
}

describe('macOS Vision guidance grounding', () => {
  it('parses bounded helper output', () => {
    expect(
      parseMacOSVisionOutput(
        '[{"confidence":0.98,"height":0.02,"text":"1. Where","width":0.08,"x":0.4,"y":0.6}]',
      ),
    ).toEqual([
      {
        confidence: 0.98,
        height: 0.02,
        text: '1. Where',
        width: 0.08,
        x: 0.4,
        y: 0.6,
      },
    ]);
  });

  it('places a numbered teaching point inside the first blank after its OCR prefix', () => {
    const desktop = observation();
    const grounded = groundNumberedGuidancePoint(
      pointDecision(desktop.observationId),
      desktop,
      [
        {
          confidence: 0.99,
          height: 0.013486163789071193,
          text: '1. Where',
          width: 0.034883719903451404,
          x: 0.4258720932943983,
          y: 0.667412712641566,
        },
        {
          confidence: 0.99,
          height: 0.013552553011246138,
          text: '2. What he (do)',
          width: 0.05813953170069941,
          x: 0.4258720953415107,
          y: 0.635955056490711,
        },
      ],
    );

    expect(grounded).toEqual({
      matchedText: '1. Where',
      point: { x: 1_653, y: 728 },
      source: 'macos_vision_text',
    });
  });

  it('does not alter click actions or unnumbered targets', () => {
    const desktop = observation();
    const decision = pointDecision(desktop.observationId);

    expect(
      groundNumberedGuidancePoint(
        {
          ...decision,
          description: 'Look at the highlighted sentence.',
          target: 'Highlighted sentence',
          guidanceSequence: undefined,
        },
        desktop,
        [
          {
            confidence: 0.99,
            height: 0.02,
            text: '1. Where',
            width: 0.08,
            x: 0.4,
            y: 0.6,
          },
        ],
      ),
    ).toBeNull();
  });

  it('matches a numbered OCR line even when punctuation is omitted', () => {
    const desktop = observation();
    const decision = {
      ...pointDecision(desktop.observationId),
      description: 'does; is — Use “does” with “she” and “is” for her job.',
      target: 'Question 3 input field',
      guidanceSequence: { index: 3, total: 13 },
    };

    expect(
      groundNumberedGuidancePoint(decision, desktop, [
        {
          confidence: 0.98,
          height: 0.014,
          text: '3 What',
          width: 0.032,
          x: 0.426,
          y: 0.607,
        },
      ]),
    ).toMatchObject({
      matchedText: '3 What',
      source: 'macos_vision_text',
    });
  });
});
