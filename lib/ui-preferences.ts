'use client'

import { normalizeEntry, normalizeMonthlySummary, normalizeSettings } from './default-state'
import type { DailyEntry, MonthlySummary, Screen, Settings } from './types'

interface ConfigurationDraft {
  monthlySummaries: MonthlySummary[]
  settings: Settings
}

export type ReportWorkItemDraft = {
  id?: string
  projectName: string
  hours: string
  hourlyRate: string
  invoicedIncome: string
  lineIndex: number
}

export type ReportDayFormDraft = {
  expenses: string
  hours: string
  invoicedIncome: string
  paidIncome: string
  workItems?: ReportWorkItemDraft[]
}

interface UserUiPreferences {
  configurationDraft?: ConfigurationDraft
  currentScreen?: Screen
  dailyLogSelectedDate?: string
  reportDraftEntries?: DailyEntry[]
  reportDayFormDrafts?: Record<string, Partial<ReportDayFormDraft>>
}

type StoredUiPreferences = Record<string, UserUiPreferences>

const UI_PREFERENCES_KEY = 'financial-goal-ui-preferences'

function isScreen(value: unknown): value is Screen {
  return value === 'dashboard' || value === 'daily-log' || value === 'configuration'
}

function readStoredPreferences(): StoredUiPreferences {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const storedValue = window.localStorage.getItem(UI_PREFERENCES_KEY)

    if (!storedValue) {
      return {}
    }

    const parsedValue = JSON.parse(storedValue)
    return typeof parsedValue === 'object' && parsedValue !== null ? parsedValue : {}
  } catch {
    return {}
  }
}

function writeStoredPreferences(storedPreferences: StoredUiPreferences) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(storedPreferences))
}

export function getUserCurrentScreen(userId: string): Screen | undefined {
  const userPreferences = readStoredPreferences()[userId]
  return isScreen(userPreferences?.currentScreen) ? userPreferences.currentScreen : undefined
}

export function updateUserCurrentScreen(userId: string, currentScreen: Screen) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId] ?? {}

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: {
      ...currentPreferences,
      currentScreen,
    },
  })
}

export function getUserDailyLogSelectedDate(userId: string) {
  const userPreferences = readStoredPreferences()[userId]
  const selectedDate = userPreferences?.dailyLogSelectedDate

  return typeof selectedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
    ? selectedDate
    : undefined
}

export function updateUserDailyLogSelectedDate(userId: string, selectedDate: string) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId] ?? {}

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: {
      ...currentPreferences,
      dailyLogSelectedDate: selectedDate,
    },
  })
}

export function getUserReportDraftEntries(userId: string): DailyEntry[] | null {
  const userPreferences = readStoredPreferences()[userId]
  const reportDraftEntries = userPreferences?.reportDraftEntries

  if (!Array.isArray(reportDraftEntries)) {
    return null
  }

  const normalizedEntries = reportDraftEntries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is DailyEntry => entry !== null)

  return normalizedEntries
}

export function updateUserReportDraftEntries(userId: string, reportDraftEntries: DailyEntry[]) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId] ?? {}

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: {
      ...currentPreferences,
      reportDraftEntries,
    },
  })
}

export function clearUserReportDraftEntries(userId: string) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId]

  if (!currentPreferences) {
    return
  }

  const { reportDraftEntries, ...remainingPreferences } = currentPreferences

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: remainingPreferences,
  })
}

function normalizeReportWorkItemDraft(
  value: unknown,
  fallbackLineIndex: number,
): ReportWorkItemDraft | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const draft = value as Record<string, unknown>
  const rawLineIndex = draft.lineIndex

  return {
    id: typeof draft.id === 'string' ? draft.id : undefined,
    projectName: typeof draft.projectName === 'string' ? draft.projectName : '',
    hours: typeof draft.hours === 'string' ? draft.hours : '',
    hourlyRate: typeof draft.hourlyRate === 'string' ? draft.hourlyRate : '',
    invoicedIncome: typeof draft.invoicedIncome === 'string' ? draft.invoicedIncome : '',
    lineIndex:
      typeof rawLineIndex === 'number' && Number.isFinite(rawLineIndex)
        ? Math.trunc(rawLineIndex)
        : fallbackLineIndex,
  }
}

export function getUserReportDayFormDrafts(
  userId: string,
): Record<string, ReportDayFormDraft> {
  const userPreferences = readStoredPreferences()[userId]
  const reportDayFormDrafts = userPreferences?.reportDayFormDrafts

  if (typeof reportDayFormDrafts !== 'object' || reportDayFormDrafts === null) {
    return {}
  }

  return Object.entries(reportDayFormDrafts).reduce<Record<string, ReportDayFormDraft>>((currentValue, [dateKey, draft]) => {
    if (typeof draft !== 'object' || draft === null) {
      return currentValue
    }

    const workItems = Array.isArray(draft.workItems)
      ? draft.workItems
          .map((workItem, index) => normalizeReportWorkItemDraft(workItem, index))
          .filter((workItem): workItem is ReportWorkItemDraft => workItem !== null)
          .sort((left, right) => left.lineIndex - right.lineIndex)
      : undefined

    currentValue[dateKey] = {
      expenses: typeof draft.expenses === 'string' ? draft.expenses : '',
      hours: typeof draft.hours === 'string' ? draft.hours : '',
      invoicedIncome: typeof draft.invoicedIncome === 'string' ? draft.invoicedIncome : '',
      paidIncome: typeof draft.paidIncome === 'string' ? draft.paidIncome : '',
      ...(workItems && workItems.length > 0 ? { workItems } : {}),
    }

    return currentValue
  }, {})
}

export function updateUserReportDayFormDrafts(
  userId: string,
  reportDayFormDrafts: Record<string, ReportDayFormDraft>,
) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId] ?? {}

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: {
      ...currentPreferences,
      reportDayFormDrafts,
    },
  })
}

export function clearUserReportDayFormDrafts(userId: string) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId]

  if (!currentPreferences) {
    return
  }

  const { reportDayFormDrafts, ...remainingPreferences } = currentPreferences

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: remainingPreferences,
  })
}

export function getUserConfigurationDraft(userId: string): ConfigurationDraft | null {
  const userPreferences = readStoredPreferences()[userId]
  const configurationDraft = userPreferences?.configurationDraft

  if (
    typeof configurationDraft !== 'object' ||
    configurationDraft === null ||
    !Array.isArray(configurationDraft.monthlySummaries)
  ) {
    return null
  }

  const normalizedSummaries = configurationDraft.monthlySummaries
    .map((summary) => normalizeMonthlySummary(summary))
    .filter((summary): summary is MonthlySummary => summary !== null)

  return {
    monthlySummaries: normalizedSummaries,
    settings: normalizeSettings(configurationDraft.settings),
  }
}

export function updateUserConfigurationDraft(
  userId: string,
  configurationDraft: ConfigurationDraft,
) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId] ?? {}

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: {
      ...currentPreferences,
      configurationDraft,
    },
  })
}

export function clearUserConfigurationDraft(userId: string) {
  const storedPreferences = readStoredPreferences()
  const currentPreferences = storedPreferences[userId]

  if (!currentPreferences) {
    return
  }

  const { configurationDraft, ...remainingPreferences } = currentPreferences

  writeStoredPreferences({
    ...storedPreferences,
    [userId]: remainingPreferences,
  })
}
