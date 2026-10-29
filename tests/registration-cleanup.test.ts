import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/20261028091636_cleanup_abandoned_registrations.sql', import.meta.url), 'utf8').split('-- SCHEDULER:')[0]
let db: PGlite
let nextId = 1
const id = () => '00000000-0000-4000-8000-' + String(nextId++).padStart(12, '0')

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz, phone_confirmed_at timestamptz,
      confirmed_at timestamptz, last_sign_in_at timestamptz, invited_at timestamptz, deleted_at timestamptz,
      is_anonymous boolean default false, is_sso_user boolean default false,
      created_at timestamptz default now()-interval '8 days',
      confirmation_sent_at timestamptz, updated_at timestamptz
    );
    create table auth.identities (user_id uuid references auth.users on delete cascade, provider text);
    create table auth.sessions (user_id uuid references auth.users on delete cascade);
    create table auth.mfa_factors (user_id uuid references auth.users on delete cascade);
    create table public.profiles (id uuid references auth.users on delete cascade);
    create table public.app_settings (user_id uuid);
    create table public.daily_entries (user_id uuid);
    create table public.monthly_summaries (user_id uuid);
    create table storage.objects (owner uuid, owner_id text);
    create table storage.buckets (owner uuid, owner_id text);
  `)
  await db.exec(migration)
})
beforeEach(async () => {
  await db.exec('truncate auth.users, auth.identities, auth.sessions, auth.mfa_factors, public.profiles, public.app_settings, public.daily_entries, public.monthly_summaries, storage.objects, storage.buckets cascade')
})
afterAll(async () => { await db?.close() })

async function pending() {
  const user = id()
  await db.query('insert into auth.users (id,email) values ($1,$2)', [user, user + '@example.test'])
  await db.query("insert into auth.identities values ($1,'email')", [user])
  return user
}
async function cleanup() {
  return (await db.query<{ count: number }>('select private.cleanup_abandoned_registrations() as count')).rows[0].count
}

describe('abandoned registration cleanup', () => {
  it('deletes only an old unconfirmed signup and its email identity; a rerun is harmless', async () => {
    await pending()
    expect(await cleanup()).toBe(1)
    expect((await db.query('select * from auth.identities')).rows).toHaveLength(0)
    expect(await cleanup()).toBe(0)
  })
  it('preserves confirmed, signed-in, invited, social, anonymous, and recently active users', async () => {
    const changes = [
      "email_confirmed_at=now()", "phone_confirmed_at=now()", "confirmed_at=now()",
      "last_sign_in_at=now()-interval '20 days'", "invited_at=now()-interval '20 days'",
      "deleted_at=now()", "is_anonymous=true", "is_sso_user=true",
      "created_at=now()-interval '6 days'", "confirmation_sent_at=now()-interval '1 day'",
      "updated_at=now()-interval '1 day'", "email=null",
    ]
    for (const change of changes) {
      const user = await pending()
      await db.query('update auth.users set ' + change + ' where id=$1', [user])
    }
    const social = await pending()
    await db.query("insert into auth.identities values ($1,'google')", [social])
    const missingIdentity = await pending()
    await db.query('delete from auth.identities where user_id=$1', [missingIdentity])
    expect(await cleanup()).toBe(0)
    expect((await db.query('select id from auth.users')).rows).toHaveLength(changes.length + 2)
  })
  it('preserves any account with app data, a session, MFA, or owned storage', async () => {
    for (const table of ['public.app_settings', 'public.daily_entries', 'public.monthly_summaries', 'auth.sessions', 'auth.mfa_factors']) {
      const user = await pending()
      await db.query('insert into ' + table + ' (user_id) values ($1)', [user])
    }
    await db.query('insert into public.profiles (id) values ($1)', [await pending()])
    for (const table of ['storage.objects', 'storage.buckets']) {
      await db.query('insert into ' + table + ' (owner) values ($1)', [await pending()])
      await db.query('insert into ' + table + ' (owner_id) values ($1)', [await pending()])
    }
    expect(await cleanup()).toBe(0)
  })
  it('limits each run to 200 accounts and picks up the remainder next run', async () => {
    for (let i=0; i<201; i++) await pending()
    expect(await cleanup()).toBe(200)
    expect(await cleanup()).toBe(1)
  })
  it('does not permit application roles to call cleanup', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec('set role ' + role)
      await expect(cleanup()).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
  })
})
