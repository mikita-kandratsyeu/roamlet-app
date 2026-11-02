import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyWaitingUpdateOnStartup } from './domain/appUpdate';
import { capturePwaInstallPrompt } from './hooks/usePwa';
import { ThemeProvider } from './theme';
import './i18n';
import '@fontsource-variable/manrope';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './planner.css';
capturePwaInstallPrompt();
async function start() {
  const offlineShell = import.meta.env.PROD && 'serviceWorker' in navigator;
  if (
    offlineShell &&
    (await applyWaitingUpdateOnStartup(navigator.serviceWorker, () => window.location.reload()))
  )
    return;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
void start();
