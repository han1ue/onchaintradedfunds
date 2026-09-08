import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { database, assertDatabaseWrites } from '../src/server/database.ts';

export async function migrate() {
  assertDatabaseWrites();
  const { sql, schema } = database();
  await sql.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await sql.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const directory = new URL('../database/migrations/', import.meta.url);
  for (const version of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const source = await readFile(new URL(version, directory), 'utf8');
    const checksum = createHash('sha256').update(source).digest('hex');
    const existing = await sql.query(`SELECT checksum FROM ${schema}.schema_migrations WHERE version=$1`, [version]);
    if (existing.length) {
      if (existing[0].checksum !== checksum) throw new Error(`Migration checksum changed: ${version}`);
      continue;
    }
    await sql.transaction([
      sql.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${schema}:migrations`]),
      sql.query(`SELECT set_config('search_path',$1,true)`, [`${schema},public`]),
      ...source.split('-- statement-breakpoint').map(statement => sql.query(statement.trim())),
      sql.query(`INSERT INTO ${schema}.schema_migrations(version,checksum) VALUES ($1,$2)`, [version, checksum]),
    ]);
    console.log(`Applied ${version} to ${schema}`);
  }
}

export async function seed() {
  assertDatabaseWrites();
  const { sql, schema } = database();
  const source = await readFile(new URL('../database/seeds/registry.sql', import.meta.url), 'utf8');
  await sql.transaction([
    sql.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${schema}:seed`]),
    sql.query(`SELECT set_config('search_path',$1,true), set_config('otf.actor','registry-seed-v1',true)`, [`${schema},public`]),
    ...source.split('-- statement-breakpoint').map(statement => sql.query(statement.trim())),
  ]);
  console.log(`Seeded ${schema}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === 'migrate') await migrate();
    else if (command === 'seed') await seed();
    else if (command === 'inspect') {
      const { sql } = database();
      console.log(await sql.query(`SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`));
    } else if(command === 'status') {
      const {sql,schema}=database();
      console.log({schema,prices:await sql.query(`SELECT s.id,p.attempted_at,p.last_error FROM ${schema}.asset_price_sources s LEFT JOIN ${schema}.price_source_status p ON p.source_id=s.id ORDER BY s.id`),
        snapshots:await sql.query(`SELECT status,count(*)::int AS count FROM ${schema}.fund_snapshots WHERE canonical GROUP BY status`),
        progress:await sql.query(`SELECT job,block_number::text,completed_at,last_error FROM ${schema}.collector_progress ORDER BY job`)});
    } else throw new Error('Use migrate, seed, inspect or status.');
  } catch (error) {
    // Driver messages can include connection strings. Do not print raw errors.
    console.error('Database command failed.', { name: error.name, code: error.code });
    process.exitCode = 1;
  }
}
