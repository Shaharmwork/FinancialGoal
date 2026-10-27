import { describe, expect, it } from 'vitest'
import {
  getCurrentMonthStats,
  getCurrentYearStats,
  getEarliestMissingCurrentMonthWeekday,
  getMissingReportDateKeys,
} from '@/lib/calculations'
import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'

const today = new Date(2026, 9, 27, 12) // Tue 27 Oct 2026

const settings: Settings = {
  targetNetMonth: 4500,
  spouseMonthlyIncome: 0,
  defaultShiftIncome: 400,
  defaultShiftHours: 8,
  weeklyHoursTarget: 30,
  reserveBufferPercent: 5,
  qualifiesForSelfEmployedDeduction: true,
  qualifiesForStartersDeduction: true,
  vacationDaysPerYear: null,
}

const summary = (monthKey: string, hours: number, income: number): MonthlySummary => ({
  monthKey,
  monthType: 'business',
  hours,
  invoicedIncome: income,
  expenses: 0,
  grossSalary: null,
  netSalaryReceived: null,
  taxAlreadyWithheld: null,
})

const entry = (date: string, hours: number, income: number): DailyEntry => ({
  id: `entry-${date}`,
  date,
  dayStatus: 'worked',
  hours,
  invoicedIncome: income,
  expenses: 0,
})

// Every weekday from January up to yesterday, except the given months.
function fullYearExcept(months: string[]) {
  const entries: DailyEntry[] = []
  const cursor = new Date(2026, 0, 1)

  while (cursor < new Date(2026, 9, 27)) {
    const key = `2026-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    const isWeekday = cursor.getDay() !== 0 && cursor.getDay() !== 6

    if (isWeekday && !months.includes(key.slice(0, 7))) {
      entries.push(entry(key, 8, 400))
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  return entries
}

describe('monthly coverage uses the same rule as the totals', () => {
  it('a month with only a summary is fully covered', () => {
    const missing = getMissingReportDateKeys(fullYearExcept(['2026-09']), [summary('2026-09', 160, 7000)], today)
    expect(missing.filter((date) => date.startsWith('2026-09'))).toEqual([])
  })

  it('a partly reported month with a summary shows its missing days', () => {
    const entries = [...fullYearExcept(['2026-09']), entry('2026-09-15', 8, 400)]
    const summaries = [summary('2026-09', 160, 7000)]
    const missing = getMissingReportDateKeys(entries, summaries, today)
    const septemberMissing = missing.filter((date) => date.startsWith('2026-09'))

    // 22 weekdays in September 2026, one reported.
    expect(septemberMissing).toHaveLength(21)
    expect(septemberMissing).not.toContain('2026-09-15')

    // ...and the totals use that single day, not the summary (consistent).
    const year = getCurrentYearStats(entries, summaries, settings, today)
    const yearWithoutSeptember = getCurrentYearStats(fullYearExcept(['2026-09']), [], settings, today)
    expect(year.ytdInvoicedIncome - yearWithoutSeptember.ytdInvoicedIncome).toBe(400)
  })

  it('public holidays are not missing days', () => {
    const entries = fullYearExcept(['2026-04']).concat(
      ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-07', '2026-04-08', '2026-04-09',
        '2026-04-10', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
        '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-28',
        '2026-04-29', '2026-04-30'].map((date) => entry(date, 8, 400)),
    )
    // Easter Monday (6 Apr) and King's Day (27 Apr) are left out on purpose.
    const missing = getMissingReportDateKeys(entries, [], today)
    expect(missing.filter((date) => date.startsWith('2026-04'))).toEqual([])
  })

  it('an employment month is covered even while it is the current month', () => {
    const employment: MonthlySummary = {
      ...summary('2026-10', 0, 0),
      monthType: 'employment',
      grossSalary: 4000,
      netSalaryReceived: 3000,
      taxAlreadyWithheld: 900,
    }
    expect(getEarliestMissingCurrentMonthWeekday([], today, [employment])).toBeUndefined()
  })
})

describe('unsupported tax year', () => {
  it('shows no tax figures outside 2026', () => {
    const in2027 = new Date(2027, 2, 15, 12)
    const entries = [entry('2027-03-02', 8, 400)]
    const year = getCurrentYearStats(entries, [], settings, in2027)
    const month = getCurrentMonthStats(entries, [], settings, in2027)

    expect(year.estimatedAnnualTax).toBeUndefined()
    expect(year.projectedAnnualNet).toBeUndefined()
    expect(year.requiredAnnualBeforeTaxAmount).toBeUndefined()
    expect(month.reservedTaxFromPreviousMonths).toBeUndefined()
    expect(month.forecastCalculatedTaxToSaveThisMonth).toBeUndefined()
    // Hours and income still work.
    expect(year.ytdHours).toBe(8)
  })

  it('shows tax figures in 2026', () => {
    const year = getCurrentYearStats(fullYearExcept([]), [], settings, today)
    expect(year.estimatedAnnualTax).toBeGreaterThan(0)
  })
})
