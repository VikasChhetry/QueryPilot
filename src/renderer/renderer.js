// src/renderer/renderer.js
// MVP UI logic: text/voice to SQL, preview, validation, execution, history, export

const { ipcRenderer } = require('electron');

// Elements
const envInfo = document.getElementById('envInfo');
const nlInput = document.getElementById('nlInput');
const voiceBtn = document.getElementById('voiceBtn');
const generateBtn = document.getElementById('generateBtn');
const executeBtn = document.getElementById('executeBtn');
const undoBtn = document.getElementById('undoBtn');
const exportBtn = document.getElementById('exportBtn');
const sqlPreview = document.getElementById('sqlPreview');
const validationMsg = document.getElementById('validationMsg');
const results = document.getElementById('results');
const errorMsg = document.getElementById('errorMsg');
const historyList = document.getElementById('historyList');

// Show environment info (Electron/Node/Chrome versions)
envInfo.textContent = `Electron ${process.versions.electron} • Node ${process.versions.node} • Chrome ${process.versions.chrome}`;

// Helpers
function renderRows(rows) {
  if (!rows || !rows.length) { results.innerHTML = '<p>No rows.</p>'; return; }
  const cols = Object.keys(rows[0]);
  let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr>' + cols.map(c => `<td>${String(r[c])}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table>';
  results.innerHTML = html;
}

async function refreshHistory() {
  const history = await ipcRenderer.invoke('nlqms:getHistory');
  historyList.innerHTML = '';
  history.slice().reverse().forEach(h => {
    const li = document.createElement('li');
    li.textContent = `${h.timestamp} — ${h.sql}`;
    historyList.appendChild(li);
  });
}

// Events
generateBtn.addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('nlqms:convert', nlInput.value);
  sqlPreview.textContent = res.sql || '';
  validationMsg.textContent = res.explanation || '';
  errorMsg.textContent = '';
});

executeBtn.addEventListener('click', async () => {
  const sql = (sqlPreview.textContent || '').trim();
  if (!sql) { errorMsg.textContent = 'No SQL to execute.'; return; }
  const v = await ipcRenderer.invoke('nlqms:validate', sql);
  let confirmed = false;
  if (v.requiresConfirmation) confirmed = confirm('Destructive query detected. Proceed?');
  const res = await ipcRenderer.invoke('nlqms:execute', sql, { confirmed });
  if (!res.ok) {
    errorMsg.textContent = res.error || 'Execution failed.';
    results.innerHTML = '';
    return;
  }
  errorMsg.textContent = '';
  if (res.type === 'rows') renderRows(res.rows);
  else results.innerHTML = `<p>Affected rows: ${res.affectedRows || 0}</p>`;
  await refreshHistory();
});

undoBtn.addEventListener('click', async () => {
  const res = await ipcRenderer.invoke('nlqms:undoLast');
  if (!res.ok) { errorMsg.textContent = res.error || 'Undo failed.'; return; }
  errorMsg.textContent = '';
  await refreshHistory();
});

exportBtn.addEventListener('click', async () => {
  const sql = sqlPreview.textContent || '';
  const res = await ipcRenderer.invoke('nlqms:export', { type: 'single', sql });
  if (!res.ok) errorMsg.textContent = res.error || 'Export failed.';
});

// Voice input via Web Speech API
let recognizer = null; let listening = false;
function getRecognizer() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.continuous = false;
  r.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    nlInput.value = transcript;
    generateBtn.click();
  };
  r.onerror = (e) => { console.log('Speech error', e); };
  r.onend = () => { listening = false; voiceBtn.textContent = '🎤 Voice'; };
  return r;
}

voiceBtn.addEventListener('click', () => {
  if (!recognizer) recognizer = getRecognizer();
  if (!recognizer) { errorMsg.textContent = 'Web Speech API not supported in this environment.'; return; }
  if (listening) { recognizer.stop(); listening = false; voiceBtn.textContent = '🎤 Voice'; }
  else { recognizer.start(); listening = true; voiceBtn.textContent = '⏹ Stop'; }
});

// Init
refreshHistory();