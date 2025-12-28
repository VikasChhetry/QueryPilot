// src/main/db.js
// MySQL execution utility

const mysql = require('mysql2/promise');
const { readConfig } = require('./config');

async function execute(sql, handler) {
  const cfg = readConfig();
  let conn;
  try {
    conn = await mysql.createConnection(cfg);
    if (handler) {
      return await handler(conn);
    }
    const [rows, meta] = await conn.execute(sql);
    return { rows, meta };
  } finally {
    try { await conn?.end(); } catch (_) {}
  }
}

module.exports = { execute };