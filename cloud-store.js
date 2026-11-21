import pg from 'pg';
import {attachDatabasePool} from '@vercel/functions';

const pools=new Map();
function databasePool(connectionString){
  if(!pools.has(connectionString)){
    const pool=new pg.Pool({connectionString,max:4,connectionTimeoutMillis:15000,query_timeout:45000,idleTimeoutMillis:10000,allowExitOnIdle:true,keepAlive:true});
    pool.on('error',error=>console.error('Database pool error',{code:error.code||'connection_error'}));
    attachDatabasePool(pool);pools.set(connectionString,pool);
  }
  return pools.get(connectionString);
}

// Session advisory locks require a DIRECT connection, never PgBouncer's transaction pool.
export async function withCloudStore(fn, { connectionString = process.env.DATABASE_URL_UNPOOLED, key = 'production' } = {}) {
  if (!connectionString) throw Error('Production database is not configured');
  const client = await databasePool(connectionString).connect();
  let locked = false;
  try {
    await client.query("SET statement_timeout = '40s'");
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['gleuhr:' + key]);
    locked = true;
    const result = await client.query('SELECT data FROM gleuhr_state WHERE id = $1', [key]);
    if (!result.rowCount) throw Error('Database has not been initialized');
    let state = result.rows[0].data;
    let persisted=JSON.stringify(state);
    const runtime = Object.fromEntries(['sessions', 'attempts', 'tests'].map(name => [name, new Map((state._runtime?.[name] || []).filter(([, value]) => value.until > Date.now()))]));
    const store = {
      get data() { return state; },
      transaction(fn) {
        const before = structuredClone(state);
        try { return fn(state); } catch (error) { state = before; throw error; }
      },
      async putMaterial(id, bytes) {
        await client.query('CREATE TABLE IF NOT EXISTS gleuhr_material_files (id text PRIMARY KEY, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
        await client.query('INSERT INTO gleuhr_material_files (id,data) VALUES ($1,$2)',[id,bytes]);
      },
      async getMaterial(id) {
        const result=await client.query('SELECT data FROM gleuhr_material_files WHERE id=$1',[id]);
        if(!result.rowCount)throw Error('Document not found');
        return result.rows[0].data;
      },
      async deleteMaterial(id) {await client.query('DELETE FROM gleuhr_material_files WHERE id=$1',[id]);},
      async flush() {
        state._runtime = Object.fromEntries(Object.entries(runtime).map(([name, values]) => [name, [...values]]));
        const serialized=JSON.stringify(state);
        if(serialized===persisted)return;
        await client.query('UPDATE gleuhr_state SET data = $2::jsonb, updated_at = now() WHERE id = $1', [key, serialized]);
        persisted=serialized;
      },
    };
    const output = await fn(store, runtime);
    await store.flush();
    return output;
  } finally {
    let releaseError;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['gleuhr:' + key]); }
    catch(error){releaseError=error;throw error;}
    finally { client.release(releaseError); }
  }
}
