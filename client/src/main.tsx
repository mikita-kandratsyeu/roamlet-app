import React from 'react';
import ReactDOM from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { applyWaitingUpdateOnStartup } from './domain/appUpdate';
import { capturePwaInstallPrompt } from './hooks/usePwa';
import { ThemeProvider } from './theme';
import './i18n';
import '@fontsource-variable/manrope';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './planner.css';
setWorkerUrl(mapWorkerUrl);
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
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
void start();
