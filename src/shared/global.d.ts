import type { DesktopApi } from './desktop-api';

declare global {
  interface BrowserSpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onend: (() => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onstart: (() => void) | null;
    abort(): void;
    start(): void;
    stop(): void;
  }

  interface BrowserSpeechRecognitionConstructor {
    new (): BrowserSpeechRecognition;
  }

  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    tro: DesktopApi;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export {};
