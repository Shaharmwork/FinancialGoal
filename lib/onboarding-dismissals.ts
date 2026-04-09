'use client'

interface UserOnboardingDismissals {
  dismissedCurrentMonthReminderMonthKey?: string
  dismissedHistoricalBackfill?: boolean
}

type StoredOnboardingDismissals = Record<string, UserOnboardingDismissals>

const ONBOARDING_DISMISSALS_KEY = 'financial-goal-onboarding-dismissals'

function readStoredDismissals(): StoredOnboardingDismissals {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const storedValue = window.localStorage.getItem(ONBOARDING_DISMISSALS_KEY)

    if (!storedValue) {
      return {}
    }

    const parsedValue = JSON.parse(storedValue)

    return typeof parsedValue === 'object' && parsedValue !== null ? parsedValue : {}
  } catch {
    return {}
  }
}

function writeStoredDismissals(storedDismissals: StoredOnboardingDismissals) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ONBOARDING_DISMISSALS_KEY, JSON.stringify(storedDismissals))
}

export function getUserOnboardingDismissals(userId: string): UserOnboardingDismissals {
  return readStoredDismissals()[userId] ?? {}
}

export function updateUserOnboardingDismissals(
  userId: string,
  nextDismissals: Partial<UserOnboardingDismissals>,
) {
  const storedDismissals = readStoredDismissals()
  const currentDismissals = storedDismissals[userId] ?? {}

  writeStoredDismissals({
    ...storedDismissals,
    [userId]: {
      ...currentDismissals,
      ...nextDismissals,
    },
  })
}
