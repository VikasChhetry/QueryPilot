// src/main/history.js
// JSON file-based history storage in Electron userData (per-database)

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { readConfig } = require('./config');

const HISTORY_FILE = path.join(app.getPath('userData'), 'history.json');

function ensureHistoryFile() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify({ perDb: {} }, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to initialize history file:', err);
  }
}

function getStore() {
  ensureHistoryFile();
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Migrate legacy array format to object
    if (Array.isArray(parsed)) {
      return { perDb: { __legacy__: parsed } };
    }
    if (!parsed.perDb || typeof parsed.perDb !== 'object') {
      return { perDb: {} };
    }
    return parsed;
  } catch (err) {
    console.error('Failed to read history store:', err);
    return { perDb: {} };
  }
}

function setStore(store) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write history store:', err);
  }
}

function activeDbKey() {
  const cfg = readConfig();
  return cfg.database || '__no_db__';
}

function appendHistory(entry) {
  try {
    const store = getStore();
    const key = activeDbKey();
    const list = store.perDb[key] || [];
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    list.push({ id, ...entry });
    store.perDb[key] = list;
    setStore(store);
  } catch (err) {
    console.error('Failed to append history:', err);
  }
}

function readHistory() {
  try {
    const store = getStore();
    const key = activeDbKey();
    return store.perDb[key] || [];
  } catch (err) {
    console.error('Failed to read history:', err);
    return [];
  }
}

function clearHistoryAll() {
  try {
    const store = getStore();
    const key = activeDbKey();
    store.perDb[key] = [];
    setStore(store);
    return true;
  } catch (err) {
    console.error('Failed to clear history:', err);
    return false;
  }
}

function deleteHistoryByIds(ids = []) {
  try {
    const store = getStore();
    const key = activeDbKey();
    const list = store.perDb[key] || [];
    const set = new Set(ids);
    store.perDb[key] = list.filter(h => !set.has(h.id));
    setStore(store);
    return true;
  } catch (err) {
    console.error('Failed to delete history entries:', err);
    return false;
  }
}

module.exports = {
  HISTORY_FILE,
  ensureHistoryFile,
  appendHistory,
  readHistory,
  clearHistoryAll,
  deleteHistoryByIds
};