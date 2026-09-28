// Requirement 3 proof: cached input, reasoning tokens and rounding, with hand checked numbers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateCost, nanosToUsd, nanosToCents, PRICING } = require('../src/pricing');

const usage = (o) => ({
  apiCalls: 0n, inputTokens: 0n, cachedInputTokens: 0n, outputTokens: 0n, reasoningTokens: 0n, ...o,
});

test('worked example: every category at once', () => {
  const { breakdown, total } = calculateCost(usage({
    apiCalls: 1n, inputTokens: 10_000n, cachedInputTokens: 4_000n,
    outputTokens: 2_000n, reasoningTokens: 1_500n,
  }));

  assert.equal(breakdown.uncached_input, 1_800_000n); 
  assert.equal(breakdown.cached_input, 120_000n);   
  assert.equal(breakdown.output, 5_000_000n);      
  assert.equal(breakdown.reasoning, 3_750_000n);     
  assert.equal(breakdown.api_calls, 1_000_000n);     
  assert.equal(total, 11_670_000n);
  assert.equal(nanosToUsd(total), '0.011670000');
});

test('cached tokens are billed once, at the cheaper rate', () => {
  const allCached = calculateCost(usage({ inputTokens: 1_000n, cachedInputTokens: 1_000n }));
  const noneCached = calculateCost(usage({ inputTokens: 1_000n }));

  assert.equal(allCached.total, 30_000n);  
  assert.equal(noneCached.total, 300_000n);
  assert.equal(noneCached.total / allCached.total, 10n);
});

test('the naive "add every category" calculation would be wrong', () => {
  const input = 10_000n; const cached = 4_000n;
  const correct = calculateCost(usage({ inputTokens: input, cachedInputTokens: cached })).total;
  const naive = input * PRICING.UNCACHED_INPUT_TOKEN + cached * PRICING.CACHED_INPUT_TOKEN;

  assert.equal(correct, 1_920_000n); 
  assert.equal(naive, 3_120_000n);   
  assert.notEqual(correct, naive);
});

test('reasoning tokens cost the same as output tokens', () => {
  const asReasoning = calculateCost(usage({ reasoningTokens: 1_000n })).total;
  const asOutput = calculateCost(usage({ outputTokens: 1_000n })).total;

  assert.equal(asReasoning, asOutput);
  assert.equal(asReasoning, 2_500_000n);
});

test('totals are exact: 1000 small calls equal one big one', () => {
  const one = calculateCost(usage({ apiCalls: 1n, inputTokens: 7n, outputTokens: 3n })).total;
  const thousandSeparately = one * 1_000n;
  const thousandTogether = calculateCost(usage({
    apiCalls: 1_000n, inputTokens: 7_000n, outputTokens: 3_000n,
  })).total;

  assert.equal(thousandSeparately, thousandTogether); 
});

test('rounding to cents happens once, half up', () => {
  assert.equal(nanosToCents(14_999_999n), 1n); 
  assert.equal(nanosToCents(15_000_000n), 2n);
  assert.equal(nanosToCents(11_670_000n), 1n);
});

test('zero usage costs zero', () => {
  assert.equal(calculateCost(usage({})).total, 0n);
  assert.equal(nanosToUsd(0n), '0.000000000');
});