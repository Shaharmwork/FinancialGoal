import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { ALERT_RECIPIENT, buildAlertMessage, classifyMailFailure, deliverOneAlert, type RegistrationAlert } from '../server/registration-alerts'

const migration = readFileSync(new URL('../supabase/migrations/20261029164332_registration_alerts.sql', import.meta.url), 'utf8')
let db: PGlite
const id = '11111111-1111-4111-8111-111111111111'
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role unrelated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',
      created_at timestamptz default now(),email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
    grant usage on schema public to anon,authenticated,service_role,unrelated;
  `)
  await db.exec(migration)
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade; update private.registration_alert_settings set enabled_at=now()-interval '1 minute'")
  // Test alerts have no user FK, so clear them separately.
  await db.exec('truncate private.registration_alerts')
})
async function call<T>(sql: string, args: unknown[] = [], role = 'service_role') {
  await db.exec('set role ' + role)
  try { return (await db.query<{value:T}>(sql,args)).rows[0]?.value }
  finally { await db.exec('reset role') }
}
const claim = () => call<RegistrationAlert | null>('select public.claim_registration_alert() as value')
const finish = (a: RegistrationAlert, outcome: string, token=a.claim_token) => call<boolean>(
  'select public.finish_registration_alert($1,$2,$3,null) as value', [a.id,token,outcome])
async function user(confirmed='now()', extra='') {
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values ('${id}','new@example.test',${confirmed}); ${extra}`)
}

describe('private confirmed-registration queue', () => {
  it('ignores old, unconfirmed, deleted, and anonymous accounts', async () => {
    for (const [confirmed,extra] of [
      ["now()-interval '2 days'",''], ['null',''],
      ['now()',"update auth.users set deleted_at=now()"],
      ['now()',"update auth.users set is_anonymous=true"],
    ]) {
      await db.exec('truncate auth.users cascade')
      await user(confirmed,extra)
      expect(await claim()).toBeNull()
    }
  })
  it('claims once when an account confirms, then does not repeat on profile updates', async () => {
    await user('null')
    expect(await claim()).toBeNull()
    await db.exec("update auth.users set email_confirmed_at=now(),raw_user_meta_data='{" + '"display_name":"New user"' + "}'")
    const a = (await claim())!
    expect(a).toMatchObject({email:'new@example.test',display_name:'New user',kind:'registration'})
    expect(await claim()).toBeNull()
    expect(await finish(a,'sent')).toBe(true)
    await db.exec("update auth.users set raw_user_meta_data='{}',email_confirmed_at=now()")
    expect(await claim()).toBeNull()
  })
  it('rejects stale acknowledgments and invalid states', async () => {
    await user(); const a=(await claim())!
    expect(await finish(a,'sent',id)).toBe(false)
    await expect(finish(a,'invented')).rejects.toThrow(/Invalid alert outcome/)
    expect(await finish(a,'sent')).toBe(true)
    expect(await finish(a,'retry')).toBe(false)
  })
  it('backs off known failures and stops after five attempts', async () => {
    await user()
    for(let i=0;i<5;i++) {
      const a=(await claim())!
      expect(a).not.toBeNull()
      await finish(a,'retry')
      expect(await claim()).toBeNull()
      await db.exec("update private.registration_alerts set next_attempt_at=now()-interval '1 second'")
    }
    expect(await claim()).toBeNull()
    expect((await db.query('select status,attempts from private.registration_alerts')).rows).toEqual([{status:'failed',attempts:5}])
  })
  it('parks interrupted sends instead of risking duplicate emails', async () => {
    await user(); await claim()
    await db.exec("update private.registration_alerts set claimed_at=now()-interval '11 minutes'")
    expect(await claim()).toBeNull()
    expect((await db.query('select status from private.registration_alerts')).rows[0]).toEqual({status:'uncertain'})
  })
  it('does not expose the queue or RPCs to visitors, users, or unrelated roles', async () => {
    for(const role of ['anon','authenticated','unrelated']) {
      for(const sql of [
        'select public.claim_registration_alert() as value',
        `select public.finish_registration_alert('${id}','${id}','sent',null) as value`,
        'select * from private.registration_alerts',
      ]) await expect(call(sql,[],role)).rejects.toThrow(/permission denied/)
    }
    await expect(call('select * from private.registration_alerts')).rejects.toThrow(/permission denied/)
  })
  it('removes pending alerts if their user is deleted', async () => {
    await user(); await claim(); await db.exec('delete from auth.users')
    expect(await claim()).toBeNull()
  })
})

const alert: RegistrationAlert={id,claim_token:id,kind:'registration',email:'new@example.test',display_name:'New user',registered_at:'2026-10-29T12:00:00Z',confirmed_at:'2026-10-29T12:02:00Z'}
describe('mail delivery outcomes', () => {
  it('uses fixed recipients and plain text even with malicious user metadata', () => {
    const message=buildAlertMessage({...alert,display_name:'<img src=x>\r\nBcc: attacker@example.test'})
    expect(message.to).toBe(ALERT_RECIPIENT)
    expect(message).not.toHaveProperty('html')
    expect(message.subject).not.toContain('attacker')
    expect(message.text).not.toContain('\r\nBcc')
    expect(message.text).toContain('13:02')
  })
  it('clearly labels delivery tests without claiming a real signup', () => {
    expect(buildAlertMessage({...alert,kind:'test'}).subject).toContain('[TEST]')
    expect(buildAlertMessage({...alert,kind:'test'}).text).toContain('No new user account was created')
  })
  it('separates safely retryable errors from ambiguous SMTP failures', () => {
    expect(classifyMailFailure({code:'ETIMEDOUT',command:'CONN'}).outcome).toBe('retry')
    expect(classifyMailFailure({code:'ETIMEDOUT',command:'DATA'}).outcome).toBe('uncertain')
    expect(classifyMailFailure({responseCode:421}).outcome).toBe('retry')
    expect(classifyMailFailure({responseCode:535}).outcome).toBe('failed')
  })
  it('does not send anything when no alert is pending', async () => {
    const send=vi.fn(), finish=vi.fn()
    expect(await deliverOneAlert({claim:async()=>null,send,finish})).toBe('empty')
    expect(send).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled()
  })
  it('records provider acceptance, and does not resend when acknowledgment fails', async () => {
    const send=vi.fn(async()=>({accepted:[ALERT_RECIPIENT]}))
    const finish=vi.fn(async()=>{throw new Error('db unavailable')})
    await expect(deliverOneAlert({claim:async()=>alert,send,finish})).rejects.toThrow('db unavailable')
    expect(send).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledExactlyOnceWith(alert,'sent',undefined)
  })
  it('parks ambiguous sends and retries explicit temporary rejection', async () => {
    for(const [error,outcome] of [[{code:'ETIMEDOUT',command:'DATA'},'uncertain'],[{code:'EENVELOPE',responseCode:450},'retry']] as const) {
      const finish=vi.fn(async()=>{})
      expect(await deliverOneAlert({claim:async()=>alert,send:async()=>{throw error},finish})).toBe(outcome)
      expect(finish).toHaveBeenCalledExactlyOnceWith(alert,outcome,error.code)
    }
  })
})
