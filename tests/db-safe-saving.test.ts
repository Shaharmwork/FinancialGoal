import { beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDatabase, rpc, USER_A, USER_B } from './db-harness'

// Runs supabase/schema.sql + migrations/20261028000000_safe_saving.sql in a local Postgres
// (PGlite) as the `authenticated` role with row-level security, like the real app.

type Db = Awaited<ReturnType<typeof createTestDatabase>>
type SaveResult = {
  status: 'saved' | 'conflict' | 'deleted'
  reason?: string
  current_updated_at?: string
  entry?: { id: string; hours: number; invoiced_income: number; updated_at: string; pricing_mode: string | null }
  work_items?: Array<{ hours: number; invoiced_income: number; pricing_mode: string | null }>
  summary?: { month_key: string; hours: number; updated_at: string }
  settings?: { target_net_month: number; updated_at: string }
}

const MUTATION_1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const MUTATION_2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const MUTATION_3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const MUTATION_4 = 'aaaaaaaa-0000-4000-8000-000000000004'

function day(id: string, date: string, hours: number, income: number) {
  return { id, date, day_status: 'worked', hours, invoiced_income: income, expenses: 0 }
}

const hourlyItem = (hours: number, rate: number, lineIndex = 0) => ({
  project_name: 'Digital',
  hours,
  hourly_rate: rate,
  invoiced_income: hours * rate,
  line_index: lineIndex,
  pricing_mode: 'hourly',
})

async function saveDay(db: Db, user: string, entry: object, items: object[], expected: string | null, mutation: string) {
  return rpc<SaveResult>(db, user, 'save_daily_entry', [entry, items, expected, mutation])
}

async function countRows(db: Db, sql: string, params: unknown[] = []) {
  const result = await db.query<{ count: number }>(sql, params)
  return Number(result.rows[0].count)
}

