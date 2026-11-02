import { loadEnv } from 'vite';

export function localRoutingApi(rootDirectory = new URL('../', import.meta.url).pathname) {
  return {
    name: 'local-routing-api',
    config(_, { mode }) {
      const environment = loadEnv(mode, rootDirectory, ['ORS_', 'GITHUB_', 'GOOGLE_DRIVE_', 'AI_']);
      for (const [name, value] of Object.entries(environment)) {
        if (process.env[name] === undefined) process.env[name] = value;
      }
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

async function attach(server) {
  const { routeHandler, configHandler } = await import('../server/routing.mjs');
  const { githubHandler } = await import('../server/github-handlers.mjs');
  const { googleDriveHandler } = await import('../server/google-drive-handlers.mjs');
  const { aiHandler } = await import('../server/ai-handlers.mjs');
  server.middlewares.use((request, response, next) => {
    const pathname = request.url?.split('?')[0];
    const handler =
      pathname === '/api/route'
        ? routeHandler
        : pathname === '/api/routing-config'
          ? configHandler
          : pathname === '/api/github'
            ? githubHandler
            : pathname === '/api/google-drive'
              ? googleDriveHandler
              : pathname === '/api/ai'
                ? aiHandler
                : undefined;
    if (!handler) return next();
    void handler(request, response).catch(next);
  });
}
