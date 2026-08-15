import { describe, expect, it, vi } from 'vitest';

import {
  initializeSingleInstance,
  isolateDevelopmentInstance,
} from './single-instance';

function createAppMock(lockAcquired: boolean) {
  let secondInstanceHandler: (() => void) | undefined;
  const app = {
    on: vi.fn((event: 'second-instance', handler: () => void) => {
      expect(event).toBe('second-instance');
      secondInstanceHandler = handler;
    }),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => lockAcquired),
  };

  return {
    app,
    emitSecondInstance: () => secondInstanceHandler?.(),
  };
}

describe('initializeSingleInstance', () => {
  it('rejects a second application instance before registering startup behavior', () => {
    const { app } = createAppMock(false);

    expect(initializeSingleInstance(app, vi.fn())).toBe(false);

    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });

  it('surfaces the existing application when another instance is launched', () => {
    const { app, emitSecondInstance } = createAppMock(true);
    const surfaceExistingInstance = vi.fn();

    expect(initializeSingleInstance(app, surfaceExistingInstance)).toBe(true);
    emitSecondInstance();

    expect(app.quit).not.toHaveBeenCalled();
    expect(surfaceExistingInstance).toHaveBeenCalledOnce();
  });
});

describe('isolateDevelopmentInstance', () => {
  it('uses a separate user-data directory for development launches', () => {
    const app = {
      getName: vi.fn(() => 'TroCode'),
      getPath: vi.fn(() => '/application-support'),
      isPackaged: false,
      setPath: vi.fn(),
    };

    isolateDevelopmentInstance(app);

    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      '/application-support/TroCode Development',
    );
  });

  it('keeps the packaged application user-data directory unchanged', () => {
    const app = {
      getName: vi.fn(() => 'TroCode'),
      getPath: vi.fn(() => '/application-support'),
      isPackaged: true,
      setPath: vi.fn(),
    };

    isolateDevelopmentInstance(app);

    expect(app.setPath).not.toHaveBeenCalled();
  });
});
