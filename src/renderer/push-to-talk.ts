export type PushToTalkPlatform = 'macos' | 'unsupported' | 'windows';

export function detectPushToTalkPlatform(
  navigatorPlatform: string,
  userAgent: string,
): PushToTalkPlatform {
  const platformDescription = `${navigatorPlatform} ${userAgent}`.toLowerCase();
  if (platformDescription.includes('mac')) return 'macos';
  if (platformDescription.includes('win')) return 'windows';
  return 'unsupported';
}

export function isPushToTalkChord(
  platform: PushToTalkPlatform,
  pressedCodes: ReadonlySet<string>,
): boolean {
  if (platform === 'macos') {
    const commandPressed =
      pressedCodes.has('MetaLeft') || pressedCodes.has('MetaRight');
    const controlPressed =
      pressedCodes.has('ControlLeft') || pressedCodes.has('ControlRight');
    return commandPressed && controlPressed;
  }
  if (platform === 'windows') {
    return pressedCodes.has('AltLeft') && pressedCodes.has('ControlLeft');
  }
  return false;
}

export function pushToTalkShortcutName(platform: PushToTalkPlatform): string {
  if (platform === 'windows') return 'left Alt + left Control';
  return 'Command + Control';
}

export function globalPushToTalkShortcutName(
  platform: PushToTalkPlatform,
): string | null {
  if (platform === 'windows') return 'Ctrl + Alt + Space';
  if (platform === 'macos') return 'Command + Control';
  return null;
}
