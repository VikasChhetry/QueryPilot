// src/main/llm.js
// Ollama-powered NL -> SQL conversion (offline LLM)

const { execute } = require('./db');

const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.1'; // change if you prefer another local model

// Few-shot examples to steer the model toward MySQL-friendly SQL
const EXEMPLARS = [
  { i: 'Can you show me all the databases that exist on my system?', o: 'SHOW DATABASES;' },
  { i: 'I want to see what databases are available.', o: 'SHOW DATABASES;' },
  { i: 'Please create a new database called college_management.', o: 'CREATE DATABASE college_management;' },
  { i: 'Remove the database named old_project.', o: 'DROP DATABASE old_project;' },
  { i: 'Show me all the tables inside this database.', o: 'SHOW TABLES;' },
  { i: 'What tables do I currently have?', o: 'SHOW TABLES;' },
  { i: 'Create a table called students with id, name, and age.', o: 'CREATE TABLE students (id INT, name VARCHAR(255), age INT);' },
  { i: 'I want to see all the students.', o: 'SELECT * FROM students;' },
  { i: 'Show me every record from the users table.', o: 'SELECT * FROM users;' },
  { i: 'Add a new student with id 1, name Rahul, and age 20.', o: "INSERT INTO students (id, name, age) VALUES (1, 'Rahul', 20);" },
  { i: 'Insert a user whose email is test@gmail.com and password is 1234.', o: "INSERT INTO users (email, password) VALUES ('test@gmail.com', '1234');" },
  { i: 'Change the name of the student with id 1 to Aman.', o: "UPDATE students SET name = 'Aman' WHERE id = 1;" },
  { i: 'Update the user’s email to admin@gmail.com where id is 5.', o: "UPDATE users SET email = 'admin@gmail.com' WHERE id = 5;" },
  { i: 'Delete the student whose roll number is 10.', o: 'DELETE FROM students WHERE roll_number = 10;' },
  { i: 'Remove the user with email test@gmail.com.', o: "DELETE FROM users WHERE email = 'test@gmail.com';" },
  { i: 'How many students are there in total?', o: 'SELECT COUNT(*) AS count FROM students;' },
  { i: 'Count the number of users present in the system.', o: 'SELECT COUNT(*) AS count FROM users;' },
  { i: 'Show students whose age is greater than 18.', o: 'SELECT * FROM students WHERE age > 18;' },
  { i: 'Display the details of the student where id equals 3.', o: 'SELECT * FROM students WHERE id = 3;' },
  { i: 'I accidentally created a table, can you show me all tables again?', o: 'SHOW TABLES;' }
];

async function getSchemaText() {
  try {
    const { rows } = await execute('SHOW TABLES;');
    const tableNames = rows.map(r => Object.values(r)[0]);
    if (!tableNames.length) return 'No tables found in the current database.';

    const parts = [];
    for (const t of tableNames) {
      try {
        const { rows: cols } = await execute(`SHOW COLUMNS FROM ${t};`);
        const colList = cols.map(c => `${c.Field} ${c.Type}`).join(', ');
        parts.push(`- ${t}: ${colList}`);
      } catch (_) {
        parts.push(`- ${t}: (columns unavailable)`);
      }
    }
    return `Tables and columns in active database:\n${parts.join('\n')}`;
  } catch (err) {
    return 'Schema introspection failed.';
  }
}

function buildPrompt(nlText, schemaText) {
  const exText = EXEMPLARS.map((e, idx) => `Example ${idx + 1}\nInstruction: ${e.i}\nSQL: ${e.o}`).join('\n\n');
  return [
    'You are a MySQL SQL generator. Convert the instruction to a single SQL statement.',
    'Rules:',
    '- Output ONLY the SQL (no explanation, no markdown).',
    '- Prefer safe queries with WHERE clauses for destructive operations.',
    '- Use only tables/columns that appear in the provided schema if relevant.',
    '- If the user asks for DDL (create/drop), write the appropriate MySQL DDL.',
    '- If uncertain, produce your best-effort SQL for MySQL.',
    '',
    'Schema:',
    schemaText,
    '',
    'Examples:',
    exText,
    '',
    'Instruction:',
    nlText
  ].join('\n');
}

async function callOllamaGenerate(prompt, { endpoint = DEFAULT_OLLAMA_ENDPOINT, model = DEFAULT_MODEL, temperature = 0.1 } = {}) {
  const url = `${endpoint}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, temperature })
  });
  if (!res.ok) {
    throw new Error(`Ollama request failed (${res.status})`);
  }
  const data = await res.json();
  let text = (data.response || '').trim();
  // Strip fenced code blocks if present
  text = text.replace(/^```sql\s*/i, '').replace(/\s*```$/i, '').trim();
  // Ensure ending semicolon if looks like SQL without one
  if (text && !/;\s*$/.test(text)) text = text + ';';
  return text;
}

async function llmToSql(nlText, options = {}) {
  const cleaned = (nlText || '').trim();
  if (!cleaned) return { sql: '', explanation: 'No input provided.' };
  const schemaText = await getSchemaText();
  const prompt = buildPrompt(cleaned, schemaText);
  try {
    const sql = await callOllamaGenerate(prompt, options);
    return { sql, explanation: `Generated by Ollama model (${options.model || DEFAULT_MODEL}).` };
  } catch (err) {
    return { sql: '', explanation: `Ollama error: ${err.message}. Ensure Ollama is running and the model is pulled.` };
  }
}

async function llmExplainSql(sql, options = {}) {
  const cleaned = (sql || '').trim();
  if (!cleaned) return { explanation: 'No SQL provided for explanation.' };

  const prompt = [
    'You are a helpful assistant that explains SQL queries in natural language.',
    'Explain the following MySQL SQL query in a concise, human-readable way, focusing on what it does and what changes it might make to the database.',
    'SQL:',
    cleaned
  ].join('\n');

  try {
    const explanation = await callOllamaGenerate(prompt, { ...options, temperature: 0.3 }); // Use a slightly higher temperature for more creative explanations
    return { explanation };
  } catch (err) {
    return { explanation: `Ollama error during explanation: ${err.message}.` };
  }
}

module.exports = { llmToSql, llmExplainSql, getSchemaText, callOllamaGenerate };