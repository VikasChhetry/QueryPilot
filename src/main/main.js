// NLQMS – Electron main process (refactored MVP)
// - Window lifecycle
// - IPC endpoints using separated modules (NLP, validation, DB, history)
// - Limited undo support for DELETE ... WHERE queries

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { llmToSql, llmExplainSql } = require('./llm');
const { validateSql } = require('./sqlValidator');
const { execute } = require('./db');
const { ensureHistoryFile, appendHistory, readHistory, clearHistoryAll, deleteHistoryByIds } = require('./history');
const { ensureConfigFile, readConfig, writeConfig, testConnection } = require('./config');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // MVP: simplify renderer access; will harden later
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';"
    },
    icon: path.join(__dirname, '../../assets/icon.png') // Set app icon
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// Attempt to capture undo data for DELETE ... WHERE
async function executeWithUndo(sql, { confirmed = false } = {}) {
  const validation = validateSql(sql);
  if (!validation.ok) {
    return { ok: false, error: validation.message };
  }

  // Intercept "USE database" to persist selection in config
  const useMatch = sql.match(/^\s*use\s+([a-zA-Z0-9_]+);?\s*$/i);
  if (useMatch) {
    const dbName = useMatch[1];
    const current = readConfig();
    writeConfig({ ...current, database: dbName });
    appendHistory({ timestamp: new Date().toISOString(), sql, meta: { affectedRows: null } });
    return { ok: true, type: 'write', affectedRows: 0 };
  }

  if (validation.requiresConfirmation && !confirmed) {
    const res = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Proceed'],
      defaultId: 0,
      title: 'Confirm Destructive Query',
      message: 'This SQL may modify or delete data. Proceed?',
      detail: sql
    });
    if (res.response !== 1) {
      return { ok: false, error: 'Execution cancelled by user.' };
    }
  }

  const deleteMatch = sql.match(/^\s*delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+(.+);?\s*$/i);
  const isRowset = /^\s*(select|show|describe|explain)\b/i.test(sql);

  try {
    if (deleteMatch) {
      const table = deleteMatch[1];
      const whereClause = deleteMatch[2];
      // Transaction: capture rows before delete
      const result = await execute(sql, async (conn) => {
        await conn.beginTransaction();
        const [rowsBefore] = await conn.query(`SELECT * FROM ${table} WHERE ${whereClause}`);
        const [rows, meta] = await conn.execute(sql);
        await conn.commit();
        return { rows, meta, undo: { type: 'DELETE', table, rows: rowsBefore } };
      });

      appendHistory({
        timestamp: new Date().toISOString(),
        sql,
        meta: { affectedRows: result.meta?.affectedRows ?? null },
        undo: result.undo
      });
      return { ok: true, type: 'write', affectedRows: result.meta?.affectedRows ?? 0 };
    }

    // Non-DELETE
    const { rows, meta } = await execute(sql);
    appendHistory({ timestamp: new Date().toISOString(), sql, meta: { affectedRows: meta?.affectedRows ?? null } });
    if (isRowset) return { ok: true, type: 'rows', rows };
    return { ok: true, type: 'write', affectedRows: meta?.affectedRows ?? 0 };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      explanation: 'The database reported an error. Please check table names, column names, and syntax.'
    };
  }
}

async function undoLastQuery() {
  const history = readHistory();
  if (!history.length) return { ok: false, error: 'No history to undo.' };
  const last = history[history.length - 1];
  if (!last.undo || last.undo.type !== 'DELETE') {
    return { ok: false, error: 'Undo is only available for DELETE ... WHERE queries captured in MVP.' };
  }
  const { table, rows } = last.undo;
  if (!rows || !rows.length) {
    return { ok: false, error: 'No captured rows available to restore.' };
  }

  // Re-insert captured rows
  try {
    const cols = Object.keys(rows[0]);
    const placeholders = '(' + cols.map(() => '?').join(',') + ')';
    const insertSql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${rows.map(() => placeholders).join(',')}`;
    const values = rows.flatMap(r => cols.map(c => r[c]));
    const { execute: execRaw } = require('./db');
    const { meta } = await execRaw(insertSql);
    appendHistory({ timestamp: new Date().toISOString(), sql: insertSql, meta: { affectedRows: meta?.affectedRows ?? null } });
    return { ok: true, type: 'write', affectedRows: meta?.affectedRows ?? rows.length };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function setupIpc() {
  // NLP/Validation/Execution
  ipcMain.handle('nlqms:convert', async (_evt, nlText) => llmToSql(nlText));
  ipcMain.handle('nlqms:validate', async (_evt, sql) => validateSql(sql));
  ipcMain.handle('nlqms:execute', async (_evt, sql, options) => executeWithUndo(sql, options || {}));

  // History
  ipcMain.handle('nlqms:getHistory', async () => readHistory());
  ipcMain.handle('nlqms:undoLast', async () => undoLastQuery());
  ipcMain.handle('nlqms:clearHistoryAll', async () => ({ ok: clearHistoryAll() }));
  ipcMain.handle('nlqms:deleteHistorySelection', async (_evt, ids) => ({ ok: deleteHistoryByIds(ids || []) }));
  ipcMain.handle('nlqms:explainSql', async (_evt, sql) => {
    let sqlToExplain = sql;
    const validation = validateSql(sql);
    if (!validation.ok) {
      // If the input is not valid SQL, try to convert it from NL to SQL
      const conversionResult = await llmToSql(sql);
      if (conversionResult.ok) {
        sqlToExplain = conversionResult.sql;
      } else {
        return { ok: false, error: `Invalid SQL and failed to convert from NL: ${conversionResult.error}` };
      }
    }

    try {
      const { explanation } = await llmExplainSql(sqlToExplain);
      return { ok: true, explanation: explanation };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // DB Config
  ipcMain.handle('nlqms:getDbConfig', async () => readConfig());
  ipcMain.handle('nlqms:setDbConfig', async (_evt, cfg) => ({ ok: true, config: writeConfig(cfg || {}) }));
  ipcMain.handle('nlqms:testDbConnection', async (_evt, cfg) => testConnection(cfg));
  ipcMain.handle('nlqms:listDatabases', async () => {
    try {
      const { rows } = await execute('SHOW DATABASES;');
      const names = rows.map(r => Object.values(r)[0]);
      return { ok: true, databases: names };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('nlqms:setActiveDatabase', async (_evt, dbName) => {
    const current = readConfig();
    const updated = writeConfig({ ...current, database: dbName });
    return { ok: true, config: updated };
  });

  // Export
  ipcMain.handle('nlqms:export', async (_evt, { type, sql }) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export SQL',
      defaultPath: path.join(os.homedir(), 'nlqms_export.sql'),
      filters: [{ name: 'SQL', extensions: ['sql'] }]
    });
    if (canceled || !filePath) return { ok: false, error: 'Export cancelled.' };

    try {
      if (type === 'single') {
        fs.writeFileSync(filePath, (sql || '').trim() + '\n', 'utf-8');
      } else {
        const history = readHistory();
        const buf = history.map(h => `-- ${h.timestamp}\n${h.sql}\n`).join('\n');
        fs.writeFileSync(filePath, buf, 'utf-8');
      }
      return { ok: true, message: 'Exported successfully.' };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

app.whenReady().then(() => {
  ensureConfigFile();
  ensureHistoryFile();
  setupIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});