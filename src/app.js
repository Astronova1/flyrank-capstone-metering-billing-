const express = require('express')
const { pool } = require('./db')
const { generateBody, idempotencyKey } = require('./schemas');
const { requireTenant} = require('./auth')
const { recordGenerate } = require('./meter');
const { getUsage } = require('./usage');
const { createCheckoutSession } = require('./payments');
const app = express()
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

    module.exports = { app };