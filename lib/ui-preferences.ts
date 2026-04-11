'use client'

import { normalizeEntry, normalizeMonthlySummary, normalizeSettings } from './default-state'
import type { DailyEntry, MonthlySummary, Screen, Settings } from './types'

interface ConfigurationDraft {
  monthlySummaries: MonthlySummary[]
  settings: Settings
}

interface UserUiPreferences {
  configurationDraft?: ConfigurationDraft
  currentScreen?: Screen
  reportDraftEntries?: DailyEntry[]
  reportDayFormDrafts?: Record<
    string,
    {
      expenses?: string
      hours?: string
      invoicedIncome?: string
      paidIncome?: string
    }
  >
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

export function getUserReportDayFormDrafts(
  userId: string,
): Record<
  string,
  {
    expenses: string
    hours: string
    invoicedIncome: string
    paidIncome: string
  }
> {
  const userPreferences = readStoredPreferences()[userId]
  const reportDayFormDrafts = userPreferences?.reportDayFormDrafts

  if (typeof reportDayFormDrafts !== 'object' || reportDayFormDrafts === null) {
    return {}
  }

  return Object.entries(reportDayFormDrafts).reduce<
    Record<
      string,
      {
        expenses: string
        hours: string
        invoicedIncome: string
        paidIncome: string
      }
    >
  >((currentValue, [dateKey, draft]) => {
    if (typeof draft !== 'object' || draft === null) {
      return currentValue
    }

    currentValue[dateKey] = {
      expenses: typeof draft.expenses === 'string' ? draft.expenses : '',
      hours: typeof draft.hours === 'string' ? draft.hours : '',
      invoicedIncome: typeof draft.invoicedIncome === 'string' ? draft.invoicedIncome : '',
      paidIncome: typeof draft.paidIncome === 'string' ? draft.paidIncome : '',
    }

    return currentValue
  }, {})
}

export function updateUserReportDayFormDrafts(
  userId: string,
  reportDayFormDrafts: Record<
    string,
    {
      expenses: string
      hours: string
      invoicedIncome: string
      paidIncome: string
    }
  >,
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