describe('save_daily_entry / delete_daily_entry', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDatabase()
  })

  it('creates a day with its work items in one call', async () => {
    const result = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)

    expect(result.status).toBe('saved')
    expect(result.entry?.hours).toBe(2)
    expect(result.work_items).toHaveLength(1)
    expect(result.work_items?.[0].pricing_mode).toBe('hourly')
  })

  it('two stale sessions: the second save conflicts instead of overwriting', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)
    const loadedVersion = created.entry!.updated_at // both "devices" loaded this version

    const phone = await saveDay(db, USER_A, day('d1', '2026-10-01', 3, 150), [hourlyItem(3, 50)], loadedVersion, MUTATION_2)
    const staleMac = await saveDay(db, USER_A, day('d1', '2026-10-01', 9, 450), [hourlyItem(9, 50)], loadedVersion, MUTATION_3)

    expect(phone.status).toBe('saved')
    expect(staleMac).toMatchObject({ status: 'conflict', reason: 'changed' })

    const stored = await db.query<{ hours: number }>(`select hours from daily_entries where id = 'd1'`)
    expect(Number(stored.rows[0].hours)).toBe(3)
    const items = await db.query<{ hours: number }>(`select hours from daily_entry_work_items where daily_entry_id = 'd1'`)
    expect(items.rows.map((row) => Number(row.hours))).toEqual([3])
  })

  it('a stale session cannot delete a newer version, and nothing else is deleted', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)
    await saveDay(db, USER_A, day('d2', '2026-10-02', 4, 200), [], null, MUTATION_2)
    await saveDay(db, USER_A, day('d1', '2026-10-01', 3, 150), [hourlyItem(3, 50)], created.entry!.updated_at, MUTATION_3)

    const staleDelete = await rpc<SaveResult>(db, USER_A, 'delete_daily_entry', ['d1', created.entry!.updated_at])

    expect(staleDelete).toMatchObject({ status: 'conflict', reason: 'changed' })
    expect(await countRows(db, `select count(*) from daily_entries`)).toBe(2)
  })

  it('retrying a save whose response was lost does not apply it twice', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)
    const version = created.entry!.updated_at

    // Committed, but the app never got this answer...
    const first = await saveDay(db, USER_A, day('d1', '2026-10-01', 3, 150), [hourlyItem(3, 50)], version, MUTATION_2)
    // ...so it retries the identical change with the same mutation id and old version.
    const retry = await saveDay(db, USER_A, day('d1', '2026-10-01', 3, 150), [hourlyItem(3, 50)], version, MUTATION_2)

    expect(retry.status).toBe('saved')
    expect(retry.entry?.updated_at).toBe(first.entry?.updated_at) // not saved a second time
    expect(await countRows(db, `select count(*) from daily_entry_work_items where daily_entry_id = 'd1'`)).toBe(1)
  })

  it('retrying a lost insert does not duplicate the day', async () => {
    await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)
    const retry = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)

    expect(retry.status).toBe('saved')
    expect(await countRows(db, `select count(*) from daily_entries`)).toBe(1)
    expect(await countRows(db, `select count(*) from daily_entry_work_items`)).toBe(1)
  })

  it('a different change based on the same old version still conflicts after a lost response', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [], null, MUTATION_1)
    await saveDay(db, USER_A, day('d1', '2026-10-01', 3, 150), [], created.entry!.updated_at, MUTATION_2)

    const otherChange = await saveDay(db, USER_A, day('d1', '2026-10-01', 5, 250), [], created.entry!.updated_at, MUTATION_3)

    expect(otherChange.status).toBe('conflict')
  })

  it('an interrupted work-item update leaves the day and its old items intact', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)
    const brokenItems = [hourlyItem(3, 50), { ...hourlyItem(1, 50, 1), hours: 'not-a-number' }]

    await expect(
      saveDay(db, USER_A, day('d1', '2026-10-01', 4, 200), brokenItems, created.entry!.updated_at, MUTATION_2),
    ).rejects.toThrow()

    const stored = await db.query<{ hours: number; updated_at: string }>(
      `select hours, updated_at::text from daily_entries where id = 'd1'`,
    )
    expect(Number(stored.rows[0].hours)).toBe(2)
    const items = await db.query<{ hours: number }>(`select hours from daily_entry_work_items where daily_entry_id = 'd1'`)
    expect(items.rows.map((row) => Number(row.hours))).toEqual([2])
  })

  it('two devices creating the same day: the second gets a conflict, not a duplicate', async () => {
    await saveDay(db, USER_A, day('phone-day', '2026-10-01', 2, 100), [], null, MUTATION_1)
    const mac = await saveDay(db, USER_A, day('mac-day', '2026-10-01', 8, 400), [], null, MUTATION_2)

    expect(mac).toMatchObject({ status: 'conflict', reason: 'exists' })
    expect(await countRows(db, `select count(*) from daily_entries where date = '2026-10-01'`)).toBe(1)
  })

  it('deletes are version-checked, remove work items, and are safe to retry', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [hourlyItem(2, 50)], null, MUTATION_1)

    const deleted = await rpc<SaveResult>(db, USER_A, 'delete_daily_entry', ['d1', created.entry!.updated_at])
    const retry = await rpc<SaveResult>(db, USER_A, 'delete_daily_entry', ['d1', created.entry!.updated_at])

    expect(deleted.status).toBe('deleted')
    expect(retry.status).toBe('deleted')
    expect(await countRows(db, `select count(*) from daily_entry_work_items`)).toBe(0)
  })

  it('undo restores a deleted report and all split work items; a lost response can be retried', async () => {
    const entry = { ...day('undo-day', '2026-10-01', 5, 250), expenses: 12, note: 'Keep this note', source: 'manual' }
    const items = [hourlyItem(2, 50, 0), hourlyItem(3, 50, 1)]
    const created = await saveDay(db, USER_A, entry, items, null, MUTATION_1)
    await saveDay(db, USER_A, day('untouched', '2026-10-02', 8, 400), [], null, MUTATION_2)
    await rpc(db, USER_A, 'delete_daily_entry', ['undo-day', created.entry!.updated_at])

    const restored = await saveDay(db, USER_A, entry, items, null, MUTATION_3)
    const retried = await saveDay(db, USER_A, entry, items, null, MUTATION_3)
    expect(restored.status).toBe('saved')
    expect(retried.entry?.updated_at).toBe(restored.entry?.updated_at)
    expect(restored.work_items?.map(item => Number(item.hours))).toEqual([2, 3])
    const stored = await db.query<{ expenses: string; note: string }>("select expenses, note from daily_entries where id = 'undo-day'")
    expect(Number(stored.rows[0].expenses)).toBe(12)
    expect(stored.rows[0].note).toBe('Keep this note')
    expect(await countRows(db, 'select count(*) from daily_entries')).toBe(2)
    expect(await countRows(db, 'select count(*) from daily_entry_work_items')).toBe(2)
  })

  it('undo never overwrites a replacement report created on another device', async () => {
    const entry = day('undo-day', '2026-10-01', 2, 100)
    const created = await saveDay(db, USER_A, entry, [], null, MUTATION_1)
    await rpc(db, USER_A, 'delete_daily_entry', ['undo-day', created.entry!.updated_at])
    await saveDay(db, USER_A, day('new-day', '2026-10-01', 8, 400), [], null, MUTATION_2)

    const undo = await saveDay(db, USER_A, entry, [], null, MUTATION_3)
    expect(undo).toMatchObject({ status: 'conflict', reason: 'exists' })
    const stored = await db.query<{ id: string; hours: string }>('select id, hours from daily_entries')
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0].id).toBe('new-day')
    expect(Number(stored.rows[0].hours)).toBe(8)
  })

  it('saving a day that was deleted elsewhere reports a conflict', async () => {
    const created = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [], null, MUTATION_1)
    await rpc(db, USER_A, 'delete_daily_entry', ['d1', created.entry!.updated_at])

    const stale = await saveDay(db, USER_A, day('d1', '2026-10-01', 3, 150), [], created.entry!.updated_at, MUTATION_2)

    expect(stale).toMatchObject({ status: 'conflict', reason: 'deleted' })
    expect(await countRows(db, `select count(*) from daily_entries`)).toBe(0)
  })

  it("another user can't overwrite or delete my day (row-level security)", async () => {
    const mine = await saveDay(db, USER_A, day('d1', '2026-10-01', 2, 100), [], null, MUTATION_1)

    const overwrite = await saveDay(db, USER_B, day('d1', '2026-10-01', 9, 999), [], mine.entry!.updated_at, MUTATION_2)
    await rpc(db, USER_B, 'delete_daily_entry', ['d1', mine.entry!.updated_at])

    expect(overwrite.status).toBe('conflict')
    const stored = await db.query<{ hours: number; user_id: string }>(`select hours, user_id from daily_entries`)
    expect(stored.rows).toHaveLength(1)
    expect(Number(stored.rows[0].hours)).toBe(2)
    expect(stored.rows[0].user_id).toBe(USER_A)
  })

  it('refuses to save when signed out', async () => {
    await expect(
      asUser(db, null, `select public.save_daily_entry($1, $2, null, $3)`, [JSON.stringify(day('d1', '2026-10-01', 1, 1)), '[]', MUTATION_1]),
    ).rejects.toThrow()
  })

  it('rejects an unknown pricing mode', async () => {
    await expect(
      saveDay(db, USER_A, { ...day('d1', '2026-10-01', 1, 50), pricing_mode: 'guess' }, [], null, MUTATION_1),
    ).rejects.toThrow()
  })

  it('stores fixed and hourly days explicitly', async () => {
    const fixed = await saveDay(
      db, USER_A, { ...day('d1', '2026-10-01', 8, 400), pricing_mode: 'fixed', hourly_rate: null }, [], null, MUTATION_1,
    )
    const hourly = await saveDay(
      db, USER_A, { ...day('d2', '2026-10-02', 8, 400), pricing_mode: 'hourly', hourly_rate: 50 }, [], null, MUTATION_2,
    )

    expect(fixed.entry?.pricing_mode).toBe('fixed')
    expect(hourly.entry?.pricing_mode).toBe('hourly')
  })
})

