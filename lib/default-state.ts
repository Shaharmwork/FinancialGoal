import type {
  DailyEntry,
  MonthlySummary,
  MonthWorkLine,
  Screen,
  Settings,
  StoredAppState,
  WorkItem,
} from './types'

export const STORAGE_KEY = 'financial-goal-mvp-state'

export const defaultSettings: Settings = {
  targetNetMonth: 4500,
  spouseMonthlyIncome: 2500,
  defaultShiftIncome: 350,
  defaultShiftHours: 8,
  weeklyHoursTarget: 30,
  reserveBufferPercent: 5,
  qualifiesForSelfEmployedDeduction: true,
  qualifiesForStartersDeduction: false,
  vacationDaysPerYear: 0,
}

export const emptySettings: Settings = {
  targetNetMonth: null,
  spouseMonthlyIncome: 0,
  defaultShiftIncome: null,
  defaultShiftHours: null,
  weeklyHoursTarget: null,
  reserveBufferPercent: null,
  qualifiesForSelfEmployedDeduction: false,
  qualifiesForStartersDeduction: false,
  vacationDaysPerYear: null,
}

export const defaultMonthlySummaries: MonthlySummary[] = [
  {
    monthKey: '2026-01',
    monthType: 'business',
    invoicedIncome: 4262.78,
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

function readPricingMode(value: unknown) {
  return value === 'hourly' || value === 'fixed' ? value : null
}

function readMonthType(value: unknown) {
  return value === 'employment' ? 'employment' : 'business'
}

export function normalizeWorkItem(value: unknown, fallbackLineIndex = 0): WorkItem | null {
  if (!isRecord(value)) {
    return null
  }

  const hours = readNumber(value.hours, NaN)
  const invoicedIncome = readNumber(value.invoicedIncome ?? value.invoiced_income, NaN)
  const lineIndex = readNumber(value.lineIndex ?? value.line_index, fallbackLineIndex)

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(invoicedIncome) ||
    !Number.isFinite(lineIndex)
  ) {
    return null
  }

  return {
    id: readString(value.id),
    dailyEntryId: readString(value.dailyEntryId ?? value.daily_entry_id),
    projectName: readString(value.projectName ?? value.project_name) ?? '',
    hours,
    hourlyRate: readNullableNumber(value.hourlyRate ?? value.hourly_rate),
    invoicedIncome,
    lineIndex: Math.trunc(lineIndex),
    pricingMode: readPricingMode(value.pricingMode ?? value.pricing_mode),
  }
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
    ) ?? false,
    qualifiesForStartersDeduction: readNullableBoolean(value.qualifiesForStartersDeduction) ?? false,
    ...(readString(value.updatedAt) ? { updatedAt: readString(value.updatedAt) } : {}),
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
  const invoicedIncome = readNumber(value.invoicedIncome, readNumber(value.income, NaN))

  if (!id || !date || !Number.isFinite(hours) || !Number.isFinite(invoicedIncome)) {
    return null
  }

  const workItems = Array.isArray(value.workItems)
    ? value.workItems
        .map((workItem, index) => normalizeWorkItem(workItem, index))
        .filter((workItem): workItem is WorkItem => workItem !== null)
        .sort((left, right) => left.lineIndex - right.lineIndex)
    : undefined

  return {
    id,
    date,
    dayStatus:
      value.dayStatus === 'no_work' || value.dayStatus === 'vacation'
        ? value.dayStatus
        : 'worked',
    hours,
    invoicedIncome,
    expenses: readNumber(value.expenses ?? value.expense, 0),
    note: readString(value.note),
    source: readString(value.source),
    ...(workItems && workItems.length > 0 ? { workItems } : {}),
    hourlyRate: readNullableNumber(value.hourlyRate ?? value.hourly_rate),
    pricingMode: readPricingMode(value.pricingMode ?? value.pricing_mode),
    ...(readString(value.updatedAt ?? value.updated_at)
      ? { updatedAt: readString(value.updatedAt ?? value.updated_at) }
      : {}),
  }
}

function normalizeMonthWorkLine(value: unknown): MonthWorkLine | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    label: readString(value.label) ?? '',
    hours: readNullableNumber(value.hours),
    hourlyRate: readNullableNumber(value.hourlyRate ?? value.hourly_rate),
    totalIncome: readNullableNumber(value.totalIncome ?? value.total_income),
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
  const rawWorkLines = value.workLines ?? value.work_lines
  const workLines = Array.isArray(rawWorkLines)
    ? rawWorkLines
        .map((workLine) => normalizeMonthWorkLine(workLine))
        .filter((workLine): workLine is MonthWorkLine => workLine !== null)
    : []

  return {
    monthKey,
    monthType,
    invoicedIncome: readNullableNumber(value.invoicedIncome ?? value.income),
    ...(workLines.length > 0 ? { workLines } : {}),
    ...(readString(value.updatedAt ?? value.updated_at)
      ? { updatedAt: readString(value.updatedAt ?? value.updated_at) }
      : {}),
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
