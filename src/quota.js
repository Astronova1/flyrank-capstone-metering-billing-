function nextPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function checkQuota({ planId, used, limits, requested, now = new Date() }) {
  const checks = [
    { quota: 'api_calls', label: 'API call', used: used.apiCalls, limit: limits.apiCalls, requested: requested.apiCalls },
    { quota: 'ai_tokens', label: 'AI token', used: used.tokens, limit: limits.tokens, requested: requested.tokens },
  ];

  const failed = checks.find((c) => c.used + c.requested > c.limit);
  if (!failed) return null; // allowed

  const resetsAt = nextPeriodStart(now);
  const isFree = planId === 'free';

  const status = isFree ? 402 : 429;
  const headers = isFree ? {} : { 'Retry-After': String(Math.ceil((resetsAt - now) / 1000)) };
  const advice = isFree ? 'Upgrade to Pro to continue.' : `Quota resets at ${resetsAt.toISOString()}.`;

  return {
    status,
    headers,
    body: {
      error: {
        code: isFree ? 'upgrade_required' : 'quota_exceeded',
        quota: failed.quota,
        message: `Monthly ${failed.label} quota exceeded on the ${isFree ? 'Free' : 'Pro'} plan: `
          + `${failed.used} used + ${failed.requested} requested > ${failed.limit} limit. ${advice}`,
        used: Number(failed.used),
        requested: Number(failed.requested),
        limit: Number(failed.limit),
        resets_at: resetsAt.toISOString(),
      },
    },
  };
}

module.exports = { checkQuota, nextPeriodStart };