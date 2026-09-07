import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

export function isTrustedWindowSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id &&
    event.senderFrame === window.webContents.mainFrame,
  );
}
