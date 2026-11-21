import fs from 'node:fs';
import pg from 'pg';
const source = process.argv[2];
if (!source) throw Error('Pass the local database.json path');
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!data.users?.some(u => u.role === 'admin' && u.active)) throw Error('Create your local admin before migrating');
delete data._runtime;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await db.connect();
try {
  await db.query(fs.readFileSync(new URL('../migrations/001-state.sql', import.meta.url), 'utf8'));
  const r = await db.query('INSERT INTO gleuhr_state (id, data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', ['production', JSON.stringify(data)]);
  console.log(r.rowCount ? 'Local database securely migrated. Existing admin credentials preserved.' : 'Production database already exists; no data overwritten.');
} finally { await db.end(); }
