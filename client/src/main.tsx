import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { watchUpdates } from './domain/appUpdate';
import { ThemeProvider } from './theme';
import './i18n';
import '@fontsource-variable/manrope';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './planner.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(watchUpdates)
      .catch((error) => console.warn('Offline shell registration failed:', error));
  });
}
