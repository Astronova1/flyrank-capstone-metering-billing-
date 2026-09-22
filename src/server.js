const express = require('express')
const { pool } = require('./db')
const { generateBody, idempotencyKey } = require('./schemas');
const { requireTenant} = require('./auth')
const { recordGenerate } = require('./meter');
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
        res.set('Idempotent-Replayed', String(result.replayed));
        res.status(result.status).json(result.body);
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, ()=> {
        console.log(`THE server is running on http://localhost:${PORT}`)
    })