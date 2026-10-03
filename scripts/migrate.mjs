/**
 * Applies db/schema.sql to the Neon database in DATABASE_URL.
 * Usage: DATABASE_URL=postgres://... npm run db:migrate
 * (falls back to reading DATABASE_URL from .dev.vars)
 */
import { readFileSync, existsSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

let url = process.env.DATABASE_URL;
if (!url && existsSync('.dev.vars')) {
  const line = readFileSync('.dev.vars', 'utf8').split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
  url = line?.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '');
}
if (!url) {
  console.error('DATABASE_URL is not set (env or .dev.vars).');
  process.exit(1);
}

const sql = neon(url);
const statements = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
  .replace(/--.*$/gm, '')
  .split(';')
  .map(s => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
  console.log('✔', statement.split('\n')[0]);
}
console.log(`Applied ${statements.length} statements.`);
