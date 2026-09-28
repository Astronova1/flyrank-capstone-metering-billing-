const NANOS_PER_USD = 1_000_000_000n;

const PRICING = Object.freeze({
  UNCACHED_INPUT_TOKEN: 300n,   // $0.30 per 1M tokens
  CACHED_INPUT_TOKEN: 30n,      // $0.03 per 1M tokens (10% of the input price)
  OUTPUT_TOKEN: 2_500n,         // $2.50 per 1M tokens
  REASONING_TOKEN: 2_500n,    
    API_CALL: 1_000_000n,         // $0.001 per API call
});


function calculateCost({ apiCalls, inputTokens, cachedInputTokens, outputTokens, reasoningTokens }) {
  const uncachedInputTokens = inputTokens - cachedInputTokens;

  const breakdown = {
    api_calls: apiCalls * PRICING.API_CALL,
    uncached_input: uncachedInputTokens * PRICING.UNCACHED_INPUT_TOKEN,
    cached_input: cachedInputTokens * PRICING.CACHED_INPUT_TOKEN,
    output: outputTokens * PRICING.OUTPUT_TOKEN,
    reasoning: reasoningTokens * PRICING.REASONING_TOKEN,
  };
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0n);

  return { breakdown, total };
}

function nanosToUsd(nanos) {
  const whole = nanos / NANOS_PER_USD;
  const fraction = (nanos % NANOS_PER_USD).toString().padStart(9, '0');
  return `${whole}.${fraction}`;
}

function nanosToCents(nanos) {
  return (nanos + 5_000_000n) / 10_000_000n;
}

module.exports = { PRICING, NANOS_PER_USD, calculateCost, nanosToUsd, nanosToCents };