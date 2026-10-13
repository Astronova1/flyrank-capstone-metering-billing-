const express = require('express')
const { pool } = require('./db')
const { generateBody, idempotencyKey } = require('./schemas');
const { requireTenant} = require('./auth')
const { recordGenerate } = require('./meter');
const { getUsage } = require('./usage');
const { createCheckoutSession, payMockSession, PROVIDER } = require('./payments');
const { receiveEvent } = require('./webhooks');
const app = express()
app.post('/webhooks/stripe', express.raw({ type: '*/*' }), async (req, res) => {
  const result = await receiveEvent(req.body, req.get('Stripe-Signature'));
  res.status(result.status).json(result.body);
});
app.use(express.json())

app.get('/health', async (req,res) =>{
    try{
        await pool.query('SELECT 1')
        res.json({status: 'ok', db: 'ok'})
    }
    catch{
        return res.status(503).json({status:'error', db:'Cant reach'})
    }
}) 

app.get('/usage', requireTenant, async (req, res) => {
  res.json(await getUsage(req.tenant));
});

app.post('/billing/checkout', requireTenant, async (req, res) => {
  if (req.tenant.plan_id === 'pro') {
    return res.status(409).json({ error: { code: 'already_on_pro', message: 'This tenant is already on the Pro plan.' } });
  }

  const plan = (await pool.query('SELECT * FROM plans WHERE id = $1', ['pro'])).rows[0];
  const session = await createCheckoutSession(req.tenant, plan);

  res.status(201).json({
    checkout_url: session.url,
    session_id: session.id,
    plan: plan.id,
    price_cents: plan.monthly_price_cents,
  });
});

app.post('/generate', requireTenant, async(req, res) => {
  const key = idempotencyKey.safeParse(req.get('Idempotency-Key'));
  if (!key.success) {
    return res.status(400).json({
      error: { code: 'invalid_idempotency_key', message: 'Send an Idempotency Key header.' },
    });
  }

    const body = generateBody.safeParse(req.body ?? {});
    if (!body.success) {
        return res.status(400).json({
        error: {
            code: 'validation_error',
            message: 'Invalid request body.',
            issues: body.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
        });
    }

        const result = await recordGenerate(req.tenant.id, key.data, body.data);
        res.set(result.headers || {});
        res.set('Idempotent-Replayed', String(result.replayed));
        res.status(result.status).json(result.body);
});

//mock checkout page only in mock mode because Stripe accounts are not available in Pakistan. 
if (PROVIDER === 'mock') {
  app.get('/mock-checkout/:sessionId', (req, res) => {
    const id = req.params.sessionId.replace(/[^\w-]/g, ''); // only safe characters reach the page
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Mock Checkout</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
  <h1>Mock Stripe Checkout</h1>
  <p>Subscribe to <strong>Pro</strong> — $29.00 / month</p>
  <p>Session: <code>${id}</code></p>
  <p>Test card 4242 4242 4242 4242 (not collected: no real payment exists here).</p>
  <button onclick="pay()" style="padding:.75rem 1.5rem;font-size:1rem">Pay</button>
  <pre id="out"></pre>
  <script>
    async function pay() {
      const res = await fetch('/mock-checkout/${id}/pay', { method: 'POST' });
      document.getElementById('out').textContent = JSON.stringify(await res.json(), null, 2);
    }
  </script>
</body></html>`);
  });

  app.post('/mock-checkout/:sessionId/pay', async (req, res) => {
    const result = await payMockSession(req.params.sessionId);
    res.status(result.status).json(result.body);
  });
}

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
});

    module.exports = { app };