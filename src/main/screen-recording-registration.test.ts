import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  Reflect.set(
    globalThis,
    'SCREEN_RECORDING_WEBPACK_ENTRY',
    'file:///app/screen-recording/index.html',
  );
  const screenSource = { id: 'screen:0:0' };
  const state: {
    displayMediaHandler?: (
      request: {
        audioRequested: boolean;
        frame: unknown;
        userGesture: boolean;
        videoRequested: boolean;
      },
      callback: (streams: { video?: unknown }) => void,
    ) => void;
  } = {};
  const registrationSession = {
    setDisplayMediaRequestHandler: vi.fn((handler) => {
      state.displayMediaHandler = handler ?? undefined;
    }),
    setPermissionRequestHandler: vi.fn((handler) => {
      void handler;
    }),
  };
  const webContents: {
    executeJavaScript: ReturnType<typeof vi.fn>;
    mainFrame: object;
    session: typeof registrationSession;
  } = {
    executeJavaScript: vi.fn(),
    mainFrame: {},
    session: registrationSession,
  };
  const registrationWindow = {
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(async () => undefined),
    webContents,
  };

  return {
    BrowserWindow: vi.fn(function BrowserWindow(options: {
      webPreferences?: { partition?: string };
    }) {
      void options;
      return registrationWindow;
    }),
    getSources: vi.fn(async () => [screenSource]),
    registrationSession,
    registrationWindow,
    screenSource,
    state,
    webContents,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  desktopCapturer: { getSources: electronMock.getSources },
}));

import { registerScreenRecordingHost } from './screen-recording-registration';

describe('registerScreenRecordingHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMock.state.displayMediaHandler = undefined;
    electronMock.registrationWindow.isDestroyed.mockReturnValue(false);
    electronMock.webContents.executeJavaScript.mockImplementation(
      async (_script: string, userGesture: boolean) => {
        expect(userGesture).toBe(true);

        await new Promise<void>((resolve, reject) => {
          electronMock.state.displayMediaHandler?.(
            {
              audioRequested: false,
              frame: electronMock.webContents.mainFrame,
              userGesture,
              videoRequested: true,
            },
            (streams) => {
              if (streams.video === electronMock.screenSource) resolve();
              else reject(new Error('Expected the first screen source.'));
            },
          );
        });

        return true;
      },
    );
  });

  it('starts a bounded capture in an isolated sandboxed renderer', async () => {
    await expect(registerScreenRecordingHost()).resolves.toBeUndefined();

    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          partition: expect.stringMatching(/^screen-recording-registration-/),
          sandbox: true,
        }),
      }),
    );
    const partition = electronMock.BrowserWindow.mock.calls[0]?.[0]
      ?.webPreferences?.partition;
    expect(partition).not.toMatch(/^persist:/);
    expect(electronMock.registrationWindow.loadURL).toHaveBeenCalledWith(
      'file:///app/screen-recording/index.html',
    );
    expect(electronMock.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('navigator.mediaDevices.getDisplayMedia'),
      true,
    );
    expect(electronMock.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('track.stop()'),
      true,
    );
    expect(electronMock.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('video.srcObject = stream'),
      true,
    );
    expect(electronMock.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('requestVideoFrameCallback'),
      true,
    );
    expect(electronMock.getSources).toHaveBeenCalledWith({
      fetchWindowIcons: false,
      thumbnailSize: { height: 0, width: 0 },
      types: ['screen'],
    });
    expect(
      electronMock.registrationSession.setPermissionRequestHandler,
    ).not.toHaveBeenCalled();
  });

  it('rejects display-media requests outside the isolated main frame', async () => {
    await registerScreenRecordingHost();

    const displayMediaHandler = electronMock.registrationSession
      .setDisplayMediaRequestHandler.mock.calls[0]?.[0];
    expect(displayMediaHandler).toBeTypeOf('function');

    for (const request of [
      {
        audioRequested: false,
        frame: {},
        userGesture: true,
        videoRequested: true,
      },
      {
        audioRequested: true,
        frame: electronMock.webContents.mainFrame,
        userGesture: true,
        videoRequested: true,
      },
      {
        audioRequested: false,
        frame: electronMock.webContents.mainFrame,
        userGesture: true,
        videoRequested: false,
      },
    ]) {
      const callback = vi.fn();
      await displayMediaHandler(request, callback);
      expect(callback).toHaveBeenCalledWith({});
    }
  });

  it('removes the temporary handlers and window after a capture failure', async () => {
    electronMock.webContents.executeJavaScript.mockRejectedValueOnce(
      new Error('screen capture denied'),
    );

    await expect(registerScreenRecordingHost()).rejects.toThrow(
      'screen capture denied',
    );

    expect(
      electronMock.registrationSession.setDisplayMediaRequestHandler,
    ).toHaveBeenLastCalledWith(null);
    expect(electronMock.registrationWindow.destroy).toHaveBeenCalledOnce();
  });
});
