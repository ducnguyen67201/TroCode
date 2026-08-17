interface KeyboardChord {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function getFocusedApprovalShortcut(
  event: KeyboardChord,
): 'approve' | 'deny' | null {
  const hasCommandModifier = event.metaKey !== event.ctrlKey;
  if (!hasCommandModifier || !event.shiftKey || event.altKey) return null;
  if (event.key === 'Enter') return 'approve';
  if (event.key === 'Backspace') return 'deny';
  return null;
}

export function isApprovalExpired(
  expiresAt: string,
  now = Date.now(),
): boolean {
  return now >= Date.parse(expiresAt);
}
