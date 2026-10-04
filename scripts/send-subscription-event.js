const stripe = require('stripe');
const { pool } = require('../src/db');

const [status = 'past_due', ...flags] = process.argv.slice(2);
const forge = flags.includes('--forge');
const replay = flags.includes('--replay');
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const { rows } = await pool.query(
    `SELECT s.stripe_subscription_id, s.plan_id, p.stripe_price_id
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     ORDER BY s.updated_at DESC LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error('No subscription found. Run a checkout first (POST /billing/checkout, then pay).');
  }
  const sub = rows[0];

  const event = {
    id: `evt_test_${status}_${Date.now()}`,           
    object: 'event',
    type: status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),           
    data: {
      object: {
        id: sub.stripe_subscription_id,
        object: 'subscription',
        status,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        items: { data: [{ price: { id: sub.stripe_price_id } }] },
      },
    },
  };

  const payload = JSON.stringify(event);

  async function deliver(label, useWrongSecret = false) {
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: useWrongSecret ? 'whsec_wrong_secret' : process.env.STRIPE_WEBHOOK_SECRET,
    });
    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
      body: payload,
    });
    console.log(`${label} -> HTTP ${res.status}`, await res.text());
  }

  console.log(`subscription ${sub.stripe_subscription_id} (plan ${sub.plan_id}) -> status "${status}"`);
  if (forge) {
    await deliver('FORGED', true);
  } else {
    await deliver('signed');
    if (replay) await deliver('replay');
  }
}

main()
  .catch((err) => {
    console.error('failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());