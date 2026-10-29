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
