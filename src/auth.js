const { pool } = require('./db');
const { sha256 } = require('./hash');

// this function find the tenant using bearer api key and attaches the plan to req.tenant
async function requireTenant(req, res, next) {
  const header = req.get('Authorization') || '';
  const match = header.match(/^Bearer (\S+)$/);
  if (!match) {
    return res.status(401).json({
      error: { code: 'unauthorized', message: 'Missing API key. Send: Authorization: Bearer <api key>' },
    });
  }

  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.plan_id, p.api_call_limit, p.ai_token_limit
     FROM tenants t
     JOIN plans p ON p.id = t.plan_id
        WHERE t.api_key_hash = $1`,
        [sha256(match[1])],
  );
  if (rows.length === 0) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid API key.' } });
  }

  req.tenant = rows[0];
  next();
}

module.exports = { requireTenant };