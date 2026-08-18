import { describe, expect, it } from 'vitest';

import { splitSpeechText } from './speech-chunks';

describe('splitSpeechText', () => {
  it('keeps short narration in one chunk and normalizes whitespace', () => {
    expect(splitSpeechText('  Task\n\ncompleted.  ')).toEqual([
      'Task completed.',
    ]);
  });

  it('prefers sentence boundaries and never exceeds the limit', () => {
    const chunks = splitSpeechText(
      'The first sentence is complete. The second sentence also has useful detail.',
      38,
    );

    expect(chunks).toEqual([
      'The first sentence is complete.',
      'The second sentence also has useful',
      'detail.',
    ]);
    expect(chunks.every((chunk) => chunk.length <= 38)).toBe(true);
  });

  it('hard-splits an uninterrupted token', () => {
    expect(splitSpeechText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('rejects invalid chunk sizes', () => {
    expect(() => splitSpeechText('hello', 0)).toThrow(
      'Speech chunk size must be a positive integer.',
    );
  });
});
