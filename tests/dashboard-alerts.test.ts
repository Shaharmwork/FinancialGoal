import { describe, expect, it } from 'vitest'
import { getDashboardAlert } from '@/lib/dashboard-alerts'
import { defaultSettings } from '@/lib/default-state'
import type { DailyEntry, MonthlySummary } from '@/lib/types'

const today = new Date(2026, 9, 29, 12)
const settings = { ...defaultSettings, year: 2026, targetNetMonth: 3200, vacationDaysPerYear: 20 }
const month = (monthKey: string): MonthlySummary => ({
  monthKey, monthType: 'business', hours: 160, invoicedIncome: 8000,
  expenses: 0, grossSalary: null, netSalaryReceived: null, taxAlreadyWithheld: null,
})
const past = Array.from({ length: 9 }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`))
const day = (date: string): DailyEntry => ({
  id: date, date, dayStatus: 'worked', hours: 8, invoicedIncome: 400, expenses: 0,
})
const weekdays = (start: Date, end: Date): DailyEntry[] => {
  const result: DailyEntry[] = []
  for (const date = new Date(start); date < end; date.setDate(date.getDate() + 1)) {
    if (date.getDay() !== 0 && date.getDay() !== 6) result.push(day(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`))
  }
  return result
}

describe('dashboard alert priority and destinations', () => {
  it('prioritizes missing months and supplies both earliest destinations for new users', () => {
    expect(getDashboardAlert([], [], settings, today)).toMatchObject({
      kind: 'months', monthKey: '2026-01', reportDateKey: '2026-01-01',
    })
  })
  it('missing months cannot be hidden by dismissing current-month reminders', () => {
    expect(getDashboardAlert([], past.slice(1), settings, today, true)).toMatchObject({
      kind: 'months', monthKey: '2026-01', reportDateKey: '2026-01-01',
    })
  })
  it('targets the first uncovered month after summaries, employment and daily reporting', () => {
    const jan = weekdays(new Date(2026, 0, 1), new Date(2026, 1, 1))
    const summaries = [month('2026-02'), {...month('2026-03'), monthType: 'employment' as const}]
    expect(getDashboardAlert(jan, summaries, settings, today)).toMatchObject({
      kind: 'months', monthKey: '2026-04', reportDateKey: '2026-04-01',
    })
  })
  it('keeps partial older-month days ahead of this month and offers no conflicting month total', () => {
    expect(getDashboardAlert([day('2026-01-01')], past.slice(1), settings, today)).toMatchObject({
      kind: 'history-days', reportDateKey: '2026-01-02',
    })
    expect(getDashboardAlert([day('2026-01-01')], past.slice(1), settings, today)?.monthKey).toBeUndefined()
  })
  it('switches to current-month days once previous months are covered, then disappears', () => {
    expect(getDashboardAlert([], past, settings, today)).toMatchObject({
      kind: 'reports', reportDateKey: '2026-10-01',
    })
    expect(getDashboardAlert([], past, settings, today, true)).toBeNull()
    expect(getDashboardAlert(weekdays(new Date(2026,9,1),today), past, settings, today)).toBeNull()
  })
  it('approved holiday marks do not hide an empty month and are skipped by daily navigation', () => {
    const holiday = { ...day('2026-01-01'), dayStatus: 'vacation' as const,
      hours: 0, invoicedIncome: 0, source: 'dutch-holiday' }
    expect(getDashboardAlert([holiday], [], settings, today)).toMatchObject({
      kind: 'months', monthKey: '2026-01', reportDateKey: '2026-01-02',
    })
  })
  it('uses current-year history only and handles January without a previous month', () => {
    expect(getDashboardAlert([day('2025-01-01')], [month('2025-01')], settings, today)?.monthKey).toBe('2026-01')
    const nextSettings = { ...settings, year: 2027 }
    expect(getDashboardAlert([], past, nextSettings, new Date(2027,0,4,12))).toMatchObject({
      kind: 'reports', reportDateKey: '2027-01-01',
    })
  })
  it('still offers setup when history is covered but the plan is incomplete', () => {
    expect(getDashboardAlert([], past, {...settings, targetNetMonth: null}, today)?.kind).toBe('configuration')
  })
})

it('does not label a valid plan missing just because it matches the old demo defaults', () => {
  expect(getDashboardAlert([], past, defaultSettings, today)?.kind).toBe('reports')
})
