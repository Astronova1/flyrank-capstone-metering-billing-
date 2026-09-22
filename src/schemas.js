const { z } = require('zod');

const tokenCount = z.number().int().min(0).max(10_000_000);

const generateBody = z
  .object({
    input_tokens: tokenCount,
    cached_input_tokens: tokenCount.default(0),
    output_tokens: tokenCount,
    reasoning_tokens: tokenCount.default(0),
  })
  .strict() 
  .refine((b) => b.cached_input_tokens <= b.input_tokens, {
    message: 'cached_input_tokens is part of input_tokens, so it cannot be larger',
    path: ['cached_input_tokens'],
  });

const idempotencyKey = z.string().regex(/^[\x21-\x7E]{1,255}$/);

module.exports = { generateBody, idempotencyKey };