describe('save_monthly_summary / delete_monthly_summary / save_settings', () => {
  let db: Db

  beforeEach(async () => {
    db = await createTestDatabase()
  })

  const month = (hours: number) => ({
    month_key: '2026-08',
    month_type: 'business',
    hours,
    invoiced_income: hours * 43.75,
    expenses: 0,
    work_lines: [{ label: 'Digital', hours, hourlyRate: 43.75, totalIncome: null }],
  })

  it('stale month saves conflict; lost-response retries are idempotent', async () => {
    const created = await rpc<SaveResult>(db, USER_A, 'save_monthly_summary', [month(150), null, MUTATION_1])
    const version = created.summary!.updated_at
    const phone = await rpc<SaveResult>(db, USER_A, 'save_monthly_summary', [month(160), version, MUTATION_2])
    const phoneRetry = await rpc<SaveResult>(db, USER_A, 'save_monthly_summary', [month(160), version, MUTATION_2])
    const staleMac = await rpc<SaveResult>(db, USER_A, 'save_monthly_summary', [month(10), version, MUTATION_3])

    expect(phone.status).toBe('saved')
    expect(phoneRetry.status).toBe('saved')
    expect(staleMac).toMatchObject({ status: 'conflict', reason: 'changed' })
    const stored = await db.query<{ hours: number }>(`select hours from monthly_summaries`)
    expect(Number(stored.rows[0].hours)).toBe(160)
  })

  it('a stale month delete is refused', async () => {
    const created = await rpc<SaveResult>(db, USER_A, 'save_monthly_summary', [month(150), null, MUTATION_1])
    await rpc(db, USER_A, 'save_monthly_summary', [month(160), created.summary!.updated_at, MUTATION_2])

    const staleDelete = await rpc<SaveResult>(db, USER_A, 'delete_monthly_summary', ['2026-08', created.summary!.updated_at])

    expect(staleDelete.status).toBe('conflict')
    expect(await countRows(db, `select count(*) from monthly_summaries`)).toBe(1)
  })

  it('settings: stale saves conflict, retries are idempotent', async () => {
    const settings = (target: number) => ({
      target_net_month: target,
      weekly_hours_target: 30,
      default_shift_income: 400,
      default_shift_hours: 8,
      reserve_buffer_percent: 5,
      qualifies_for_self_employed_deduction: true,
      qualifies_for_starters_deduction: true,
    })
    const created = await rpc<SaveResult>(db, USER_A, 'save_settings', [settings(4500), null, MUTATION_1])
    const version = created.settings!.updated_at
    const phone = await rpc<SaveResult>(db, USER_A, 'save_settings', [settings(4600), version, MUTATION_2])
    const retry = await rpc<SaveResult>(db, USER_A, 'save_settings', [settings(4600), version, MUTATION_2])
    const staleMac = await rpc<SaveResult>(db, USER_A, 'save_settings', [settings(1), version, MUTATION_4])

    expect(phone.status).toBe('saved')
    expect(retry.status).toBe('saved')
    expect(staleMac.status).toBe('conflict')
    const stored = await db.query<{ target_net_month: number }>(`select target_net_month from app_settings`)
    expect(Number(stored.rows[0].target_net_month)).toBe(4600)
  })
})
