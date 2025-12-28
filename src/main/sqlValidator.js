// src/main/sqlValidator.js
// Safety validation and simple checks

const { BLOCKED_DATABASES } = require('./constants');

function validateSql(sql) {
  const raw = (sql || '').trim();
  if (!raw) return { ok: false, requiresConfirmation: false, message: 'Empty SQL.' };

  const lowered = raw.toLowerCase();
  const isDestructive = /(drop\s+table|drop\s+database|delete\s+from|truncate\s+table|update\s+\w+)/.test(lowered);

  // Block use of system databases
  const referencesBlockedDb = BLOCKED_DATABASES.some(db => lowered.includes(`${db}.`) || lowered.includes(`use ${db}`));
  if (referencesBlockedDb) {
    return { ok: false, requiresConfirmation: false, message: 'Query references a blocked system database.' };
  }

  return {
    ok: true,
    requiresConfirmation: isDestructive,
    message: isDestructive ? 'Destructive operation detected. Confirmation is required.' : 'Query looks safe.'
  };
}

module.exports = { validateSql };