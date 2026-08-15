import { BrowserWindow, desktopCapturer } from 'electron';
import { randomUUID } from 'node:crypto';

declare const SCREEN_RECORDING_WEBPACK_ENTRY: string;

const CAPTURE_TIMEOUT_MS = 10_000;
const START_AND_STOP_CAPTURE_SCRIPT = `
  (async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;

    try {
      await video.play();
      await new Promise((resolve) => {
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          video.requestVideoFrameCallback(() => resolve(true));
          return;
        }

        video.onloadeddata = () => resolve(true);
      });
      return true;
    } finally {
      video.srcObject = null;
      for (const track of stream.getTracks()) track.stop();
    }
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

  registrationSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (
        request.frame !== registrationWindow.webContents.mainFrame ||
        !request.videoRequested ||
        request.audioRequested
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
    await registrationWindow.loadURL(SCREEN_RECORDING_WEBPACK_ENTRY);
    await runCaptureRequest(registrationWindow);
  } finally {
    registrationSession.setDisplayMediaRequestHandler(null);
    if (!registrationWindow.isDestroyed()) registrationWindow.destroy();
  }
}
