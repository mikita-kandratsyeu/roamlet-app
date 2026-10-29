import { loadEnv } from 'vite';

export function localRoutingApi(rootDirectory = new URL('../', import.meta.url).pathname) {
  return {
    name: 'local-routing-api',
    config(_, { mode }) {
      const environment = loadEnv(mode, rootDirectory, 'ORS_');
      if (process.env.ORS_API_KEY === undefined && environment.ORS_API_KEY !== undefined)
        process.env.ORS_API_KEY = environment.ORS_API_KEY;
    },
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

async function attach(server) {
  const { routeHandler, configHandler } = await import('../server/routing.mjs');
  server.middlewares.use((request, response, next) => {
    const pathname = request.url?.split('?')[0];
    const handler =
      pathname === '/api/route'
        ? routeHandler
        : pathname === '/api/routing-config'
          ? configHandler
          : undefined;
    if (!handler) return next();
    void handler(request, response).catch(next);
  });
}
