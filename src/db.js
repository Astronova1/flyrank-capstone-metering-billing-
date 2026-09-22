const { Pool, types } = require('pg');

types.setTypeParser(20, (value) => BigInt(value));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };