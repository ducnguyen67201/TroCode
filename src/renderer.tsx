import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { AuthGate } from './renderer/AuthGate';
import { BrandMark } from './renderer/BrandMark';
import { CursorCompanion } from './renderer/CursorCompanion';
import { GuidanceCallout } from './renderer/GuidanceCallout';
import { GuidanceTargetMarker } from './renderer/GuidanceTargetMarker';
import { VoiceIsland } from './renderer/VoiceIsland';

function DesktopBridgeUnavailable() {
  return (
    <main className="auth-screen" role="alert">
      <section className="auth-card" aria-labelledby="bridge-error-heading">
        <BrandMark className="auth-brand-mark" />
        <p className="eyebrow">TroCode needs a restart</p>
        <h1 id="bridge-error-heading">The desktop bridge did not load.</h1>
        <p className="auth-description">
          The secure connection between this window and the TroCode desktop
          process is unavailable. Restart the development app, then try again.
        </p>
        <button
          className="google-sign-in-button"
          onClick={() => window.location.reload()}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
const rendererMode = new URLSearchParams(window.location.search).get('mode');
const isCompanionWindow = rendererMode === 'companion';
const isGuidanceWindow = rendererMode === 'guidance';
const isTargetMarkerWindow = rendererMode === 'target-marker';
const isVoiceIslandWindow = rendererMode === 'voice-island';
const isAuxiliaryWindow =
  isCompanionWindow ||
  isGuidanceWindow ||
  isTargetMarkerWindow ||
  isVoiceIslandWindow;

if (!rootElement) throw new Error('The application root element is missing.');

if (isCompanionWindow) document.documentElement.classList.add('companion-mode');
if (isGuidanceWindow) document.documentElement.classList.add('guidance-mode');
if (isTargetMarkerWindow) {
  document.documentElement.classList.add('target-marker-mode');
}
if (isVoiceIslandWindow) {
  document.documentElement.classList.add('voice-island-mode');
}

const hasDesktopBridge = isTargetMarkerWindow
  ? true
  : isAuxiliaryWindow
  ? typeof window.troCompanion !== 'undefined'
  : typeof window.tro !== 'undefined';

createRoot(rootElement).render(
  <StrictMode>
    {!hasDesktopBridge ? (
      isAuxiliaryWindow ? null : (
        <DesktopBridgeUnavailable />
      )
    ) : isGuidanceWindow ? (
      <GuidanceCallout />
    ) : isTargetMarkerWindow ? (
      <GuidanceTargetMarker />
    ) : isVoiceIslandWindow ? (
      <VoiceIsland />
    ) : isCompanionWindow ? (
      <CursorCompanion />
    ) : (
      <AuthGate />
    )}
  </StrictMode>,
);
