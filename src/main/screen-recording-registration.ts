import { BrowserWindow, desktopCapturer } from 'electron';
import { randomUUID } from 'node:crypto';

const CAPTURE_TIMEOUT_MS = 10_000;
const REGISTRATION_PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<!doctype html><meta charset="utf-8"><title>TroCode permission setup</title>',
  );
const START_AND_STOP_CAPTURE_SCRIPT = `
  (async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });
    for (const track of stream.getTracks()) track.stop();
    return true;
  })()
`;

async function runCaptureRequest(registrationWindow: BrowserWindow): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      registrationWindow.webContents.executeJavaScript(
        START_AND_STOP_CAPTURE_SCRIPT,
        true,
      ),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Timed out while requesting screen recording access.'));
        }, CAPTURE_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function registerScreenRecordingHost(): Promise<void> {
  const registrationWindow = new BrowserWindow({
    height: 1,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `screen-recording-registration-${randomUUID()}`,
      sandbox: true,
    },
    width: 1,
  });
  const registrationSession = registrationWindow.webContents.session;

  registrationSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        webContents === registrationWindow.webContents &&
          permission === 'display-capture' &&
          details.isMainFrame,
      );
    },
  );
  registrationSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (
        request.frame !== registrationWindow.webContents.mainFrame ||
        !request.videoRequested ||
        request.audioRequested ||
        !request.userGesture
      ) {
        callback({});
        return;
      }

      try {
        const sources = await desktopCapturer.getSources({
          fetchWindowIcons: false,
          thumbnailSize: { height: 0, width: 0 },
          types: ['screen'],
        });
        callback(sources[0] ? { video: sources[0] } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false },
  );

  try {
    await registrationWindow.loadURL(REGISTRATION_PAGE);
    await runCaptureRequest(registrationWindow);
  } finally {
    registrationSession.setDisplayMediaRequestHandler(null);
    registrationSession.setPermissionRequestHandler(null);
    if (!registrationWindow.isDestroyed()) registrationWindow.destroy();
  }
}
