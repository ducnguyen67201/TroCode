import type { CompanionApi, DesktopApi } from './desktop-api';

declare global {
  interface Window {
    tro: DesktopApi;
    troCompanion: CompanionApi;
  }
}

export {};
