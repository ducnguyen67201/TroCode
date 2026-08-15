import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
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
    permissionHandler?: (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
      details: { isMainFrame: boolean },
    ) => void;
  } = {};
  const registrationSession = {
    setDisplayMediaRequestHandler: vi.fn((handler) => {
      state.displayMediaHandler = handler ?? undefined;
    }),
    setPermissionRequestHandler: vi.fn((handler) => {
      state.permissionHandler = handler ?? undefined;
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
    electronMock.state.permissionHandler = undefined;
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

  it('starts and immediately stops capture in an isolated sandboxed renderer', async () => {
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
      expect.stringMatching(/^data:text\/html/),
    );
    expect(electronMock.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('navigator.mediaDevices.getDisplayMedia'),
      true,
    );
    expect(electronMock.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('track.stop()'),
      true,
    );
    expect(electronMock.getSources).toHaveBeenCalledWith({
      fetchWindowIcons: false,
      thumbnailSize: { height: 0, width: 0 },
      types: ['screen'],
    });
  });

  it('grants display capture only to its own main frame', async () => {
    await registerScreenRecordingHost();

    const permissionHandler = electronMock.registrationSession
      .setPermissionRequestHandler.mock.calls[0]?.[0];
    expect(permissionHandler).toBeTypeOf('function');

    const ownDecision = vi.fn();
    permissionHandler(
      electronMock.webContents,
      'display-capture',
      ownDecision,
      { isMainFrame: true },
    );
    expect(ownDecision).toHaveBeenCalledWith(true);

    for (const [contents, permission, details] of [
      [{}, 'display-capture', { isMainFrame: true }],
      [electronMock.webContents, 'media', { isMainFrame: true }],
      [electronMock.webContents, 'display-capture', { isMainFrame: false }],
    ] as const) {
      const decision = vi.fn();
      permissionHandler(contents, permission, decision, details);
      expect(decision).toHaveBeenCalledWith(false);
    }
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
        userGesture: false,
        videoRequested: true,
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
    expect(
      electronMock.registrationSession.setPermissionRequestHandler,
    ).toHaveBeenLastCalledWith(null);
    expect(electronMock.registrationWindow.destroy).toHaveBeenCalledOnce();
  });
});
