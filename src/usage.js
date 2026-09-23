const { pool } = require('./db');
const { nextPeriodStart } = require('./quota');

async function getUsage(tenant) {
  const period = new Date().toISOString().slice(0, 7); 

  const totals = (await pool.query(
    `SELECT COALESCE(SUM(api_calls), 0)::bigint           AS api_calls,
            COALESCE(SUM(input_tokens), 0)::bigint        AS input_tokens,
            COALESCE(SUM(cached_input_tokens), 0)::bigint AS cached_input_tokens,
            COALESCE(SUM(output_tokens), 0)::bigint       AS output_tokens,
            COALESCE(SUM(reasoning_tokens), 0)::bigint    AS reasoning_tokens
     FROM usage_events WHERE tenant_id = $1 AND period = $2`,
    [tenant.id, period],
  )).rows[0];

  // Cached tokens are already inside input_tokens, so they are not added again.
  const tokensUsed = totals.input_tokens + totals.output_tokens + totals.reasoning_tokens;

  return {
    tenant_id: tenant.id,
    plan: tenant.plan_id,
    period,
    resets_at: nextPeriodStart().toISOString(),
    api_calls: {
      used: Number(totals.api_calls),
      limit: Number(tenant.api_call_limit),
      remaining: Number(tenant.api_call_limit - totals.api_calls),
    },
    ai_tokens: {
      used: Number(tokensUsed),
      limit: Number(tenant.ai_token_limit),
      remaining: Number(tenant.ai_token_limit - tokensUsed),
      breakdown: {
        input: Number(totals.input_tokens),
        cached_input: Number(totals.cached_input_tokens),
        output: Number(totals.output_tokens),
        reasoning: Number(totals.reasoning_tokens),
      },
    },
  };
}

module.exports = { getUsage };