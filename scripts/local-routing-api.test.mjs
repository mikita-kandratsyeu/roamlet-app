import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { localRoutingApi } from './local-routing-api.mjs';

test('local API loads server env without inventing a missing key or overriding process env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'roamlet-server-env-'));
  const previous = process.env.ORS_API_KEY;
  const configure = () => localRoutingApi(directory).config({}, { mode: 'development' });
  try {
    delete process.env.ORS_API_KEY;
    configure();
    assert.equal(process.env.ORS_API_KEY, undefined);
    writeFileSync(join(directory, '.env.local'), 'ORS_API_KEY=local-test-only-key\n');
    configure();
    assert.equal(process.env.ORS_API_KEY, 'local-test-only-key');
    process.env.ORS_API_KEY = 'process-test-only-key';
    configure();
    assert.equal(process.env.ORS_API_KEY, 'process-test-only-key');
    process.env.ORS_API_KEY = '';
    configure();
    assert.equal(process.env.ORS_API_KEY, '');
  } finally {
    if (previous === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook} mounts both shared handlers and passes unknown paths through`, async (t) => {
    const previous = process.env.ORS_API_KEY;
    process.env.ORS_API_KEY = '';
    t.after(() => {
      if (previous === undefined) delete process.env.ORS_API_KEY;
      else process.env.ORS_API_KEY = previous;
    });
    t.mock.method(console, 'info', () => {});
    const fetcher = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not call provider'); });
    let middleware;
    await localRoutingApi()[hook]({ middlewares: { use(handler) { middleware = handler; } } });
    for (const [url, method, status, expected] of [
      ['/api/routing-config?check=1', 'GET', 200, { available: false }],
      ['/api/route', 'POST', 503, { error: { code: 'ROUTING_NOT_CONFIGURED', message: 'The routing service is unavailable.' } }],
    ]) {
      const result = await new Promise((resolve, reject) => {
        const res = {
          setHeader() {},
          end(raw) { resolve({ status: this.statusCode, data: JSON.parse(raw) }); },
        };
        middleware({
          url, method, headers: { host: 'localhost', 'content-type': 'application/json' },
          body: { profile: 'foot-hiking', coordinates: [[0, 0], [1, 1]], instructions: false, elevation: true },
        }, res, reject);
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.data, expected);
    }
    let passedThrough = false;
    middleware({ url: '/unknown' }, {}, () => { passedThrough = true; });
    assert.equal(passedThrough, true);
    assert.equal(fetcher.mock.calls.length, 0);
  });
}
