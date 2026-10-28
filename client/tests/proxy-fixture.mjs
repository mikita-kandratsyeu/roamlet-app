import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createProxyServer } from '../../proxy/src/index.js';
// Synthetic provider exists only in this browser-test entry point.
const key = 'test-only-server-sentinel-never-in-browser';
const upstream = createServer(async (req, res) => {
  if (req.headers.authorization !== key) {
    res.writeHead(401);
    res.end('{}');
    return;
  }
  let text = '';
  for await (const chunk of req) text += chunk;
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/geocode/search')) {
    res.end(
      JSON.stringify({
        features: [
          {
            geometry: { coordinates: [11.4041, 47.2692] },
            properties: { label: 'Innsbruck, Austria' },
          },
        ],
      }),
    );
  } else if (req.url.startsWith('/v2/directions/')) {
    const body = JSON.parse(text);
    const coordinates = body.coordinates.map((point, i) => [...point, 600 + i * 10]);
    res.end(
      JSON.stringify({
        features: [
          {
            geometry: { type: 'LineString', coordinates },
            properties: { summary: { duration: 420 } },
          },
        ],
      }),
    );
  } else {
    res.writeHead(404);
    res.end('{}');
  }
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
const proxy = createProxyServer({
  key,
  base: `http://127.0.0.1:${address.port}`,
  distPath: fileURLToPath(new URL('../dist/', import.meta.url)),
});
proxy.listen(4176, '127.0.0.1');
function close() {
  proxy.close();
  upstream.close();
  proxy.closeAllConnections();
  upstream.closeAllConnections();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
