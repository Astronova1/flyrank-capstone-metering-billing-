const express = require('express')
const { pool } = require('./db')
const { generateBody, idempotencyKey } = require('./schemas');
const { requireTenant} = require('./auth')
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

app.post('/generate', requireTenant, (req, res) => {
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

    res.json({ ok: true, key: key.data, usage: body.data }); 
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, ()=> {
        console.log(`THE server is running on http://localhost:${PORT}`)
    })