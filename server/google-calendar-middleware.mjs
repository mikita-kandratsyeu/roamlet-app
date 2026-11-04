import { loadEnv } from 'vite';
import { googleCalendarHandler } from './google-calendar-handlers.mjs';

export function localGoogleCalendarApi(
  rootDirectory = new URL('../', import.meta.url).pathname,
  loadEnvironment = loadEnv,
) {
  const attach = (server) => {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] !== '/api/google-calendar') return next();
      void googleCalendarHandler(request, response).catch(next);
    });
  };
  return {
    name: 'local-google-calendar-api',
    config(_, { mode }) {
      const environment = loadEnvironment(mode, rootDirectory, 'GOOGLE_CALENDAR_');
      for (const [name, value] of Object.entries(environment)) {
        if (name.startsWith('GOOGLE_CALENDAR_') && process.env[name] === undefined)
          process.env[name] = value;
      }
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
