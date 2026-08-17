import { describe, expect, it, vi } from 'vitest';

import {
  MacOSSystemAudioMuteController,
  SystemAudioDuckingService,
  type SystemAudioMuteController,
} from './system-audio-ducking-service';

function createController(initialMuted: boolean): {
  controller: SystemAudioMuteController;
  getMuted: ReturnType<typeof vi.fn>;
  setMuted: ReturnType<typeof vi.fn>;
} {
  let muted = initialMuted;
  const getMuted = vi.fn(async () => muted);
  const setMuted = vi.fn(async (nextMuted: boolean) => {
    muted = nextMuted;
  });
  return { controller: { getMuted, setMuted }, getMuted, setMuted };
}

describe('SystemAudioDuckingService', () => {
  it('mutes system audio for a hold and restores an unmuted output', async () => {
    const { controller, getMuted, setMuted } = createController(false);
    const service = new SystemAudioDuckingService(controller);

    await service.setActive(true);
    await service.setActive(false);

    expect(getMuted).toHaveBeenCalledOnce();
    expect(setMuted).toHaveBeenNthCalledWith(1, true);
    expect(setMuted).toHaveBeenNthCalledWith(2, false);
  });

  it('preserves an output that was already muted before the hold', async () => {
    const { controller, getMuted, setMuted } = createController(true);
    const service = new SystemAudioDuckingService(controller);

    await service.setActive(true);
    await service.setActive(false);

    expect(getMuted).toHaveBeenCalledOnce();
    expect(setMuted).toHaveBeenCalledOnce();
    expect(setMuted).toHaveBeenCalledWith(true);
  });

  it('serializes a quick press and release so audio cannot remain muted', async () => {
    const { controller, setMuted } = createController(false);
    const service = new SystemAudioDuckingService(controller);

    await Promise.all([service.setActive(true), service.setActive(false)]);

    expect(setMuted.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps the restoration lease when the mute command reports failure', async () => {
    const getMuted = vi.fn(async () => false);
    const setMuted = vi
      .fn<(muted: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error('mute failed'))
      .mockResolvedValue(undefined);
    const service = new SystemAudioDuckingService({ getMuted, setMuted });

    await expect(service.setActive(true)).rejects.toThrow('mute failed');
    await service.setActive(false);

    expect(setMuted.mock.calls).toEqual([[true], [false]]);
  });

  it('does nothing when system-wide audio control is unsupported', async () => {
    const service = new SystemAudioDuckingService(null);

    expect(service.supported).toBe(false);
    await expect(service.setActive(true)).resolves.toBeUndefined();
    await expect(service.setActive(false)).resolves.toBeUndefined();
  });
});

describe('MacOSSystemAudioMuteController', () => {
  it('reads and writes the macOS output mute state', async () => {
    const runAppleScript = vi
      .fn<(script: string) => Promise<string>>()
      .mockResolvedValueOnce('false\n')
      .mockResolvedValue('');
    const controller = new MacOSSystemAudioMuteController(runAppleScript);

    await expect(controller.getMuted()).resolves.toBe(false);
    await controller.setMuted(true);

    expect(runAppleScript).toHaveBeenNthCalledWith(
      1,
      'output muted of (get volume settings)',
    );
    expect(runAppleScript).toHaveBeenNthCalledWith(
      2,
      'set volume output muted true',
    );
  });

  it('rejects an unexpected macOS response instead of guessing', async () => {
    const controller = new MacOSSystemAudioMuteController(async () => 'unknown');

    await expect(controller.getMuted()).rejects.toThrow('unexpected');
  });
});
