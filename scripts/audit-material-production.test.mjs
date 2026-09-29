import test from 'node:test';
import assert from 'node:assert/strict';
import { auditMaterialProduction } from './audit-material-production.mjs';

const env = { SUPABASE_PROJECT_ID: 'fixtureproject', SUPABASE_ACCESS_TOKEN: 'test-only-token' };
test('sends the canonical audit with two read-only boundaries and no psql directive', async () => {
  const result = await auditMaterialProduction({ env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.supabase.com/v1/projects/fixtureproject/database/query');
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    const body = JSON.parse(options.body);
    assert.equal(body.read_only, true);
    assert.match(body.query, /begin transaction isolation level repeatable read read only/);
    assert.match(body.query, /rolsuper or rolbypassrls/);
    assert.match(body.query, /Historical audit refused/);
    assert.match(body.query, /rollback;/);
    assert.doesNotMatch(body.query, /^\\/m);
    return { ok: true, json: async () => [] };
  }});
  assert.deepEqual(result, { project: 'fixtureproject', passed: true });
});
test('missing credentials or malformed project refuse before network access', async () => {
  for (const invalid of [{}, { ...env, SUPABASE_PROJECT_ID: '../other' }]) {
    await assert.rejects(auditMaterialProduction({ env: invalid, fetchImpl: () => assert.fail('unexpected request') }), /required/);
  }
});
test('remote failures do not disclose response contents', async () => {
  await assert.rejects(auditMaterialProduction({ env, fetchImpl: async () => ({
    ok: false, status: 403, json: () => assert.fail('must not read error details'),
  }) }), /HTTP 403.*rollout refused/);
});
test('error-shaped successful responses still refuse rollout', async () => {
  await assert.rejects(auditMaterialProduction({ env, fetchImpl: async () => ({
    ok: true, json: async () => ({ error: 'hidden fixture detail' }),
  }) }), /returned an error/);
});
