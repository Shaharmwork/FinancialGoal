import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

// A local Postgres (PGlite) with the real schema and migration, plus the parts of
// Supabase they rely on: the `authenticated` role, auth.users and auth.uid().
// Queries run as `authenticated` with row-level security on, like the app.

const root = fileURLToPath(new URL('../', import.meta.url))

export const USER_A = '11111111-1111-4111-8111-111111111111'
export const USER_B = '22222222-2222-4222-8222-222222222222'

export async function createTestDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } })

  await db.exec(`
    set timezone = 'UTC';
    create role authenticated nologin;
    create role anon nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
  `)
  await db.exec(readFileSync(`${root}supabase/schema.sql`, 'utf8'))
  await db.exec(readFileSync(`${root}supabase/migrations/20261028_safe_saving.sql`, 'utf8'))
  // Supabase grants table access to authenticated users; RLS then limits rows.
  await db.exec(`
    grant usage on schema public to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;
  `)

  return db
}

type Db = Awaited<ReturnType<typeof createTestDatabase>>

// Runs a query as a signed-in user (or signed out with userId = null).
export async function asUser<T>(db: Db, userId: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false); set role ${userId ? 'authenticated' : 'anon'};`)

  try {
    return await db.query<T>(sql, params)
  } finally {
    await db.exec('reset role;')
  }
}

export async function rpc<T = Record<string, unknown>>(
  db: Db,
  userId: string | null,
  fn: string,
  args: unknown[],
) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(', ')
  const params = args.map((arg) => (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : arg))
  const result = await asUser<{ result: T }>(db, userId, `select public.${fn}(${placeholders}) as result`, params)
  return result.rows[0].result
}
