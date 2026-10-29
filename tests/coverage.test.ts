import { describe, expect, it } from 'vitest'
import {
  getCurrentMonthStats,
  getEarliestReportingYear,
  getCurrentYearStats,
  getEarliestMissingCurrentMonthWeekday,
  getMissingReportDateKeys,
  getMissingCurrentMonthReportDateKeys,
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

  it('unapproved public holidays are missing days', () => {
    const entries = fullYearExcept(['2026-04']).concat(
      ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-07', '2026-04-08', '2026-04-09',
        '2026-04-10', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17',
        '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-28',
        '2026-04-29', '2026-04-30'].map((date) => entry(date, 8, 400)),
    )
    // Easter Monday (6 Apr) and King's Day (27 Apr) are left out on purpose.
    const missing = getMissingReportDateKeys(entries, [], today)
    expect(missing.filter((date) => date.startsWith('2026-04'))).toEqual(['2026-04-06', '2026-04-27'])
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

describe('dashboard missing reports this month', () => {
  it('shows the whole current month immediately for an empty new account', () => {
    const date = new Date(2026, 9, 29, 12)
    const missing = getMissingCurrentMonthReportDateKeys([], date)
    expect(missing).toHaveLength(20)
    expect(missing[0]).toBe('2026-10-01')
    expect(missing.at(-1)).toBe('2026-10-28')
    expect(missing).toEqual(getMissingReportDateKeys([], [], date)
      .filter(key => key.startsWith('2026-10')))
    expect(getEarliestMissingCurrentMonthWeekday([], date)).toBe('2026-10-01')
  })
  it('counts each day once and treats work, no-work and vacation as reported', () => {
    const reports = [
      entry('2026-10-26', 8, 400),
      entry('2026-10-26', 8, 400),
      { ...entry('2026-10-27', 0, 0), dayStatus: 'no_work' as const },
      { ...entry('2026-10-28', 0, 0), dayStatus: 'vacation' as const },
    ]
    const missing = getMissingCurrentMonthReportDateKeys(reports, new Date(2026, 9, 29, 12))
    expect(missing).toHaveLength(17)
    expect(missing).not.toContain('2026-10-26')
    expect(missing).not.toContain('2026-10-27')
    expect(missing).not.toContain('2026-10-28')
  })
  it('excludes weekends but keeps holidays until explicitly marked off', () => {
    const date = new Date(2026, 0, 5, 12)
    expect(getMissingCurrentMonthReportDateKeys([], date))
      .toEqual(['2026-01-01', '2026-01-02'])
    expect(getMissingCurrentMonthReportDateKeys([
      { ...entry('2026-01-01', 0, 0), dayStatus: 'vacation', source: 'dutch-holiday' },
    ], date)).toEqual(['2026-01-02'])
  })
  it('does not require daily reports for an employment month', () => {
    const employment = { ...summary('2026-10', 0, 0), monthType: 'employment' as const }
    expect(getMissingCurrentMonthReportDateKeys([], today, [employment])).toEqual([])
  })
  it('excludes today, future dates and earlier months', () => {
    expect(getMissingCurrentMonthReportDateKeys([], new Date(2026, 9, 1, 12))).toEqual([])
    expect(getMissingCurrentMonthReportDateKeys([], new Date(2026, 9, 2, 12)))
      .toEqual(['2026-10-01'])
    expect(getMissingCurrentMonthReportDateKeys([entry('2026-09-30', 8, 400),
      entry('2026-10-02', 8, 400), entry('2026-10-05', 8, 400)], new Date(2026, 9, 2, 12)))
      .toEqual(['2026-10-01'])
  })
})


describe('report year boundaries', () => {
  it('starts a new account in its joining year, including at New Year', () => {
    expect(getEarliestReportingYear([], [], today, '2026-10-29T09:00:00Z')).toBe(2026)
    expect(getEarliestReportingYear([], [], new Date(2027, 0, 1), '2026-10-29T09:00:00Z')).toBe(2026)
    expect(getEarliestReportingYear([], [], today, 'invalid')).toBe(2026)
  })
  it('preserves older daily and monthly history', () => {
    expect(getEarliestReportingYear([entry('2024-12-31', 8, 400)], [], today, '2026-10-29')).toBe(2024)
    expect(getEarliestReportingYear([], [summary('2025-02', 40, 2000)], today, '2026-10-29')).toBe(2025)
  })
  it('requires New Year to be reported unless approved as vacation', () => {
    const date = new Date(2026, 0, 5, 12)
    expect(getMissingReportDateKeys([], [], date)).toEqual(['2026-01-01', '2026-01-02'])
    expect(getCurrentYearStats([entry('2026-01-01', 8, 400)], [], settings, date).ytdHours).toBe(8)
  })
  it('keeps prior-year corrections out of the new year totals', () => {
    const date = new Date(2027, 0, 15, 12)
    const daily = [entry('2026-12-31', 8, 400), entry('2027-01-04', 6, 300)]
    const monthly = [summary('2026-11', 100, 5000)]
    const before = getCurrentYearStats(daily, monthly, settings, date)
    const after = getCurrentYearStats([entry('2026-12-31', 16, 800), daily[1]], monthly, settings, date)
    expect(before.ytdHours).toBe(6)
    expect(before.ytdInvoicedIncome).toBe(300)
    expect(after.ytdHours).toBe(before.ytdHours)
    expect(after.estimatedAnnualTax).toBeUndefined()
  })
})
