import { desktopCapturer } from 'electron';

export async function registerScreenRecordingHost(): Promise<void> {
  await desktopCapturer.getSources({
    fetchWindowIcons: false,
    // A zero-size thumbnail skips capture and therefore does not register the
    // host with macOS TCC. Capture one pixel and discard it in the main process.
    thumbnailSize: { height: 1, width: 1 },
    types: ['screen'],
  });
}
