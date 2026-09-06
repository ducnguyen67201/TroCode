export interface TranscriptSegmentResult {
  overlapWithPrevious: boolean;
  sequence: number;
  text: string;
}

function normalizedToken(token: string): string {
  return token
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

export function joinTranscriptSegments(
  previous: string,
  current: string,
  overlapWithPrevious: boolean,
): string {
  const previousText = previous.trim();
  const currentText = current.trim();
  if (!previousText) return currentText;
  if (!currentText) return previousText;
  if (!overlapWithPrevious) return `${previousText} ${currentText}`;

  const previousTokens = previousText.split(/\s+/u);
  const currentTokens = currentText.split(/\s+/u);
  const maximum = Math.min(12, previousTokens.length, currentTokens.length);
  let overlap = 0;
  for (let size = maximum; size >= 2; size -= 1) {
    const previousSuffix = previousTokens.slice(-size).map(normalizedToken);
    const currentPrefix = currentTokens.slice(0, size).map(normalizedToken);
    if (
      previousSuffix.every(
        (token, index) => token.length > 0 && token === currentPrefix[index],
      )
    ) {
      overlap = size;
      break;
    }
  }

  return [previousText, currentTokens.slice(overlap).join(' ')]
    .filter(Boolean)
    .join(' ');
}

export class OrderedTranscriptAssembler {
  readonly #outcomes = new Map<number, TranscriptOutcome>();

  addSuccess(result: TranscriptSegmentResult): void {
    this.#outcomes.set(result.sequence, { ok: true, result });
  }

  addFailure(sequence: number, error: Error): void {
    this.#outcomes.set(sequence, { ok: false, error });
  }

  get outcomes(): ReadonlyMap<number, TranscriptOutcome> {
    return this.#outcomes;
  }

  provisionalTranscript(): string {
    let transcript = '';
    for (let sequence = 0; ; sequence += 1) {
      const outcome = this.#outcomes.get(sequence);
      if (!outcome?.ok) break;
      transcript = joinTranscriptSegments(
        transcript,
        outcome.result.text,
        outcome.result.overlapWithPrevious,
      );
    }
    return transcript;
  }

  completeTranscript(expectedSegmentCount: number): string | null {
    if (
      expectedSegmentCount <= 0 ||
      this.#outcomes.size < expectedSegmentCount
    ) {
      return null;
    }
    let transcript = '';
    for (let sequence = 0; sequence < expectedSegmentCount; sequence += 1) {
      const outcome = this.#outcomes.get(sequence);
      if (!outcome?.ok) return null;
      transcript = joinTranscriptSegments(
        transcript,
        outcome.result.text,
        outcome.result.overlapWithPrevious,
      );
    }
    return transcript;
  }
}

type TranscriptOutcome =
  { ok: true; result: TranscriptSegmentResult } | { ok: false; error: Error };
