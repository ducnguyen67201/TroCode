import type { DesktopApi } from './desktop-api';

declare global {
  interface Window {
    tro: DesktopApi;
  }
}

export {};
