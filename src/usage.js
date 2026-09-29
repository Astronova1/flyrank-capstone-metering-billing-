const { pool } = require('./db');
const { nextPeriodStart } = require('./quota');
const { calculateCost, nanosToUsd, nanosToCents, PRICING } = require('./pricing');

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

  const tokensUsed = totals.input_tokens + totals.output_tokens + totals.reasoning_tokens;

  const cost = calculateCost({
    apiCalls: totals.api_calls,
    inputTokens: totals.input_tokens,
    cachedInputTokens: totals.cached_input_tokens,
    outputTokens: totals.output_tokens,
    reasoningTokens: totals.reasoning_tokens,
  });

  return {
    tenant_id: tenant.id,
    plan: tenant.plan_id,
    status: tenant.status,
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
    cost: {
      breakdown_nanos: Object.fromEntries(
        Object.entries(cost.breakdown).map(([k, v]) => [k, v.toString()]),
      ),
      usage_total_nanos: cost.total.toString(),
      usage_total_usd: nanosToUsd(cost.total),
      usage_total_cents: Number(nanosToCents(cost.total)),
      plan_fee_cents: Number(tenant.monthly_price_cents),
      invoice_total_cents: Number(nanosToCents(cost.total)) + Number(tenant.monthly_price_cents),
    },
    pricing_nanos_per_token: {
      uncached_input: Number(PRICING.UNCACHED_INPUT_TOKEN),
      cached_input: Number(PRICING.CACHED_INPUT_TOKEN),
      output: Number(PRICING.OUTPUT_TOKEN),
      reasoning: Number(PRICING.REASONING_TOKEN),
      per_api_call: Number(PRICING.API_CALL),
    },
  };
}

module.exports = { getUsage };