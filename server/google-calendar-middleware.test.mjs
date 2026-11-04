import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localGoogleCalendarApi } from './google-calendar-middleware.mjs';

test('Calendar middleware config loads only its prefix and preserves process overrides', () => {
  const name = 'GOOGLE_CALENDAR_CLIENT_ID';
  const previous = process.env[name];
  process.env[name] = 'synthetic-process-precedence';
  try {
    const plugin = localGoogleCalendarApi('/synthetic-root', (mode, root, prefix) => {
      assert.equal(mode, 'test');
      assert.equal(root, '/synthetic-root');
      assert.equal(prefix, 'GOOGLE_CALENDAR_');
      return { [name]: 'synthetic-file-value' };
    });
    plugin.config({}, { mode: 'test' });
    assert.equal(process.env[name], 'synthetic-process-precedence');
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});
test('development and preview attach only Calendar, leaving existing routes untouched', async () => {
  const plugin = localGoogleCalendarApi('/synthetic-root', () => ({}));
  const missing = 'GOOGLE_CALENDAR_SESSION_SECRET';
  const previous = process.env[missing];
  // Explicitly disable configuration; never consult real OAuth secrets or call live Google.
  process.env[missing] = '';
  try {
    for (const attach of [plugin.configureServer, plugin.configurePreviewServer]) {
      let middleware;
      attach({
        middlewares: {
          use(value) {
            middleware = value;
          },
        },
      });
      let nextCalls = 0;
      for (const url of [
        '/api/github?action=session',
        '/api/google-drive?action=session',
        '/api/route',
        '/api/google-calendar-other',
      ])
        middleware({ url }, {}, () => {
          nextCalls++;
        });
      assert.equal(nextCalls, 4);
      const response = await new Promise((resolve, reject) => {
        const headers = {};
        const res = {
          setHeader(name, value) {
            headers[name.toLowerCase()] = value;
          },
          end(body) {
            this.writableEnded = true;
            resolve({ status: this.statusCode, body: JSON.parse(body), headers });
          },
        };
        middleware({ url: '/api/google-calendar?action=session', method: 'GET' }, res, reject);
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { available: false, connected: false });
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  } finally {
    if (previous === undefined) delete process.env[missing];
    else process.env[missing] = previous;
  }
});
