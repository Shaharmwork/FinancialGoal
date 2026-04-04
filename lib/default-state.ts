import type { DailyEntry, MonthlySummary, Screen, Settings, StoredAppState } from './types'

export const STORAGE_KEY = 'financial-goal-mvp-state'

export const defaultSettings: Settings = {
  monthlyNetGoal: 4500,
  spouseMonthlyIncome: 2500,
  defaultShiftIncome: 350,
  defaultShiftHours: 8,
  weeklyHoursGoal: 30,
  reserveBufferPercent: 5,
  incomeTaxPercent: 28,
  additionalTaxPercent: 7,
}

export const defaultMonthlySummaries: MonthlySummary[] = [
  {
    monthKey: '2026-01',
    invoicedIncome: 4262.78,
    paidIncome: 4262.78,
    expenses: 1685.11,
    hours: 76.36,
  },
  {
    monthKey: '2026-02',
    invoicedIncome: 1620.06,
    paidIncome: 0,
    expenses: 694.32,
    hours: 80.93,
  },
  {
    monthKey: '2026-03',
    invoicedIncome: 11921.22,
    paidIncome: 0,
    expenses: 754.53,
    hours: 234.1,
  },
]

export const defaultStoredState: StoredAppState = {
  currentScreen: 'dashboard',
  entries: [],
  monthlySummaries: defaultMonthlySummaries,
  settings: defaultSettings,
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function normalizeScreen(value: unknown): Screen {
  return value === 'dashboard' || value === 'daily-log' || value === 'configuration'
    ? value
    : defaultStoredState.currentScreen
}

export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) {
    return defaultSettings
  }

  return {
    monthlyNetGoal: readNumber(
      value.monthlyNetGoal ?? value.targetNetMonth,
      defaultSettings.monthlyNetGoal,
    ),
    spouseMonthlyIncome: readNumber(
      value.spouseMonthlyIncome,
      defaultSettings.spouseMonthlyIncome,
    ),
    defaultShiftIncome: readNumber(value.defaultShiftIncome, defaultSettings.defaultShiftIncome),
    defaultShiftHours: readNumber(value.defaultShiftHours, defaultSettings.defaultShiftHours),
    weeklyHoursGoal: readNumber(
      value.weeklyHoursGoal ?? value.weeklyHoursTarget,
      defaultSettings.weeklyHoursGoal,
    ),
    reserveBufferPercent: readNumber(
      value.reserveBufferPercent,
      defaultSettings.reserveBufferPercent,
    ),
    incomeTaxPercent: readNumber(
      value.incomeTaxPercent ?? value.taxPercentage,
      defaultSettings.incomeTaxPercent,
    ),
    additionalTaxPercent: readNumber(
      value.additionalTaxPercent ?? value.stateIncomeTax,
      defaultSettings.additionalTaxPercent,
    ),
  }
}

export function normalizeEntry(value: unknown): DailyEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value.id)
  const date = readString(value.date)
  const hours = readNumber(value.hours, NaN)
  const legacyIncome = readNumber(value.income, NaN)
  const hasExplicitInvoicedIncome = typeof value.invoicedIncome === 'number'
  const invoicedIncome = readNumber(value.invoicedIncome, legacyIncome)
  const paidFallback =
    Number.isFinite(legacyIncome) && !hasExplicitInvoicedIncome ? legacyIncome : 0
  const paidIncome = readNumber(value.paidIncome, paidFallback)

  if (
    !id ||
    !date ||
    !Number.isFinite(hours) ||
    !Number.isFinite(invoicedIncome) ||
    !Number.isFinite(paidIncome)
  ) {
    return null
  }

  return {
    id,
    date,
    hours,
    invoicedIncome,
    paidIncome,
    expenses: readNumber(value.expenses ?? value.expense, 0),
    note: readString(value.note),
    source: readString(value.source),
  }
}

export function normalizeMonthlySummary(value: unknown): MonthlySummary | null {
  if (!isRecord(value)) {
    return null
  }

  const monthKey = readString(value.monthKey)

  if (!monthKey) {
    return null
  }

  return {
    monthKey,
    invoicedIncome: readNumber(value.invoicedIncome ?? value.income, 0),
    paidIncome: readNumber(value.paidIncome, 0),
    expenses: readNumber(value.expenses ?? value.expense, 0),
    hours: readNumber(value.hours, 0),
  }
}

function sortMonthlySummaries(monthlySummaries: MonthlySummary[]) {
  const byMonth = new Map<string, MonthlySummary>()

  monthlySummaries.forEach((summary) => {
    byMonth.set(summary.monthKey, summary)
  })

  return Array.from(byMonth.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey))
}

export function normalizeStoredState(value: unknown): StoredAppState {
  if (!isRecord(value)) {
    return defaultStoredState
  }

  const normalizedEntries = Array.isArray(value.entries)
    ? value.entries
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is DailyEntry => entry !== null)
    : defaultStoredState.entries

  const normalizedMonthlySummaries = Array.isArray(value.monthlySummaries)
    ? sortMonthlySummaries(
        value.monthlySummaries
          .map((summary) => normalizeMonthlySummary(summary))
          .filter((summary): summary is MonthlySummary => summary !== null),
      )
    : defaultStoredState.monthlySummaries

  return {
    currentScreen: normalizeScreen(value.currentScreen),
    entries: normalizedEntries,
    monthlySummaries: normalizedMonthlySummaries,
    settings: normalizeSettings(value.settings),
  }
}
