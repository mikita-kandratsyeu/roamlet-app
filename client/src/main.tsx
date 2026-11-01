import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyWaitingUpdateOnStartup } from './domain/appUpdate';
import { ThemeProvider } from './theme';
import './i18n';
import '@fontsource-variable/manrope';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './planner.css';
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
  if (offlineShell) {
    const register = () => {
      void navigator.serviceWorker
        .register('/sw.js')
        .catch((error) => console.warn('Offline shell registration failed:', error));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}
void start();
