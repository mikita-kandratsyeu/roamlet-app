import { pathToFileURL } from 'node:url';
import { createProxyServer } from './server.js';

export { createProxyServer } from './server.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PROXY_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PROXY_PORT.');
  const server = createProxyServer();
  server.listen(port, process.env.PROXY_HOST || '127.0.0.1');
}
