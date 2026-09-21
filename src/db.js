const { Pool, types } = require('pg');

types.setTypeParser(20, (value) => BigInt(value));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };