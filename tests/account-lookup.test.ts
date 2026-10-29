import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/20261029153543_rate_limited_account_lookup.sql', import.meta.url), 'utf8')
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role unrelated;
    create schema auth;
    create table auth.users(email text, deleted_at timestamptz, is_anonymous boolean default false);
    insert into auth.users(email) values ('registered@example.test'), ('unconfirmed@example.test');
    insert into auth.users values ('deleted@example.test', now(), false), ('anonymous@example.test', null, true);
    grant usage on schema public to anon, authenticated, unrelated;
  `)
  await db.exec(migration)
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec("reset role; update private.account_lookup_budget set minute_started_at='-infinity', hour_started_at='-infinity', minute_count=0, hour_count=0")
})

async function lookup(email: string | null, role = 'anon') {
  await db.exec('set role ' + role)
  try {
    return (await db.query<{result: {status: string; exists?: boolean; retry_after?: number}}>(
      'select public.check_account_email($1) as result', [email])).rows[0].result
  } finally { await db.exec('reset role') }
}

describe('bounded anonymous email lookup', () => {
  it('matches case-insensitively, includes pending accounts, and returns only membership', async () => {
    expect(await lookup('  REGISTERED@EXAMPLE.TEST ')).toEqual({status:'ok', exists:true})
    expect(await lookup('unconfirmed@example.test')).toEqual({status:'ok', exists:true})
    for (const email of ['missing@example.test', 'deleted@example.test', 'anonymous@example.test']) {
      expect(await lookup(email)).toEqual({status:'ok', exists:false})
    }
  })
  it('rejects invalid or oversized input without querying membership', async () => {
    for (const email of [null, '', 'bad', 'a b@example.test', 'x'.repeat(255) + '@example.test']) {
      expect(await lookup(email)).toEqual({status:'invalid_email'})
    }
  })
  it('allows exactly 30 checks in a window, shared across roles, then withholds membership', async () => {
    for (let i=0;i<30;i++) expect((await lookup('missing@example.test', i % 2 ? 'authenticated' : 'anon')).status).toBe('ok')
    expect(await lookup('registered@example.test')).toMatchObject({status:'rate_limited'})
    expect(await lookup('missing@example.test')).not.toHaveProperty('exists')
    const counters = (await db.query<{minute_count:number}>('select minute_count from private.account_lookup_budget')).rows[0]
    expect(counters.minute_count).toBe(30)
    await db.exec("update private.account_lookup_budget set minute_started_at=now()-interval '61 seconds'")
    expect(await lookup('registered@example.test')).toEqual({status:'ok', exists:true})
  })
  it('enforces the hourly cap even after the minute window expires', async () => {
    await db.exec("update private.account_lookup_budget set hour_started_at=now(), hour_count=300")
    const result = await lookup('registered@example.test')
    expect(result.status).toBe('rate_limited')
    expect(result.retry_after).toBeGreaterThan(3500)
    expect(result).not.toHaveProperty('exists')
    await db.exec("update private.account_lookup_budget set hour_started_at=now()-interval '61 minutes'")
    expect((await lookup('registered@example.test')).status).toBe('ok')
  })
  it('does not grant table access, budget reset, or public function access to unrelated roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role)
      for (const sql of ['select * from auth.users', 'select * from private.account_lookup_budget', 'delete from private.account_lookup_budget']) {
        await expect(db.exec(sql)).rejects.toThrow(/permission denied/)
      }
      await db.exec('reset role')
    }
    await expect(lookup('registered@example.test', 'unrelated')).rejects.toThrow(/permission denied/)
  })
})
