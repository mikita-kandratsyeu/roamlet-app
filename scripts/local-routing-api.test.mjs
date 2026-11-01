import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { localRoutingApi } from './local-routing-api.mjs';

test('local API loads server env without inventing a missing key or overriding process env', () => {
  const directory = join(process.cwd(), `.roamlet-server-env-${randomUUID()}`);
  mkdirSync(directory);
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

test('local API loads GitHub and Google Drive server variables only and preserves process precedence', () => {
  const directory = join(process.cwd(), `.roamlet-github-env-${randomUUID()}`);
  mkdirSync(directory);
  const names = [
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_APP_SLUG',
    'GITHUB_APP_CALLBACK_URL',
    'GITHUB_SESSION_SECRET',
    'GOOGLE_DRIVE_CLIENT_ID',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_CALLBACK_URL',
    'GOOGLE_DRIVE_SESSION_SECRET',
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const excluded = [
    'VITE_GITHUB_TEST_SECRET',
    'VITE_GOOGLE_DRIVE_TEST_SECRET',
    'GOOGLE_OTHER_SECRET',
  ];
  const previousExcluded = new Map(excluded.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    for (const name of excluded) delete process.env[name];
    writeFileSync(
      join(directory, '.env.local'),
      names.map((name) => `${name}=synthetic-${name}`).join('\n') +
        '\n' +
        excluded.map((name) => `${name}=not-server-config`).join('\n') +
        '\n',
    );
    process.env.GITHUB_APP_CLIENT_SECRET = 'synthetic-process-secret';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'synthetic-process-secret';
    localRoutingApi(directory).config({}, { mode: 'development' });
    for (const name of names)
      assert.equal(
        process.env[name],
        name.endsWith('CLIENT_SECRET') ? 'synthetic-process-secret' : `synthetic-${name}`,
      );
    for (const name of excluded) assert.equal(process.env[name], undefined);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const [name, value] of previousExcluded) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook} mounts shared routing and connector handlers and passes unknown paths through`, async (t) => {
    const previous = process.env.ORS_API_KEY;
    const previousGithub = process.env.GITHUB_APP_CLIENT_ID;
    const previousGoogle = process.env.GOOGLE_DRIVE_CLIENT_ID;
    process.env.ORS_API_KEY = '';
    process.env.GITHUB_APP_CLIENT_ID = '';
    process.env.GOOGLE_DRIVE_CLIENT_ID = '';
    t.after(() => {
      if (previous === undefined) delete process.env.ORS_API_KEY;
      else process.env.ORS_API_KEY = previous;
      if (previousGithub === undefined) delete process.env.GITHUB_APP_CLIENT_ID;
      else process.env.GITHUB_APP_CLIENT_ID = previousGithub;
      if (previousGoogle === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID;
      else process.env.GOOGLE_DRIVE_CLIENT_ID = previousGoogle;
    });
    t.mock.method(console, 'info', () => {});
    const fetcher = t.mock.method(globalThis, 'fetch', () => {
      throw new Error('Must not call provider');
    });
    let middleware;
    await localRoutingApi()[hook]({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
    });
    for (const [url, method, status, expected] of [
      ['/api/routing-config?check=1', 'GET', 200, { available: false }],
      ['/api/github?action=session', 'GET', 200, { available: false, connected: false }],
      ['/api/google-drive?action=session', 'GET', 200, { available: false, connected: false }],
      [
        '/api/route',
        'POST',
        503,
        {
          error: { code: 'ROUTING_NOT_CONFIGURED', message: 'The routing service is unavailable.' },
        },
      ],
    ]) {
      const result = await new Promise((resolve, reject) => {
        const res = {
          setHeader() {},
          end(raw) {
            resolve({ status: this.statusCode, data: JSON.parse(raw) });
          },
        };
        middleware(
          {
            url,
            method,
            headers: { host: 'localhost', 'content-type': 'application/json' },
            body: {
              profile: 'foot-hiking',
              coordinates: [
                [0, 0],
                [1, 1],
              ],
              instructions: false,
              elevation: true,
            },
          },
          res,
          reject,
        );
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.data, expected);
    }
    let passedThrough = false;
    middleware({ url: '/unknown' }, {}, () => {
      passedThrough = true;
    });
    assert.equal(passedThrough, true);
    assert.equal(fetcher.mock.calls.length, 0);
  });
}
