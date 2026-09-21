const crypto = require('node:crypto');
const { pool } = require('./db');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PLANS = [
  { id: 'free', name: 'Free', apiCallLimit: 1000, aiTokenLimit: 100000 },
  { id: 'pro', name: 'Pro', apiCallLimit: 50000, aiTokenLimit: 5000000 },
];

// These are demo fixtures for seeding the data
const TENANTS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Acme', planId: 'free', apiKey: 'tk_demo_acme_free' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Globex', planId: 'free', apiKey: 'tk_demo_globex_free' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Inifiech', planId: 'pro', apiKey: 'tk_demo_initech_pro' },
];

async function seed() {
  for (const p of PLANS) {
    await pool.query(
      `INSERT INTO plans (id, name, api_call_limit, ai_token_limit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name = $2, api_call_limit = $3, ai_token_limit = $4`,
      [p.id, p.name, p.apiCallLimit, p.aiTokenLimit],
    );
  }

  for (const t of TENANTS) {
    await pool.query(
      `INSERT INTO tenants (id, name, api_key_hash, plan_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET name = $2, api_key_hash = $3, plan_id = $4`,
      [t.id, t.name, sha256(t.apiKey), t.planId],
    );
    await pool.query('DELETE FROM usage_events WHERE tenant_id = $1', [t.id]);
  }

  console.log('Seed complete. Demo API keys:');
  console.table(TENANTS.map((t) => ({ tenant: t.name, plan: t.planId, api_key: t.apiKey })));
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());