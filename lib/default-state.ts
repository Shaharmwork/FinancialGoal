import type { DailyEntry, MonthlySummary, Screen, Settings, StoredAppState } from './types'

export const STORAGE_KEY = 'financial-goal-mvp-state'

export const defaultSettings: Settings = {
  targetNetMonth: 4500,
  spouseMonthlyIncome: 2500,
  defaultShiftIncome: 350,
  defaultShiftHours: 8,
  weeklyHoursTarget: 30,
  reserveBufferPercent: 5,
  qualifiesForSelfEmployedDeduction: true,
  vacationDaysPerYear: 0,
}

export const emptySettings: Settings = {
  targetNetMonth: null,
  spouseMonthlyIncome: 0,
  defaultShiftIncome: null,
  defaultShiftHours: null,
  weeklyHoursTarget: null,
  reserveBufferPercent: null,
  qualifiesForSelfEmployedDeduction: null,
  vacationDaysPerYear: null,
}

export const defaultMonthlySummaries: MonthlySummary[] = [
  {
    monthKey: '2026-01',
    monthType: 'business',
    invoicedIncome: 4262.78,
    paidIncome: 4262.78,
    expenses: 1685.11,
    hours: 76.36,
    grossSalary: null,
    netSalaryReceived: null,
    taxAlreadyWithheld: null,
  },
  {
    monthKey: '2026-02',
    monthType: 'business',
    invoicedIncome: 1620.06,
    paidIncome: 0,
    expenses: 694.32,
    hours: 80.93,
    grossSalary: null,
    netSalaryReceived: null,
    taxAlreadyWithheld: null,
  },
  {
    monthKey: '2026-03',
    monthType: 'business',
    invoicedIncome: 11921.22,
    paidIncome: 0,
    expenses: 754.53,
    hours: 234.1,
    grossSalary: null,
    netSalaryReceived: null,
    taxAlreadyWithheld: null,
  },
]

export const defaultStoredState: StoredAppState = {
  currentScreen: 'dashboard',
  entries: [],
  monthlySummaries: defaultMonthlySummaries,
  settings: defaultSettings,
}

export const starterStoredState: StoredAppState = {
  currentScreen: 'dashboard',
  entries: [],
  monthlySummaries: [],
  settings: emptySettings,
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readNullableBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function readMonthType(value: unknown) {
  return value === 'employment' ? 'employment' : 'business'
}

function normalizeScreen(value: unknown): Screen {
  return value === 'dashboard' || value === 'daily-log' || value === 'configuration'
    ? value
    : defaultStoredState.currentScreen
}

export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) {
    return emptySettings
  }

  return {
    targetNetMonth: readNullableNumber(value.targetNetMonth ?? value.monthlyNetGoal),
    spouseMonthlyIncome: readNumber(value.spouseMonthlyIncome, emptySettings.spouseMonthlyIncome),
    defaultShiftIncome: readNullableNumber(value.defaultShiftIncome),
    defaultShiftHours: readNullableNumber(value.defaultShiftHours),
    weeklyHoursTarget: readNullableNumber(value.weeklyHoursTarget ?? value.weeklyHoursGoal),
    reserveBufferPercent: readNullableNumber(value.reserveBufferPercent),
    qualifiesForSelfEmployedDeduction: readNullableBoolean(
      value.qualifiesForSelfEmployedDeduction,
    ),
    vacationDaysPerYear: readNullableNumber(value.vacationDaysPerYear),
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
    dayStatus:
      value.dayStatus === 'no_work' || value.dayStatus === 'vacation'
        ? value.dayStatus
        : 'worked',
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

  const monthType = readMonthType(value.monthType)

  return {
    monthKey,
    monthType,
    invoicedIncome: readNullableNumber(value.invoicedIncome ?? value.income),
    paidIncome: readNullableNumber(value.paidIncome),
    expenses: readNullableNumber(value.expenses ?? value.expense),
    hours: readNullableNumber(value.hours),
    grossSalary: readNullableNumber(value.grossSalary),
    netSalaryReceived: readNullableNumber(value.netSalaryReceived),
    taxAlreadyWithheld: readNullableNumber(value.taxAlreadyWithheld),
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
