import { emptySettings } from './default-state'
import type { DailyEntry, MonthlySummary, Settings, YearSettings } from './types'

export function yearFields(settings: Settings): YearSettings {
  const { year: _year, yearlySettings: _years, updatedAt: _version, ...fields } = settings
  return fields
}

export function getSettingsForYear(settings: Settings, year: number): Settings {
  const fields = (settings.year ?? 2026) === year ? yearFields(settings) : settings.yearlySettings?.[String(year)]
  return { ...emptySettings, ...fields, year, yearlySettings: settings.yearlySettings, updatedAt: settings.updatedAt }
}

export function copyYearSettings(settings: Settings, fromYear: number, toYear: number): Settings {
  const source = getSettingsForYear(settings, fromYear)
  return {
    ...source, year: toYear, dutchHolidaysEnabled: false, holidayDaysAdded: 0,
    vacationDaysPerYear: source.vacationDaysPerYear === null ? null
      : Math.max(0, source.vacationDaysPerYear - (source.holidayDaysAdded ?? 0)),
  }
}

// These zero-value calendar markers must not replace a whole-month income total.
export function isAutomaticHoliday(entry: DailyEntry) {
  return entry.source === 'dutch-holiday' && entry.dayStatus === 'vacation' &&
    entry.hours === 0 && entry.invoicedIncome === 0 && entry.expenses === 0 &&
    !(entry.workItems?.length)
}

// Past years allow all twelve months; the current year allows completed months.
export function getNextBackfillMonthForYear(
  year: number, today: Date, summaries: MonthlySummary[], entryMonthKeys: Set<string>,
) {
  const monthCount = year < today.getFullYear() ? 12
    : year === today.getFullYear() ? today.getMonth() : 0
  const covered = new Set(summaries.map(summary => summary.monthKey))
  for (let month = 1; month <= monthCount; month++) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    if (!covered.has(key) && !entryMonthKeys.has(key)) return key
  }
  return ''
}
