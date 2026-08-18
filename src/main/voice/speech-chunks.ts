const DEFAULT_MAX_CHUNK_CHARACTERS = 240;

const SENTENCE_END = /[.!?。！？](?:["'”’)]*)\s/gu;

export function splitSpeechText(
  rawText: string,
  maxChunkCharacters = DEFAULT_MAX_CHUNK_CHARACTERS,
): string[] {
  if (!Number.isInteger(maxChunkCharacters) || maxChunkCharacters < 1) {
    throw new Error('Speech chunk size must be a positive integer.');
  }

  let remaining = rawText.trim().replace(/\s+/gu, ' ');
  const chunks: string[] = [];
  while (remaining.length > maxChunkCharacters) {
    const window = remaining.slice(0, maxChunkCharacters + 1);
    let splitAt = lastSentenceBoundary(window, maxChunkCharacters);
    if (splitAt < 1) splitAt = window.lastIndexOf(' ', maxChunkCharacters);
    if (splitAt < 1) splitAt = maxChunkCharacters;

    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function lastSentenceBoundary(text: string, limit: number): number {
  let boundary = -1;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].trimEnd().length;
    if (end <= limit) boundary = end;
  }
  return boundary;
}
