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
    // Real Stripe test mode. Untested here (no Stripe account available in Pakistan), kept so the system can be pointed at real Stripe by changing .env only.
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

// Plays the part of Stripe's servers: builds a checkout.session.completed event signs it with our webhook secret and delivers.and to our own webhook endpoint
async function payMockSession(sessionId) {
  const stripe = require('stripe');

  const { rows } = await pool.query(
    `SELECT tenant_id, status FROM checkout_sessions WHERE id = $1`,
    [sessionId],
  );
  if (rows.length === 0) return { status: 404, body: { error: { code: 'session_not_found' } } };
  if (rows[0].status === 'complete') {
    return { status: 409, body: { error: { code: 'session_already_paid' } } };
  }

  const event = {
    id: testId('evt'),                       // a NEW event id every payment
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: 'checkout_session',
        mode: 'subscription',
        status: 'complete',
        customer: `cus_test_${sessionId.slice(-12)}`,
        subscription: `sub_test_${sessionId.slice(-12)}`,
        client_reference_id: rows[0].tenant_id,
      },
    },
  };

  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  const res = await fetch(`${BASE_URL}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    body: payload,
  });

  return { status: res.status, body: { paid: true, event_id: event.id, webhook: await res.json() } };
}

module.exports = { createCheckoutSession, testId, PROVIDER, payMockSession };