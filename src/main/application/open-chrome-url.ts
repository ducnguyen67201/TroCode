import { spawn } from 'node:child_process';

/** Native argument vectors only. The caller selects an installed Chrome path and validates the URL. */
export function openChromeUrl(target: string, url: string, platform: NodeJS.Platform): Promise<void> {
  if (platform !== 'darwin' && platform !== 'win32')
    return Promise.reject(new Error('Unsupported lesson browser platform.'));
  return new Promise((resolve, reject) => {
    const child = spawn(
      platform === 'darwin' ? '/usr/bin/open' : target,
      platform === 'darwin' ? ['-a', target, url] : [url],
      { detached: true, stdio: 'ignore', shell: false },
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
