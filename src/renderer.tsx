import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './renderer/App';
import { CursorCompanion } from './renderer/CursorCompanion';

const rootElement = document.getElementById('root');
const isCompanionWindow =
  new URLSearchParams(window.location.search).get('mode') === 'companion';

if (!rootElement) throw new Error('The application root element is missing.');

if (isCompanionWindow) document.documentElement.classList.add('companion-mode');

createRoot(rootElement).render(
  <StrictMode>
    {isCompanionWindow ? <CursorCompanion /> : <App />}
  </StrictMode>,
);
