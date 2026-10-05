const crypto = require('node:crypto');
const { withTransaction } = require('./db');

const POLL_MS = Number(process.env.WORKER_POLL_MS || 1000);
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS || 5);

async function applyCheckoutCompleted(db, event) {
  const session = event.data.object;

  const { rows } = await db.query('SELECT tenant_id, plan_id FROM checkout_sessions WHERE id = $1', [session.id]);
  const tenantId = rows[0]?.tenant_id || session.client_reference_id;
  const planId = rows[0]?.plan_id || 'pro';
  if (!tenantId) throw new Error(`unknown checkout session ${session.id}`);

  await db.query(
    `UPDATE tenants SET plan_id = $2, status = 'active', stripe_customer_id = $3 WHERE id = $1`,
    [tenantId, planId, session.customer],
  );

  await db.query(
    `INSERT INTO subscriptions (id, tenant_id, stripe_subscription_id, plan_id, status, last_event_at)
     VALUES ($1, $2, $3, $4, 'active', to_timestamp($5))
     ON CONFLICT (stripe_subscription_id) DO UPDATE
       SET plan_id = $4, status = 'active', last_event_at = to_timestamp($5), updated_at = now()`,
    [crypto.randomUUID(), tenantId, session.subscription, planId, event.created],
  );

  await db.query(`UPDATE checkout_sessions SET status = 'complete' WHERE id = $1`, [session.id]);
  console.log(`tenant ${tenantId} upgraded to ${planId} (event ${event.id})`);
}

async function applySubscriptionChange(db, event) {
  const sub = event.data.object;
  const deleted = event.type === 'customer.subscription.deleted';

  const { rows } = await db.query(
    'SELECT tenant_id, last_event_at FROM subscriptions WHERE stripe_subscription_id = $1',
    [sub.id],
  );
  if (rows.length === 0) throw new Error(`unknown subscription ${sub.id}`);

  const eventAt = new Date(event.created * 1000);
  if (rows[0].last_event_at && rows[0].last_event_at >= eventAt) {
    console.log(`ignored stale event ${event.id} for subscription ${sub.id}`);
    return;
  }
  const priceId = sub.items?.data?.[0]?.price?.id;
  const plan = deleted
    ? { id: 'free' }
    : (await db.query('SELECT id FROM plans WHERE stripe_price_id = $1', [priceId])).rows[0];
  if (!plan) throw new Error(`no plan mapped to price ${priceId}`);

  const tenantStatus = ['past_due', 'unpaid'].includes(sub.status) ? 'past_due' : 'active';

  await db.query('UPDATE tenants SET plan_id = $2, status = $3 WHERE id = $1',
    [rows[0].tenant_id, plan.id, deleted ? 'active' : tenantStatus]);

  await db.query(
    `UPDATE subscriptions SET plan_id = $2, status = $3, last_event_at = $4,
       current_period_end = to_timestamp($5), updated_at = now()
     WHERE stripe_subscription_id = $1`,
    [sub.id, plan.id, deleted ? 'canceled' : sub.status, eventAt, sub.current_period_end || null],
  );
  console.log(`tenant ${rows[0].tenant_id} -> plan ${plan.id} / ${deleted ? 'canceled' : tenantStatus} (event ${event.id})`);
}

async function applyEvent(db, event) {
  if (event.type === 'checkout.session.completed') return applyCheckoutCompleted(db, event);
  return applySubscriptionChange(db, event);
}
async function processNext() {
  return withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id, type, payload, attempts FROM webhook_events
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY received_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) return false;
    const row = rows[0];

    try {
      await applyEvent(db, row.payload);
      await db.query(
        `UPDATE webhook_events SET status = 'processed', attempts = attempts + 1, processed_at = now()
         WHERE id = $1`,
        [row.id],
      );
    } catch (err) {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      if (giveUp) {
        console.error(`ALERT webhook event ${row.id} (${row.type}) failed ${attempts} times: ${err.message}`);
      }
      await db.query(
        `UPDATE webhook_events
         SET status = $2, attempts = $3, last_error = $4,
             next_attempt_at = now() + ($5 || ' seconds')::interval
         WHERE id = $1`,
        [row.id, giveUp ? 'failed' : 'pending', attempts, err.message, 2 ** attempts],
      );
    }
    return true;
  });
}

function start() {
  let lastError = null;
  const timer = setInterval(() => {
    processNext().catch((err) => {const message = err.code || err.message || String(err);
        if (message !== lastError) {
          lastError = message;
          console.error('worker error:', err);
        }});
  }, POLL_MS);
  timer.unref(); 
  console.log(`webhook worker started (every ${POLL_MS}ms, max ${MAX_ATTEMPTS} attempts)`);
  return timer;
}

module.exports = { start, processNext };