// src/main/config.js
// Manage MySQL connection configuration stored in Electron's userData

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: '',
  password: '',
  database: ''
};

function getConfigPath() {
  const p = path.join(app.getPath('userData'), 'db.config.json');
  return p;
}

function ensureConfigFile() {
  const file = getConfigPath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }
}

function readConfig() {
  try {
    const file = getConfigPath();
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(file, 'utf-8');
    const cfg = JSON.parse(raw);
    // Ensure defaults for missing fields
    return { ...DEFAULT_CONFIG, ...cfg };
  } catch (err) {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(newConfig) {
  const file = getConfigPath();
  const merged = { ...DEFAULT_CONFIG, ...newConfig };
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

async function testConnection(optionalConfig) {
  const cfg = optionalConfig ? { ...DEFAULT_CONFIG, ...optionalConfig } : readConfig();
  let conn;
  try {
    conn = await mysql.createConnection(cfg);
    await conn.query('SELECT 1');
    return { ok: true, message: 'Connected successfully.' };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  } finally {
    try { await conn?.end(); } catch (_) {}
  }
}

module.exports = { getConfigPath, ensureConfigFile, readConfig, writeConfig, testConnection };
