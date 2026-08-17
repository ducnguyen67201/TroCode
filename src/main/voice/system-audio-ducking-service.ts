import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface SystemAudioMuteController {
  getMuted(): Promise<boolean>;
  setMuted(muted: boolean): Promise<void>;
}

type AppleScriptRunner = (script: string) => Promise<string>;

const executeFile = promisify(execFile);

async function runAppleScript(script: string): Promise<string> {
  const result = await executeFile('osascript', ['-e', script], {
    encoding: 'utf8',
  });
  return String(result.stdout);
}

export class MacOSSystemAudioMuteController
  implements SystemAudioMuteController
{
  constructor(
    private readonly executeAppleScript: AppleScriptRunner = runAppleScript,
  ) {}

  async getMuted(): Promise<boolean> {
    const output = (
      await this.executeAppleScript('output muted of (get volume settings)')
    )
      .trim()
      .toLowerCase();

    if (output === 'true') return true;
    if (output === 'false') return false;
    throw new Error('macOS returned an unexpected system audio mute state.');
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.executeAppleScript(
      `set volume output muted ${muted ? 'true' : 'false'}`,
    );
  }
}

export class SystemAudioDuckingService {
  private active = false;
  private previousMuted: boolean | null = null;
  private transition = Promise.resolve();

  constructor(
    private readonly controller: SystemAudioMuteController | null,
  ) {}

  get supported(): boolean {
    return this.controller !== null;
  }

  setActive(active: boolean): Promise<void> {
    const operation = this.transition.then(() => this.apply(active));
    this.transition = operation.catch(() => undefined);
    return operation;
  }

  private async apply(active: boolean): Promise<void> {
    if (!this.controller || active === this.active) return;

    if (active) {
      const previousMuted = await this.controller.getMuted();
      this.previousMuted = previousMuted;
      this.active = true;
      if (!previousMuted) await this.controller.setMuted(true);
      return;
    }

    if (this.previousMuted === null) return;
    await this.controller.setMuted(this.previousMuted);
    this.previousMuted = null;
    this.active = false;
  }
}

export function createSystemAudioDuckingService(
  platform: NodeJS.Platform = process.platform,
): SystemAudioDuckingService {
  return new SystemAudioDuckingService(
    platform === 'darwin' ? new MacOSSystemAudioMuteController() : null,
  );
}
