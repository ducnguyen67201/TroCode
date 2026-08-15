import path from 'node:path';

export interface InstanceScopeApp {
  getName(): string;
  getPath(name: 'appData'): string;
  isPackaged: boolean;
  setPath(name: 'userData', value: string): void;
}

export interface SingleInstanceApp {
  on(event: 'second-instance', listener: () => void): void;
  quit(): void;
  requestSingleInstanceLock(): boolean;
}

export function isolateDevelopmentInstance(app: InstanceScopeApp): void {
  if (app.isPackaged) return;

  app.setPath(
    'userData',
    path.join(app.getPath('appData'), `${app.getName()} Development`),
  );
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
