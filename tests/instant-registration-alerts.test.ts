import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
let db: PGlite
const userId='11111111-1111-4111-8111-111111111111'
const otherId='22222222-2222-4222-8222-222222222222'
beforeAll(async () => {
  db=new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',
      created_at timestamptz default now(),email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
    grant usage on schema public to anon,authenticated,service_role;
    grant usage on schema auth to supabase_auth_admin;
    grant select,insert,update on auth.users to supabase_auth_admin;
    -- A transactional HTTP queue stub: no test performs a network request.
    create schema net;
    create table net.http_request_queue(id bigint generated always as identity, url text, body jsonb, headers jsonb, timeout_milliseconds integer);
    create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
    returns bigint language plpgsql as $$ declare request_id bigint; begin
      if current_setting('test.net_fail',true)='on' then raise exception 'Network queue unavailable'; end if;
      insert into net.http_request_queue(url,body,headers,timeout_milliseconds)
      values ($1,$2,$3,$4) returning id into request_id;
      return request_id;
    end $$;
  `)
  await db.exec(read('20261029164332_registration_alerts.sql'))
  await db.exec(read('20261029171857_instant_registration_alerts.sql').replace('CREATE EXTENSION IF NOT EXISTS pg_net;', ''))
})
afterAll(async()=>{await db?.close()})
beforeEach(async()=>{
  await db.exec("reset role; truncate auth.users cascade; truncate private.registration_alerts; truncate net.http_request_queue; select set_config('test.net_fail','off',false); update private.registration_alert_settings set enabled_at=now()-interval '1 minute',webhooks_enabled=true")
})
async function auth(sql:string) {
  await db.exec('set role supabase_auth_admin')
  try { await db.exec(sql) } finally { await db.exec('reset role') }
}
async function claim(id:string,token:string,role='service_role') {
  await db.exec('set role '+role)
  try { return (await db.query<{result: {id:string;claim_token:string}|null}>('select public.claim_registration_alert_event($1,$2) as result',[id,token])).rows[0].result }
  finally { await db.exec('reset role') }
}
async function createConfirmed() {
  await auth(`insert into auth.users(id,email,email_confirmed_at) values ('${userId}','new@example.test',now())`)
  return (await db.query<{id:string;webhook_token:string}>('select id,webhook_token from private.registration_alerts')).rows[0]
}

describe('immediate registration triggers',()=>{
  it('supports deployment with dispatch disabled while the scheduled fallback still works',async()=>{
    await db.exec('update private.registration_alert_settings set webhooks_enabled=false')
    await createConfirmed()
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(0)
    expect((await db.query<{result:unknown}>('select public.claim_registration_alert() as result')).rows[0].result).not.toBeNull()
  })
  it('dispatches only after confirmation and only once, with no account data in the webhook',async()=>{
    await auth(`insert into auth.users(id,email) values ('${userId}','new@example.test')`)
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(0)
    await auth(`update auth.users set email_confirmed_at=now() where id='${userId}'`)
    const requests=(await db.query<{body:Record<string,string>;url:string}>('select body,url from net.http_request_queue')).rows
    expect(requests).toHaveLength(1)
    expect(Object.keys(requests[0].body).sort()).toEqual(['id','token'])
    expect(requests[0].url).toBe('https://businessfinancialgoal.netlify.app/.netlify/functions/registration-alert-event')
    await auth(`update auth.users set email_confirmed_at=now(),raw_user_meta_data='{"display_name":"Changed"}' where id='${userId}'`)
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(1)
  })
  it('also handles already-confirmed inserts but ignores historical, deleted and anonymous users',async()=>{
    await createConfirmed()
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(1)
    await db.exec(`insert into auth.users(id,email,email_confirmed_at,is_anonymous) values ('${otherId}','anonymous@example.test',now(),true)`)
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(1)
    await db.exec(`delete from auth.users where id='${otherId}'; insert into auth.users(id,email,email_confirmed_at,deleted_at) values ('${otherId}','deleted@example.test',now(),now())`)
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(1)
    await db.exec(`delete from auth.users where id='${otherId}'; insert into auth.users(id,email,email_confirmed_at) values ('${otherId}','old@example.test',now()-interval '1 year')`)
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(1)
  })
  it('requires the matching token, consumes it, and cannot claim another event',async()=>{
    const row=await createConfirmed()
    expect(await claim(row.id,otherId)).toBeNull()
    expect(await claim(otherId,row.webhook_token)).toBeNull()
    expect(await claim(row.id,row.webhook_token)).toMatchObject({id:row.id})
    expect(await claim(row.id,row.webhook_token)).toBeNull()
    expect((await db.query('select webhook_token,attempts from private.registration_alerts')).rows[0]).toEqual({webhook_token:null,attempts:1})
    expect((await db.query('select public.claim_registration_alert() as result')).rows[0]).toEqual({result:null})
  })
  it('cannot send twice if the scheduled fallback wins the claim',async()=>{
    const row=await createConfirmed()
    await db.query('select public.claim_registration_alert()')
    expect(await claim(row.id,row.webhook_token)).toBeNull()
    expect((await db.query('select attempts from private.registration_alerts')).rows[0]).toEqual({attempts:1})
  })
  it('does not expose event claims or tokens to app users',async()=>{
    const row=await createConfirmed()
    for(const role of ['anon','authenticated']) {
      await expect(claim(row.id,row.webhook_token,role)).rejects.toThrow(/permission denied/)
      await db.exec('set role '+role)
      await expect(db.query('select * from private.registration_alerts')).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
  })
  it('retains a queued alert when HTTP dispatch fails without failing confirmation',async()=>{
    await db.exec("select set_config('test.net_fail','on',false)")
    await createConfirmed()
    expect((await db.query('select status,webhook_error from private.registration_alerts')).rows[0]).toEqual({status:'pending',webhook_error:'dispatch_failed'})
    expect((await db.query<{result:unknown}>('select public.claim_registration_alert() as result')).rows[0].result).not.toBeNull()
  })
  it('lets confirmation succeed if enqueue fails and the fallback recovers it',async()=>{
    await db.exec("alter table private.registration_alerts add constraint test_reject check(email <> 'new@example.test')")
    try {
      await auth(`insert into auth.users(id,email,email_confirmed_at) values ('${userId}','new@example.test',now())`)
      expect((await db.query('select * from private.registration_alerts')).rows).toHaveLength(0)
    } finally { await db.exec('alter table private.registration_alerts drop constraint test_reject') }
    expect((await db.query<{result:unknown}>('select public.claim_registration_alert() as result')).rows[0].result).not.toBeNull()
  })
  it('rolls back the notification together with an aborted registration transaction',async()=>{
    await db.exec('begin')
    await createConfirmed()
    await db.exec('rollback')
    expect((await db.query('select * from private.registration_alerts')).rows).toHaveLength(0)
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(0)
  })
})
