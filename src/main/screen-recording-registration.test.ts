import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  getSources: vi.fn(async () => [{ id: 'screen:0:0' }]),
}));

vi.mock('electron', () => ({
  desktopCapturer: { getSources: electronMock.getSources },
}));

import { registerScreenRecordingHost } from './screen-recording-registration';

describe('registerScreenRecordingHost', () => {
  it('requests the smallest real thumbnail and keeps capture data internal', async () => {
    await expect(registerScreenRecordingHost()).resolves.toBeUndefined();

    expect(electronMock.getSources).toHaveBeenCalledWith({
      fetchWindowIcons: false,
      thumbnailSize: { height: 1, width: 1 },
      types: ['screen'],
    });
  });
});
