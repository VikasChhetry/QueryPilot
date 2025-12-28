// src/main/nlp.js
// Very naive NL -> SQL rules for MVP

function nlpToSql(nlText) {
  const txtRaw = (nlText || '').trim();
  const txt = txtRaw.toLowerCase();
  if (!txt) return { sql: '', explanation: 'No input provided.' };

  // Simple reads
  if (txt.includes('show tables')) {
    return { sql: 'SHOW TABLES;', explanation: 'List all tables in the current database.' };
  }
  if (txt.includes('list databases') || txt.includes('show databases')) {
    return { sql: 'SHOW DATABASES;', explanation: 'List all databases on the server.' };
  }
  const getAllMatch = txt.match(/^get\s+all\s+(?:from\s+)?([a-zA-Z0-9_]+)$/);
  if (getAllMatch) {
    const table = getAllMatch[1];
    return { sql: `SELECT * FROM ${table};`, explanation: `Select all rows from table ${table}.` };
  }
  const countMatch = txt.match(/^count\s+([a-zA-Z0-9_]+)$/);
  if (countMatch) {
    const table = countMatch[1];
    return { sql: `SELECT COUNT(*) AS count FROM ${table};`, explanation: `Count rows in table ${table}.` };
  }
  const whereMatch = txt.match(/^show\s+rows\s+from\s+([a-zA-Z0-9_]+)\s+where\s+(.+)$/);
  if (whereMatch) {
    const table = whereMatch[1];
    const condition = whereMatch[2];
    return { sql: `SELECT * FROM ${table} WHERE ${condition};`, explanation: `Select rows from ${table} with condition: ${condition}.` };
  }

  // Database selection
  const useDbMatch = txt.match(/^(?:use|select)\s+database\s+([a-zA-Z0-9_]+)$/);
  if (useDbMatch) {
    const dbName = useDbMatch[1];
    return { sql: `USE ${dbName};`, explanation: `Switch active database to ${dbName}.` };
  }

  // Database DDL
  const createDb = txt.match(/^create\s+(?:a\s+)?database\s+([a-zA-Z0-9_]+)$/);
  if (createDb) {
    const name = createDb[1];
    return { sql: `CREATE DATABASE ${name};`, explanation: `Create database ${name}.` };
  }
  const dropDb = txt.match(/^(?:drop|delete|remove)\s+database\s+([a-zA-Z0-9_]+)$/);
  if (dropDb) {
    const name = dropDb[1];
    return { sql: `DROP DATABASE ${name};`, explanation: `Drop database ${name}.` };
  }

  // Table DDL: "create table users with columns id int, name varchar(100)"
  const createTable = txt.match(/^create\s+table\s+([a-zA-Z0-9_]+)\s+with\s+columns\s+(.+)$/);
  if (createTable) {
    const table = createTable[1];
    const colsRaw = createTable[2].split(',').map(s => s.trim());
    const cols = colsRaw.map(p => {
      // expect "name type", keep as-is from original casing
      const original = colsRaw.find(x => x.toLowerCase() === p.toLowerCase()) || p;
      return original;
    });
    return { sql: `CREATE TABLE ${table} (${cols.join(', ')});`, explanation: `Create table ${table} with specified columns.` };
  }
  const dropTable = txt.match(/^(?:drop|delete|remove)\s+table\s+([a-zA-Z0-9_]+)$/);
  if (dropTable) {
    const table = dropTable[1];
    return { sql: `DROP TABLE ${table};`, explanation: `Drop table ${table}.` };
  }

  // Insert: "insert into users name=John, age=30" or "add row to users: name=John age=30"
  const insert1 = txtRaw.match(/^insert\s+into\s+([a-zA-Z0-9_]+)\s+(.+)$/i);
  const insert2 = txtRaw.match(/^add\s+row\s+(?:to\s+)?([a-zA-Z0-9_]+)\s*:?\s+(.+)$/i);
  if (insert1 || insert2) {
    const table = (insert1 ? insert1[1] : insert2[1]);
    const kvRaw = (insert1 ? insert1[2] : insert2[2]);
    const parts = kvRaw.split(/[,\s]+/).filter(Boolean);
    const pairs = parts.map(p => p.split('='));
    const cols = pairs.map(([k]) => k);
    const vals = pairs.map(([,v]) => {
      const vtrim = (v || '').trim();
      return /^-?\d+(?:\.\d+)?$/.test(vtrim) ? vtrim : `'${vtrim.replace(/'/g, "''")}'`;
    });
    return { sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${vals.join(',')});`, explanation: `Insert one row into ${table}.` };
  }

  // Update: "update users set age=31 where name='John'"
  const updateMatch = txtRaw.match(/^update\s+([a-zA-Z0-9_]+)\s+set\s+(.+?)\s+where\s+(.+)$/i);
  if (updateMatch) {
    const table = updateMatch[1];
    const setClause = updateMatch[2];
    const whereClause = updateMatch[3];
    return { sql: `UPDATE ${table} SET ${setClause} WHERE ${whereClause};`, explanation: `Update rows in ${table}.` };
  }

  // Delete: "delete from users where id=5"
  const deleteMatch = txtRaw.match(/^delete\s+from\s+([a-zA-Z0-9_]+)\s+where\s+(.+)$/i);
  if (deleteMatch) {
    const table = deleteMatch[1];
    const whereClause = deleteMatch[2];
    return { sql: `DELETE FROM ${table} WHERE ${whereClause};`, explanation: `Delete rows from ${table}.` };
  }

  // Show columns
  const showCols = txt.match(/^show\s+columns\s+(?:from\s+)?([a-zA-Z0-9_]+)$/);
  if (showCols) {
    const table = showCols[1];
    return { sql: `SHOW COLUMNS FROM ${table};`, explanation: `Show columns for ${table}.` };
  }

  // Direct SELECT or other SQL
  if (txt.startsWith('select ') || /^(create|drop|delete|update|insert|truncate|use)\s+/.test(txt)) {
    return { sql: txtRaw, explanation: 'Interpreted as a direct SQL statement.' };
  }

  return { sql: '', explanation: 'Could not interpret the request. Try more specific phrasing.' };
}

module.exports = { nlpToSql };