const crypto = require('node:crypto');
const { withTransaction } = require('./db');
const { sha256 } = require('./hash');
const { checkQuota } = require('./quota');

function hashRequest(u) {
  return sha256(JSON.stringify([u.input_tokens, u.cached_input_tokens, u.output_tokens, u.reasoning_tokens]));
}

async function recordGenerate(tenantId, idempotencyKey, usage) {
  const requestHash = hashRequest(usage);

  return withTransaction(async (db) => {
    //here we lock the tenant row util the transaction is commit or rollback
    //We also read the plan limits here, inside the lock, so they are up to date.
    const tenant = (await db.query(
      `SELECT t.plan_id, p.api_call_limit, p.ai_token_limit
       FROM tenants t JOIN plans p ON p.id = t.plan_id
       WHERE t.id = $1
       FOR UPDATE OF t`,
      [tenantId],
    )).rows[0];

    const { rows } = await db.query(
      'SELECT request_hash, response_body FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2',
      [tenantId, idempotencyKey],
    );
    if (rows.length > 0) {
      if (rows[0].request_hash !== requestHash) {
        return { status: 409, replayed: false, body: { error: {
          code: 'idempotency_key_reused',
          message: 'This Idempotency-Key was already used with a different request body. Use a new key.',
        } } };
      }
     return { status: 201, replayed: true, body: rows[0].response_body };
    }

    const period = new Date().toISOString().slice(0, 7); 
    const used = (await db.query(
      `SELECT COALESCE(SUM(api_calls), 0)::bigint AS api_calls,
              COALESCE(SUM(input_tokens + output_tokens + reasoning_tokens), 0)::bigint AS tokens
       FROM usage_events WHERE tenant_id = $1 AND period = $2`,
      [tenantId, period],
    )).rows[0];

    const rejection = checkQuota({
      planId: tenant.plan_id,
      used: { apiCalls: used.api_calls, tokens: used.tokens },
      limits: { apiCalls: tenant.api_call_limit, tokens: tenant.ai_token_limit },
      requested: {
        apiCalls: 1n,
        tokens: BigInt(usage.input_tokens + usage.output_tokens + usage.reasoning_tokens),
      },
    });
    if (rejection) return { ...rejection, replayed: false }; // nothing is stored

    const eventId = crypto.randomUUID();
    const body = {
      event_id: eventId,
      tenant_id: tenantId,
      period,
      usage: { api_calls: 1, ...usage },
    };

    await db.query(
      `INSERT INTO usage_events (id, tenant_id, period, idempotency_key, request_hash, api_calls,
         input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, response_body)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)`,
      [eventId, tenantId, period, idempotencyKey, requestHash, usage.input_tokens,
        usage.cached_input_tokens, usage.output_tokens, usage.reasoning_tokens, body],
    );
    

    return { status: 201, replayed: false, body };
  });
}

module.exports = { recordGenerate };