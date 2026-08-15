export interface SingleInstanceApp {
  on(event: 'second-instance', listener: () => void): void;
  quit(): void;
  requestSingleInstanceLock(): boolean;
}

export function initializeSingleInstance(
  app: SingleInstanceApp,
  surfaceExistingInstance: () => void,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', surfaceExistingInstance);
  return true;
}
