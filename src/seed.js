const { pool } = require('./db');
const { migrate } = require('./migrate');
const { sha256 } = require('./hash');

const PLANS = [
  { id: 'free', name: 'Free', apiCallLimit: 1000, aiTokenLimit: 100000, priceCents: 0, stripePriceId: null },
    { id: 'pro', name: 'Pro', apiCallLimit: 50000, aiTokenLimit: 5000000, priceCents: 2900,
    stripePriceId: process.env.PAYMENT_PROVIDER === 'stripe' && process.env.STRIPE_PRO_PRICE_ID
      ? process.env.STRIPE_PRO_PRICE_ID
      : 'price_mock_pro' },
];

// These are demo fixtures for seeding the data
const TENANTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Acme', planId: 'free', apiKey: 'tk_demo_acme_free' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Globex', planId: 'free', apiKey: 'tk_demo_globex_free' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Initech', planId: 'pro', apiKey: 'tk_demo_initech_pro' },
];

async function seed() {
  await migrate();

  for (const p of PLANS) {
    await pool.query(
      `INSERT INTO plans (id, name, api_call_limit, ai_token_limit, monthly_price_cents, stripe_price_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET name = $2, api_call_limit = $3, ai_token_limit = $4,
             monthly_price_cents = $5, stripe_price_id = $6`,
      [p.id, p.name, p.apiCallLimit, p.aiTokenLimit, p.priceCents, p.stripePriceId],
    );
  }

  await pool.query('DELETE FROM webhook_events');

  for (const t of TENANTS) {
    await pool.query(
      `INSERT INTO tenants (id, name, api_key_hash, plan_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name = $2, api_key_hash = $3, plan_id = $4,
             status = 'active', stripe_customer_id = NULL`,
      [t.id, t.name, sha256(t.apiKey), t.planId],
    );
    await pool.query('DELETE FROM usage_events WHERE tenant_id = $1', [t.id]);
    await pool.query('DELETE FROM subscriptions WHERE tenant_id = $1', [t.id]);
    await pool.query('DELETE FROM checkout_sessions WHERE tenant_id = $1', [t.id]);
      await pool.query("DELETE FROM tenants WHERE id = '99999999-9999-4999-8999-999999999999'");
  }

  console.log(`Seed complete. Pro plan Stripe price: ${PLANS[1].stripePriceId}`);
  console.table(TENANTS.map((t) => ({ tenant: t.name, plan: t.planId, api_key: t.apiKey })));
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());