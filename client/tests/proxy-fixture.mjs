import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createProxyServer } from '../../proxy/src/index.js';
// Synthetic provider exists only in this browser-test entry point.
const token = 'test-only-server-sentinel-never-in-browser';
function chunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(256, 0);
header.writeUInt32BE(256, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc(256 * (1 + 256 * 3));
// Terrain-RGB encodes 600 metres as -10000 + (1*65536 + 158*256 + 16)*0.1.
for (let row = 0; row < 256; row++) {
  for (let col = 0; col < 256; col++) {
    const offset = row * (1 + 256 * 3) + 1 + col * 3;
    pixels.set([1, 158, 16], offset);
  }
}
const terrain = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
const upstream = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (
    req.method !== 'GET' ||
    url.searchParams.get('access_token') !== token ||
    req.headers.authorization
  ) {
    res.writeHead(401);
    res.end('{}');
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/search/geocode/v6/forward') {
    if (
      url.searchParams.get('permanent') !== 'true' ||
      url.searchParams.get('autocomplete') !== 'false'
    ) {
      res.writeHead(400);
      res.end('{}');
      return;
    }
    res.end(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            geometry: { type: 'Point', coordinates: [11.4041, 47.2692] },
            properties: { full_address: 'Innsbruck, Austria' },
          },
        ],
      }),
    );
  } else if (/^\/directions\/v5\/mapbox\/(cycling|walking)\//.test(url.pathname)) {
    const coordinates = url.pathname
      .split('/')
      .at(-1)
      .split(';')
      .map((point) => point.split(',').map(Number));
    res.end(
      JSON.stringify({
        code: 'Ok',
        routes: [
          {
            geometry: { type: 'LineString', coordinates },
            distance: 1200,
            duration: 420,
          },
        ],
      }),
    );
  } else if (/^\/v4\/mapbox\.terrain-rgb\/\d+\/\d+\/\d+\.pngraw$/.test(url.pathname)) {
    res.setHeader('Content-Type', 'image/png');
    res.end(terrain);
  } else {
    res.writeHead(404);
    res.end('{}');
  }
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
const proxy = createProxyServer({
  token,
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
