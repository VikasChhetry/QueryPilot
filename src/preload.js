// src/preload.js
// Preload script to safely expose limited APIs to the renderer via contextBridge.
// MVP: expose a minimal API and stubs for later expansion.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('nlqms', {
  // Version info as a simple smoke test
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }
  // Future: add IPC-backed methods for:
  // - parseTextToSQL(text)
  // - validateSQL(sql)
  // - executeSQL(sql, connectionConfig)
  // - getHistory()
  // - undoLast()
  // - exportHistory()
});