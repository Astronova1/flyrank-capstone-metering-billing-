// Tests for Requirement 1 and Requirement 2
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../src/app');
const { pool } = require('../src/db');
const { sha256 } = require('../src/hash');

const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const API_KEY = 'tk_test_only';
const auth = { Authorization: `Bearer ${API_KEY}` };
const body = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, reasoning_tokens: 50 };
const period = new Date().toISOString().slice(0, 7);

const countEvents = async () => Number((await pool.query(
  'SELECT count(*) FROM usage_events WHERE tenant_id = $1', [TENANT_ID])).rows[0].count);

// Fresh test tenant on the Free plan, with no usage.
before(async () => {
  await pool.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await pool.query(
    `INSERT INTO tenants (id, name, api_key_hash, plan_id) VALUES ($1, 'Test tenant', $2, 'free')
     ON CONFLICT (id) DO UPDATE SET api_key_hash = $2, plan_id = 'free'`,
    [TENANT_ID, sha256(API_KEY)],
  );
});

after(async () => {
  await pool.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await pool.end();
});

test('same key twice: one event and same identical response', async () => {
  const first = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'k1').send(body);
  const second = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'k1').send(body);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.headers['idempotent-replayed'], 'false');
  assert.equal(second.headers['idempotent-replayed'], 'true');
  assert.equal(second.text, first.text); 
  assert.equal(await countEvents(), 1);
});

test('20 retries at the same moment: still one event', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () =>
    request(app).post('/generate').set(auth).set('Idempotency-Key', 'k2').send(body)));

  assert.ok(responses.every((r) => r.status === 201));
  assert.equal(new Set(responses.map((r) => r.body.event_id)).size, 1); 
  assert.equal(await countEvents(), 2);
});

test('same key, different body: 409, nothing stored', async () => {
  const res = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'k1')
    .send({ ...body, output_tokens: 1 });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'idempotency_key_reused');
  assert.equal(await countEvents(), 2);
});

test('invalid input: 400, nothing stored', async () => {
  const noKey = await request(app).post('/generate').set(auth).send(body);
  const badBody = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'k3')
    .send({ input_tokens: 10, cached_input_tokens: 50, output_tokens: 1 });

  assert.equal(noKey.status, 400);
  assert.equal(badBody.status, 400);
  assert.equal(await countEvents(), 2);
});

test('quota boundary: call 1000 passes, call 1001 gets 402', async () => {
  // Jump to 999 calls by inserting rows directly
  await pool.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await pool.query(
    `INSERT INTO usage_events (id, tenant_id, period, idempotency_key, request_hash, api_calls,
       input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, response_body)
     SELECT gen_random_uuid(), $1, $2, 'fill-' || g, 'x', 1, 0, 0, 0, 0, '{}'
     FROM generate_series(1, 999) g`,
    [TENANT_ID, period],
  );

  const small = { input_tokens: 1, output_tokens: 0 };
  const atLimit = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'c1000').send(small);
  const overLimit = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'c1001').send(small);

  assert.equal(atLimit.status, 201); // 999 + 1 = 1000 = limit  allowed
  assert.equal(overLimit.status, 402); // 1000 + 1 > 1000  rejected
  assert.equal(overLimit.body.error.quota, 'api_calls');
  assert.match(overLimit.body.error.message, /Upgrade to Pro/);
  assert.equal(await countEvents(), 1000); // the rejected call stored nothing
});

test('a retry still works after the quota is full', async () => {
  const replay = await request(app).post('/generate').set(auth).set('Idempotency-Key', 'c1000')
    .send({ input_tokens: 1, output_tokens: 0 });

  assert.equal(replay.status, 201);
  assert.equal(replay.headers['idempotent-replayed'], 'true');
  assert.equal(await countEvents(), 1000);
});

test('token quota: a request that would exceed it is rejected whole', async () => {
  await pool.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);

  const fill = await request(app).post('/generate').set(auth).set('Idempotency-Key', 't1')
    .send({ input_tokens: 60000, output_tokens: 30000, reasoning_tokens: 10000 }); // exactly 100000
  const oneMore = await request(app).post('/generate').set(auth).set('Idempotency-Key', 't2')
    .send({ input_tokens: 1, output_tokens: 0 });

  assert.equal(fill.status, 201);
  assert.equal(oneMore.status, 402);
  assert.equal(oneMore.body.error.quota, 'ai_tokens');
  assert.equal(await countEvents(), 1);
});

test('GET /usage reports the same numbers, and only for this tenant', async () => {
  const res = await request(app).get('/usage').set(auth);

  assert.equal(res.status, 200);
  assert.equal(res.body.tenant_id, TENANT_ID);
  assert.equal(res.body.api_calls.used, 1);
  assert.equal(res.body.ai_tokens.used, 100000); // cached tokens are not counted twice
  assert.equal(res.body.ai_tokens.remaining, 0);
});