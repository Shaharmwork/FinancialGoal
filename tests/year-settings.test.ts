import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDatabase, rpc, USER_A, USER_B } from './db-harness'
import { defaultSettings } from '@/lib/default-state'
import { getDutchPublicHolidayWeekdays, toDateKey, getCurrentYearStats, getMissingReportDateKeys, getMissingPreviousMonthSummaryKeys } from '@/lib/calculations'
import { copyYearSettings, getSettingsForYear, getNextBackfillMonthForYear, yearFields } from '@/lib/year-settings'
import { isSameSettingsContent, rebaseDraftSettings } from '@/lib/sync'
import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'

type DB = Awaited<ReturnType<typeof createTestDatabase>>
const migration = readFileSync(new URL('../supabase/migrations/20261029103253_yearly_settings_holiday_consent.sql',import.meta.url),'utf8')
let db: DB
let nextMutation = 0
const mutation = () => `aaaaaaaa-0000-4000-8000-${String(++nextMutation).padStart(12,'0')}`
const config = (enabled = false, days = 20) => ({...yearFields(defaultSettings),dutchHolidaysEnabled:enabled,vacationDaysPerYear:days})
async function save(year: number, settings: object, version: string | null = null, id = mutation(), user=USER_A) {
  return rpc<any>(db,user,'save_year_settings',[year,settings,version,id])
}
async function rows(user=USER_A) {
  return (await asUser<any>(db,user,'select * from daily_entries order by date')).rows
}
describe('atomic year configuration and holiday approval',()=>{
 beforeEach(async()=>{db=await createTestDatabase();await db.exec(migration);await db.exec(readFileSync(new URL('../supabase/migrations/20261029105253_restrict_year_settings_rpc_access.sql', import.meta.url), 'utf8'))})
 afterEach(async()=>{await db.close()})
 it('defaults off; saves each year separately with a guarded shared version',async()=>{
   const first=await save(2026,config())
   expect(first.status).toBe('saved');expect(await rows()).toHaveLength(0)
   const second=await save(2027,{...config(),targetNetMonth:9000},first.settings.updated_at)
   expect(second.settings.yearly_settings['2026'].targetNetMonth).toBe(4500)
   expect(second.settings.yearly_settings['2027'].targetNetMonth).toBe(9000)
   expect((await save(2026,config(true),first.settings.updated_at)).status).toBe('conflict')
   expect(await rows()).toHaveLength(0)
 })
 it('creates weekday marks once, preserves work and never re-adds a manually removed mark on ordinary saves',async()=>{
   await rpc(db,USER_A,'save_daily_entry',[{id:'work',date:'2026-01-01',hours:8,invoiced_income:400,expenses:0},[],null,mutation()])
   const id=mutation(), first=await save(2026,config(true,28),null,id)
   expect(first.status).toBe('saved')
   expect(await rows()).toHaveLength(8)
   expect((await rows())[0].hours).toBe('8')
   const mark=(await rows()).find(r=>r.source==='dutch-holiday')!
   await rpc(db,USER_A,'delete_daily_entry',[mark.id,mark.updated_at])
   await save(2026,config(true,28),null,id) // retry of committed operation
   const second=await save(2026,config(true,10),first.settings.updated_at)
   expect(second.status).toBe('saved')
   expect(await rows()).toHaveLength(7)
   expect((await rows()).some(r=>r.date===mark.date)).toBe(false)
   expect(second.settings.yearly_settings['2026'].vacationDaysPerYear).toBe(10)
 })
 it('turn-off removes only untouched automatic marks in that year',async()=>{
   const first=await save(2026,config(true,28))
   const mark=(await rows())[0]
   await rpc(db,USER_A,'save_daily_entry',[{...mark,expenses:12,source:'dutch-holiday'},[],mark.updated_at,mutation()])
   const second=await save(2027,config(true,27),first.settings.updated_at)
   const third=await save(2026,config(false,20),second.settings.updated_at)
   expect(third.status).toBe('saved')
   const left=await rows()
   expect(left.filter(r=>r.date.startsWith('2026'))).toHaveLength(1)
   expect(left.find(r=>r.date===mark.date).source).toBeNull()
   expect(left.filter(r=>r.date.startsWith('2027'))).toHaveLength(7)
 })
 it('rolls back all holiday writes if an insert fails',async()=>{
   await db.exec("alter table daily_entries add constraint test_reject_holiday check(date <> '2026-12-25')")
   await expect(save(2026,config(true,28))).rejects.toThrow()
   expect(await rows()).toHaveLength(0)
   expect((await asUser(db,USER_A,'select * from app_settings')).rows).toHaveLength(0)
 })
 it('isolates users and prevents old clients overwriting migrated settings',async()=>{
   const first=await save(2026,config(true))
   expect(await rows(USER_B)).toHaveLength(0)
   expect((await save(2026,config(false),first.settings.updated_at,mutation(),USER_B)).status).toBe('conflict')
   await expect(rpc(db,null,'save_year_settings',[2026,config(),null,mutation()])).rejects.toThrow()
   await expect(rpc(db,USER_A,'save_settings',[{},first.settings.updated_at,mutation()])).rejects.toThrow(/Refresh the app/)
 })
 it('agrees with official weekday dates for 2026 and 2027 and handles Sunday Kings Day',async()=>{
   for(const year of [2025,2026,2027]) {
     const result=await db.query<{date:string}>('select public.dutch_holiday_dates($1)::text as date',[year])
     expect(result.rows.map(r=>r.date)).toEqual(getDutchPublicHolidayWeekdays(year).map(toDateKey).sort())
   }
   expect(getDutchPublicHolidayWeekdays(2026)).toHaveLength(8)
   expect(getDutchPublicHolidayWeekdays(2027)).toHaveLength(7)
   expect(getDutchPublicHolidayWeekdays(2025).map(toDateKey)).not.toContain('2025-04-27')
 })
})

