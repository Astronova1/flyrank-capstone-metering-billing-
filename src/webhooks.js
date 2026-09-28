const stripe = require('stripe');
const { pool } = require('./db');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

async function receiveEvent(rawBody, signature) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature || '', WEBHOOK_SECRET);
  } catch (err) {
    console.warn('rejected webhook:', err.message);
    return { status: 400, body: { error: { code: 'invalid_signature', message: 'Signature verification failed.' } } };
  }

  if (!HANDLED.has(event.type)) {
    return { status: 200, body: { received: true, ignored: event.type } };
  }
  const inserted = await pool.query(
    `INSERT INTO webhook_events (id, type, payload) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.type, event],
  );

  if (inserted.rowCount === 0) {
    return { status: 200, body: { received: true, duplicate: true, event_id: event.id } };
  }
  return { status: 200, body: { received: true, queued: true, event_id: event.id } };
}

module.exports = { receiveEvent };