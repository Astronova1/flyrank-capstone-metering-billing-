const crypto = require('node:crypto');
const { pool } = require('./db');

const PROVIDER = process.env.PAYMENT_PROVIDER || 'mock';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function testId(prefix) {
  return `${prefix}_test_${crypto.randomBytes(12).toString('hex')}`;
}

async function createCheckoutSession(tenant, plan) {
  let sessionId;
  let url;

  if (PROVIDER === 'stripe') {
    // Real Stripe test mode. Untested here (no Stripe account available in Pakistan),
    // kept so the system can be pointed at real Stripe by changing .env only.
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      client_reference_id: tenant.id, // how the webhook finds our tenant
      success_url: `${BASE_URL}/usage`,
      cancel_url: `${BASE_URL}/usage`,
    });
    sessionId = session.id;
    url = session.url;
  } else {
    sessionId = testId('cs');
    url = `${BASE_URL}/mock-checkout/${sessionId}`; 
  }

  await pool.query(
    'INSERT INTO checkout_sessions (id, tenant_id, plan_id) VALUES ($1, $2, $3)',
    [sessionId, tenant.id, plan.id],
  );

  return { id: sessionId, url };
}

module.exports = { createCheckoutSession, testId, PROVIDER };