describe('annual settings and calendar markers in calculations',()=>{
 const holiday:DailyEntry={id:'h',date:'2026-01-01',dayStatus:'vacation',hours:0,invoicedIncome:0,expenses:0,source:'dutch-holiday'}
 it('keeps month-summary income when only holiday marks exist',()=>{
   const summary:MonthlySummary={monthKey:'2026-01',monthType:'business',hours:160,invoicedIncome:8000,expenses:100,grossSalary:null,netSalaryReceived:null,taxAlreadyWithheld:null}
   const today=new Date(2026,1,2)
   expect(getCurrentYearStats([holiday],[summary],defaultSettings,today).ytdInvoicedIncome).toBe(8000)
   expect(getMissingReportDateKeys([holiday],[summary],today).filter(d=>d.startsWith('2026-01'))).toEqual([])
   expect(getMissingPreviousMonthSummaryKeys([holiday],[],today)).toContain('2026-01')
 })
 it('removed holiday marks become missing again and copied years need fresh consent',()=>{
   const today=new Date(2026,0,2)
   expect(getMissingReportDateKeys([holiday],[],today)).toEqual([])
   expect(getMissingReportDateKeys([],[],today)).toEqual(['2026-01-01'])
   const old={...defaultSettings,year:2026,dutchHolidaysEnabled:true,holidayDaysAdded:8,vacationDaysPerYear:28}
   const copy=copyYearSettings(old,2026,2027)
   expect(copy).toMatchObject({year:2027,vacationDaysPerYear:20,dutchHolidaysEnabled:false,holidayDaysAdded:0})
   expect(getSettingsForYear(old,2027).targetNetMonth).toBeNull()
   expect(old.vacationDaysPerYear).toBe(28)
 })
})

it('compares the selected plan independently of other years and JSON key order', () => {
  const old = { ...defaultSettings, year: 2026, updatedAt: 'old' }
  const next = { ...(Object.fromEntries(Object.entries(defaultSettings).reverse()) as Settings),
    year: 2026, updatedAt: 'new', yearlySettings: {'2027': {...defaultSettings, targetNetMonth: 9000}} }
  expect(isSameSettingsContent(old, next as typeof old)).toBe(true)
  expect(rebaseDraftSettings(old, next as typeof old, old)).toBe(next)
  expect(isSameSettingsContent(old, { ...old, year: 2027 })).toBe(false)
})

it('adds missing months only in the selected year and never in a future year', () => {
  const today = new Date(2026, 9, 29)
  const summaries = [{monthKey:'2025-01'}, {monthKey:'2026-01'}] as MonthlySummary[]
  expect(getNextBackfillMonthForYear(2025,today,summaries,new Set(['2025-02']))).toBe('2025-03')
  expect(getNextBackfillMonthForYear(2026,today,summaries,new Set(['2026-02']))).toBe('2026-03')
  expect(getNextBackfillMonthForYear(2027,today,summaries,new Set())).toBe('')
})
it('allows December in a previous year and stops before the current month', () => {
  const summaries = Array.from({length:11},(_,i)=>({monthKey:`2025-${String(i+1).padStart(2,'0')}`})) as MonthlySummary[]
  expect(getNextBackfillMonthForYear(2025,new Date(2026,0,1),summaries,new Set())).toBe('2025-12')
  expect(getNextBackfillMonthForYear(2026,new Date(2026,0,1),[],new Set())).toBe('')
  expect(getNextBackfillMonthForYear(2026,new Date(2026,2,15),
    [{monthKey:'2026-01'},{monthKey:'2026-02'}] as MonthlySummary[],new Set())).toBe('')
})
