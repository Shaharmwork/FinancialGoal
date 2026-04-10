'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Configuration as ConfigurationScreen } from '@/components/configuration'
import { DailyLog } from '@/components/daily-log'
import { Dashboard } from '@/components/dashboard'
import { LoginForm } from '@/components/login-form'
import { WarningModal } from '@/components/warning-modal'
import {
  loadRemoteAppData,
  saveDailyEntriesToSupabase,
  saveMonthlySummariesToSupabase,
  saveSettingsToSupabase,
} from '@/lib/app-data-store'
import {
  getUserOnboardingDismissals,
  updateUserOnboardingDismissals,
} from '@/lib/onboarding-dismissals'
import { starterStoredState } from '@/lib/default-state'
import {
  clearUserReportDayFormDrafts,
  clearUserReportDraftEntries,
  getUserCurrentScreen,
  getUserReportDraftEntries,
  updateUserCurrentScreen,
  updateUserReportDraftEntries,
} from '@/lib/ui-preferences'
import { toMonthKey } from '@/lib/calculations'
import {
  getCurrentSession,
  hasSupabaseConfig,
  onSupabaseAuthStateChange,
  signInWithEmailPassword,
  signOutFromSupabase,
} from '@/lib/supabase'
import type {
  DailyEntry,
  MonthlySummary,
  Screen,
  Settings,
} from '@/lib/types'

const navItems: Array<{ id: Screen; label: string }> = [
  { id: 'dashboard', label: 'Home' },
  { id: 'daily-log', label: 'Report' },
  { id: 'configuration', label: 'Configuration' },
]

function cloneEntries(entries: DailyEntry[]) {
  return entries.map((entry) => ({ ...entry }))
}

function removeEntryByDate(entries: DailyEntry[], dateKey: string) {
  return entries.filter((entry) => entry.date !== dateKey)
}

function getComparableEntries(entries: DailyEntry[]) {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date))
}

function areEntriesEqual(left: DailyEntry[], right: DailyEntry[]) {
  if (left.length !== right.length) {
    return false
  }

  const comparableLeft = getComparableEntries(left)
  const comparableRight = getComparableEntries(right)

  return comparableLeft.every((leftEntry, index) => {
    const rightEntry = comparableRight[index]

    return (
      leftEntry.date === rightEntry.date &&
      (leftEntry.dayStatus ?? 'worked') === (rightEntry.dayStatus ?? 'worked') &&
      leftEntry.hours === rightEntry.hours &&
      leftEntry.invoicedIncome === rightEntry.invoicedIncome &&
      leftEntry.paidIncome === rightEntry.paidIncome &&
      leftEntry.expenses === rightEntry.expenses &&
      (leftEntry.note ?? '') === (rightEntry.note ?? '') &&
      (leftEntry.source ?? '') === (rightEntry.source ?? '')
    )
  })
}

function hasFutureDatedEntries(entries: DailyEntry[], todayDateKey: string) {
  return entries.some((entry) => entry.date > todayDateKey)
}

function getNewSummaryConflictMonthKeys(
  savedEntries: DailyEntry[],
  nextEntries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
) {
  const summaryMonthKeys = new Set(monthlySummaries.map((summary) => summary.monthKey))
  const savedEntryMonthKeys = new Set(savedEntries.map((entry) => entry.date.slice(0, 7)))
  const nextEntryMonthKeys = new Set(nextEntries.map((entry) => entry.date.slice(0, 7)))

  return [...summaryMonthKeys].filter(
    (monthKey) => nextEntryMonthKeys.has(monthKey) && !savedEntryMonthKeys.has(monthKey),
  )
}

export default function Home() {
  const todayDateKey = new Date().toISOString().slice(0, 10)
  const [currentScreen, setCurrentScreen] = useState<Screen>(starterStoredState.currentScreen)
  const [entries, setEntries] = useState<DailyEntry[]>(starterStoredState.entries)
  const [reportDraftEntries, setReportDraftEntries] = useState<DailyEntry[] | null>(null)
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>(
    starterStoredState.monthlySummaries,
  )
  const [settings, setSettings] = useState<Settings>(starterStoredState.settings)
  const [hasCheckedSession, setHasCheckedSession] = useState(false)
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(false)
  const [displayName, setDisplayName] = useState<string | undefined>(undefined)
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0)
  const [backfillFocusRequest, setBackfillFocusRequest] = useState(0)
  const [reportResetRequest, setReportResetRequest] = useState(0)
  const [fillMissingDaysRequest, setFillMissingDaysRequest] = useState(0)
  const [dismissedCurrentMonthReminderMonthKey, setDismissedCurrentMonthReminderMonthKey] =
    useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isUnsavedReportModalOpen, setIsUnsavedReportModalOpen] = useState(false)
  const [isSummaryConflictWarningOpen, setIsSummaryConflictWarningOpen] = useState(false)
  const [isFutureReportWarningOpen, setIsFutureReportWarningOpen] = useState(false)
  const [pendingSummaryConflictSaveEntries, setPendingSummaryConflictSaveEntries] = useState<
    DailyEntry[] | null
  >(null)
  const [pendingFutureSaveEntries, setPendingFutureSaveEntries] = useState<DailyEntry[] | null>(null)
  const [pendingScreen, setPendingScreen] = useState<Screen | null>(null)
  const [toastErrorMessage, setToastErrorMessage] = useState('')
  const [hasHydratedReportDraftEntries, setHasHydratedReportDraftEntries] = useState(false)
  const hasUnsavedReportChanges =
    reportDraftEntries !== null && !areEntriesEqual(reportDraftEntries, entries)

  useEffect(() => {
    let isActive = true
    let hasResolvedSession = false

    if (!hasSupabaseConfig()) {
      setHasCheckedSession(true)
      return () => {
        isActive = false
      }
    }

    const fallbackTimer = window.setTimeout(() => {
      if (!isActive || hasResolvedSession) {
        return
      }

      console.warn('[Financial Goal] Session check timed out. Falling back to logged-out state.')
      setSession(null)
      setToastErrorMessage('Session error. Could not restore your session. Try signing in again.')
      setHasCheckedSession(true)
    }, 2500)

    void getCurrentSession()
      .then((currentSession) => {
        if (!isActive) {
          return
        }

        hasResolvedSession = true
        window.clearTimeout(fallbackTimer)
        setSession(currentSession)
        setHasCheckedSession(true)
      })
      .catch((error) => {
        console.error('[Financial Goal] Failed to load auth session.', error)
        if (!isActive) {
          return
        }

        hasResolvedSession = true
        window.clearTimeout(fallbackTimer)
        setSession(null)
        setToastErrorMessage('Session error. Could not restore your session. Try signing in again.')
        setHasCheckedSession(true)
      })

    const unsubscribe = onSupabaseAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return
      }

      hasResolvedSession = true
      window.clearTimeout(fallbackTimer)
      setSession(nextSession)
      setToastErrorMessage('')
      setHasCheckedSession(true)
    })

    return () => {
      isActive = false
      window.clearTimeout(fallbackTimer)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!hasCheckedSession || !session) {
      setHasLoadedRemoteState(false)
      setDisplayName(undefined)
      return
    }

    let isActive = true
    setHasLoadedRemoteState(false)

    void loadRemoteAppData()
      .then((remoteData) => {
        if (!isActive) {
          return
        }

        setEntries(remoteData.entries)
        setMonthlySummaries(remoteData.monthlySummaries)
        setSettings(remoteData.settings)
        setDisplayName(remoteData.displayName)
        setHasLoadedRemoteState(true)
      })
      .catch((error) => {
        console.error('[Financial Goal] Failed to load Supabase data.', error)
        if (!isActive) {
          return
        }

        setDisplayName(undefined)
        setHasLoadedRemoteState(true)
      })

    return () => {
      isActive = false
    }
  }, [hasCheckedSession, session])

  useEffect(() => {
    const userId = session?.user?.id

    if (!userId) {
      setDismissedCurrentMonthReminderMonthKey('')
      setCurrentScreen('dashboard')
      setReportDraftEntries(null)
      setHasHydratedReportDraftEntries(false)
      return
    }

    const dismissals = getUserOnboardingDismissals(userId)
    setDismissedCurrentMonthReminderMonthKey(
      dismissals.dismissedCurrentMonthReminderMonthKey ?? '',
    )

    const savedScreen = getUserCurrentScreen(userId)
    setCurrentScreen(savedScreen ?? 'dashboard')
  }, [session])

  useEffect(() => {
    const userId = session?.user?.id

    if (!userId) {
      return
    }

    updateUserCurrentScreen(userId, currentScreen)
  }, [currentScreen, session])

  useEffect(() => {
    const userId = session?.user?.id

    if (!userId || !hasLoadedRemoteState) {
      return
    }

    setReportDraftEntries(getUserReportDraftEntries(userId))
    setHasHydratedReportDraftEntries(true)
  }, [hasLoadedRemoteState, session])

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return
    }

    void saveDailyEntriesToSupabase(entries).catch((error) => {
      console.error('[Financial Goal] Failed to save daily entries.', error)
    })
  }, [entries, hasLoadedRemoteState])

  useEffect(() => {
    const userId = session?.user?.id

    if (!userId || !hasLoadedRemoteState) {
      return
    }

    if (reportDraftEntries !== null && !areEntriesEqual(reportDraftEntries, entries)) {
      updateUserReportDraftEntries(userId, reportDraftEntries)
      return
    }

    clearUserReportDraftEntries(userId)
  }, [entries, hasLoadedRemoteState, reportDraftEntries, session])

  useEffect(() => {
    if (currentScreen !== 'daily-log') {
      return
    }

    if (!hasLoadedRemoteState || !hasHydratedReportDraftEntries) {
      return
    }

    if (reportDraftEntries === null) {
      setReportDraftEntries(cloneEntries(entries))
      return
    }

    if (!hasUnsavedReportChanges && !areEntriesEqual(reportDraftEntries, entries)) {
      setReportDraftEntries(cloneEntries(entries))
    }
  }, [
    currentScreen,
    entries,
    hasHydratedReportDraftEntries,
    hasLoadedRemoteState,
    hasUnsavedReportChanges,
    reportDraftEntries,
  ])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [currentScreen])

  useEffect(() => {
    console.log('[Financial Goal] currentScreen changed:', currentScreen)
  }, [currentScreen])

  const handleUpsertEntry = useCallback((entry: DailyEntry) => {
    setReportDraftEntries((previousEntries) => {
      const draftEntries = previousEntries ?? cloneEntries(entries)

      return [
        entry,
        ...draftEntries.filter((previousEntry) => previousEntry.date !== entry.date),
      ]
    })
  }, [entries])

  const handleRemoveEntryForDate = useCallback((dateKey: string) => {
    setReportDraftEntries((previousEntries) => {
      const draftEntries = previousEntries ?? cloneEntries(entries)
      return draftEntries.filter((previousEntry) => previousEntry.date !== dateKey)
    })
  }, [entries])

  const handleDeleteSavedEntryImmediately = useCallback((dateKey: string) => {
    setEntries((previousEntries) => {
      const nextSavedEntries = removeEntryByDate(previousEntries, dateKey)

      setReportDraftEntries((previousDraftEntries) =>
        removeEntryByDate(previousDraftEntries ?? cloneEntries(nextSavedEntries), dateKey),
      )

      return nextSavedEntries
    })
  }, [])

  const proceedToScreen = (screen: Screen) => {
    if (screen === 'daily-log' && reportDraftEntries === null) {
      setReportDraftEntries(cloneEntries(entries))
    }

    if (screen === 'daily-log') {
      setReportResetRequest((currentValue) => currentValue + 1)
    }

    setCurrentScreen(screen)
  }

  const commitReportEntries = (entriesToSave: DailyEntry[]) => {
    setEntries(cloneEntries(entriesToSave))
    setReportDraftEntries(cloneEntries(entriesToSave))
    const userId = session?.user?.id

    if (userId) {
      clearUserReportDayFormDrafts(userId)
      clearUserReportDraftEntries(userId)
    }
  }

  const finishSavingReportEntries = (entriesToSave: DailyEntry[]) => {
    if (hasFutureDatedEntries(entriesToSave, todayDateKey)) {
      setPendingFutureSaveEntries(cloneEntries(entriesToSave))
      setIsFutureReportWarningOpen(true)
      return false
    }

    commitReportEntries(entriesToSave)
    return true
  }

  const handleSaveReportEntries = (nextEntries?: DailyEntry[]) => {
    const entriesToSave = nextEntries ?? reportDraftEntries

    if (entriesToSave === null || !entriesToSave) {
      return true
    }

    if (getNewSummaryConflictMonthKeys(entries, entriesToSave, monthlySummaries).length > 0) {
      setPendingSummaryConflictSaveEntries(cloneEntries(entriesToSave))
      setIsSummaryConflictWarningOpen(true)
      return false
    }

    return finishSavingReportEntries(entriesToSave)
  }

  const handleDiscardReportEntries = () => {
    setReportDraftEntries(cloneEntries(entries))
    const userId = session?.user?.id

    if (userId) {
      clearUserReportDayFormDrafts(userId)
      clearUserReportDraftEntries(userId)
    }
  }

  const handleScreenChange = (screen: Screen) => {
    if (screen === currentScreen) {
      return
    }

    if (currentScreen === 'daily-log' && screen !== 'daily-log' && hasUnsavedReportChanges) {
      setPendingScreen(screen)
      setIsUnsavedReportModalOpen(true)
      return
    }

    proceedToScreen(screen)
  }

  const handleOpenConfigurationSetup = useCallback(() => {
    setSettingsFocusRequest((currentValue) => currentValue + 1)
    setCurrentScreen('configuration')
  }, [])

  const handleAddPreviousMonths = useCallback(() => {
    setBackfillFocusRequest((currentValue) => currentValue + 1)
    setCurrentScreen('configuration')
  }, [])

  const handleFillMissingDays = useCallback(() => {
    setFillMissingDaysRequest((currentValue) => currentValue + 1)
    setCurrentScreen('daily-log')
  }, [])

  const handleDismissCurrentMonthReminder = useCallback(() => {
    const userId = session?.user?.id

    if (!userId) {
      return
    }

    const currentMonthKey = toMonthKey(new Date())
    setDismissedCurrentMonthReminderMonthKey(currentMonthKey)
    updateUserOnboardingDismissals(userId, {
      dismissedCurrentMonthReminderMonthKey: currentMonthKey,
    })
  }, [session])

  const handleSaveConfiguration = useCallback(async (
    nextSettings: Settings,
    nextMonthlySummaries: MonthlySummary[],
  ) => {
    try {
      await Promise.all([
        saveSettingsToSupabase(nextSettings),
        saveMonthlySummariesToSupabase(nextMonthlySummaries),
      ])

      setSettings(nextSettings)
      setMonthlySummaries(nextMonthlySummaries)
    } catch (error) {
      console.error('[Financial Goal] Failed to save configuration.', error)
      setToastErrorMessage(getErrorMessage(error, 'Failed to save configuration.'))
      throw error
    }
  }, [])
  const handleSignIn = async (email: string, password: string) => {
    if (!hasSupabaseConfig()) {
      setToastErrorMessage(
        'Missing Supabase config. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
      )
      return
    }

    if (!email || !password) {
      setToastErrorMessage('Enter your email and password.')
      return
    }

    setIsSigningIn(true)
    setToastErrorMessage('')

    try {
      await signInWithEmailPassword(email, password)
    } catch (error) {
      console.error('[Financial Goal] Sign in failed.', error)
      const nextMessage = getSignInErrorMessage(error)
      setToastErrorMessage(nextMessage)
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)
    setToastErrorMessage('')

    try {
      await signOutFromSupabase()
      setHasLoadedRemoteState(false)
    } catch (error) {
      setToastErrorMessage(getErrorMessage(error, 'Sign out failed.'))
    } finally {
      setIsSigningOut(false)
    }
  }

  let activeScreen: React.ReactNode

  if (currentScreen === 'dashboard') {
    activeScreen = (
      <Dashboard
        displayName={displayName}
        entries={entries}
        isCurrentMonthReminderDismissed={
          dismissedCurrentMonthReminderMonthKey === toMonthKey(new Date())
        }
        monthlySummaries={monthlySummaries}
        onOpenConfigurationSetup={handleOpenConfigurationSetup}
        onAddPreviousMonths={handleAddPreviousMonths}
        onDismissCurrentMonthReminder={handleDismissCurrentMonthReminder}
        onFillMissingDays={handleFillMissingDays}
        settings={settings}
      />
    )
  } else if (currentScreen === 'daily-log') {
    activeScreen = (
      <DailyLog
        entries={reportDraftEntries ?? entries}
        fillMissingDaysRequest={fillMissingDaysRequest}
        hasUnsavedChanges={hasUnsavedReportChanges}
        onDeleteSavedEntryImmediately={handleDeleteSavedEntryImmediately}
        onRemoveEntryForDate={handleRemoveEntryForDate}
        onSaveEntries={handleSaveReportEntries}
        reportResetRequest={reportResetRequest}
        savedEntries={entries}
        settings={settings}
        onUpsertEntry={handleUpsertEntry}
        userId={session?.user?.id}
      />
    )
  } else {
    activeScreen = (
      <ConfigurationScreen
        backfillFocusRequest={backfillFocusRequest}
        entries={entries}
        settingsFocusRequest={settingsFocusRequest}
        monthlySummaries={monthlySummaries}
        onSaveConfiguration={handleSaveConfiguration}
        settings={settings}
      />
    )
  }

  const isConfigured = hasSupabaseConfig()

  useEffect(() => {
    if (!toastErrorMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setToastErrorMessage('')
    }, 5000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [toastErrorMessage])

  if (!session) {
    return (
      <div className="relative isolate min-h-screen overflow-x-hidden bg-background text-foreground">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,rgba(255,216,107,0.35),transparent_36%),radial-gradient(circle_at_top_right,rgba(136,201,255,0.28),transparent_32%),radial-gradient(circle_at_30%_75%,rgba(201,188,255,0.22),transparent_26%)]" />

        <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[30rem] flex-col px-4 pt-4 sm:px-5">
          <div className="mb-4 rounded-[1.2rem] border border-border bg-amber-100 px-4 py-3 text-center text-sm font-semibold tracking-[0.16em] text-amber-900">
            {hasCheckedSession ? 'SIGN IN' : 'AUTH'}
          </div>
          {!hasCheckedSession ? (
            <section className="mb-4 w-full rounded-[1.25rem] border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
              Checking session… You can already sign in below if needed.
            </section>
          ) : null}
          <section className="w-full">
            <LoginForm
              errorMessage={toastErrorMessage}
              isBusy={isSigningIn}
              isConfigured={isConfigured}
              onSubmit={handleSignIn}
            />
          </section>
        </main>
        <ErrorToast message={toastErrorMessage} onDismiss={() => setToastErrorMessage('')} />
      </div>
    )
  }

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,rgba(255,216,107,0.35),transparent_36%),radial-gradient(circle_at_top_right,rgba(136,201,255,0.28),transparent_32%),radial-gradient(circle_at_30%_75%,rgba(201,188,255,0.22),transparent_26%)]" />

      <nav className="fixed inset-x-0 top-0 z-[160] px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="mx-auto flex max-w-[30rem] items-center justify-between gap-3">
          <div className="grid grid-cols-3 gap-2 rounded-[1.6rem] border border-border bg-card/95 p-1.5 shadow-[0_18px_36px_rgba(24,32,48,0.14)] backdrop-blur">
            {navItems.map((item) => {
              const isActive = currentScreen === item.id

              return (
                <button
                  key={item.id}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-[1.1rem] transition ${
                    isActive
                      ? 'bg-[linear-gradient(135deg,rgba(255,216,107,0.95),rgba(255,143,122,0.85))] text-foreground shadow-sm'
                      : 'bg-transparent text-muted-foreground hover:bg-muted/70'
                  }`}
                  onClick={() => handleScreenChange(item.id)}
                  type="button"
                >
                  <span aria-hidden="true">
                    {item.id === 'dashboard' ? (
                      <HomeIcon />
                    ) : item.id === 'daily-log' ? (
                      <ClockIcon />
                    ) : (
                      <CogIcon />
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          <button
            aria-label={isSigningOut ? 'Signing out' : 'Sign out'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-[0_18px_36px_rgba(24,32,48,0.14)] backdrop-blur transition hover:bg-muted/70 disabled:opacity-60"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            type="button"
          >
            <SignOutIcon />
          </button>
        </div>
      </nav>

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[30rem] flex-col px-4 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+5.75rem)] sm:px-5">
        <section key={currentScreen} data-screen={currentScreen} className="w-full">
          {!hasLoadedRemoteState ? (
            <div className="rounded-[1.9rem] border border-border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">Loading your data...</p>
            </div>
          ) : (
            activeScreen
          )}
        </section>
      </main>

      <ErrorToast message={toastErrorMessage} onDismiss={() => setToastErrorMessage('')} />
      <WarningModal
        body="You have unsaved daily reports. Do you want to save them?"
        isOpen={isUnsavedReportModalOpen}
        onClose={() => {
          setIsUnsavedReportModalOpen(false)
          setPendingScreen(null)
        }}
        onPrimaryAction={() => {
          setIsUnsavedReportModalOpen(false)
          const wasSavedImmediately = handleSaveReportEntries()

          if (wasSavedImmediately && pendingScreen) {
            proceedToScreen(pendingScreen)
            setPendingScreen(null)
          }
        }}
        onSecondaryAction={() => {
          handleDiscardReportEntries()
          setIsUnsavedReportModalOpen(false)

          if (pendingScreen) {
            proceedToScreen(pendingScreen)
            setPendingScreen(null)
          }
        }}
        primaryActionLabel="Save"
        secondaryActionLabel="Don't Save"
        title="Unsaved daily reports"
      />
      <WarningModal
        body="Adding a daily entry here will make daily entries the source of truth for this month. Your monthly summary will no longer be used for calculations unless all daily entries for that month are removed. This may change your dashboard forecasts and tax planning."
        isOpen={isSummaryConflictWarningOpen}
        onClose={() => {
          setIsSummaryConflictWarningOpen(false)
          setPendingSummaryConflictSaveEntries(null)
          setPendingScreen(null)
        }}
        onPrimaryAction={() => {
          const entriesToSave = pendingSummaryConflictSaveEntries
          setIsSummaryConflictWarningOpen(false)
          setPendingSummaryConflictSaveEntries(null)

          if (!entriesToSave) {
            return
          }

          const wasSavedImmediately = finishSavingReportEntries(entriesToSave)

          if (wasSavedImmediately && pendingScreen) {
            proceedToScreen(pendingScreen)
            setPendingScreen(null)
          }
        }}
        onSecondaryAction={() => {
          setIsSummaryConflictWarningOpen(false)
          setPendingSummaryConflictSaveEntries(null)
          setPendingScreen(null)
        }}
        primaryActionLabel="Save daily entry"
        secondaryActionLabel="Cancel"
        title="This month already has a summary"
      />
      <WarningModal
        body="You have one or more daily reports on future dates. They can still be saved, but your dashboard may look ahead before those days actually happen."
        isOpen={isFutureReportWarningOpen}
        onClose={() => {
          setIsFutureReportWarningOpen(false)
          setPendingFutureSaveEntries(null)
          setPendingScreen(null)
        }}
        onPrimaryAction={() => {
          if (pendingFutureSaveEntries) {
            commitReportEntries(pendingFutureSaveEntries)
          }

          setIsFutureReportWarningOpen(false)
          setPendingFutureSaveEntries(null)

          if (pendingScreen) {
            proceedToScreen(pendingScreen)
            setPendingScreen(null)
          }
        }}
        onSecondaryAction={() => {
          setIsFutureReportWarningOpen(false)
          setPendingFutureSaveEntries(null)
          setPendingScreen(null)
        }}
        primaryActionLabel="Save anyway"
        secondaryActionLabel="Go back"
        title="Future day reports included"
      />
    </div>
  )
}

function ErrorToast({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  if (!message) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[200] px-4">
      <div className="pointer-events-auto mx-auto flex w-full max-w-[30rem] items-start gap-3 rounded-[1.3rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-[0_18px_36px_rgba(24,32,48,0.14)]">
        <div className="mt-0.5 shrink-0">
          <ToastWarningIcon />
        </div>
        <p className="flex-1">{message}</p>
        <button
          aria-label="Dismiss error message"
          className="shrink-0 rounded-full p-1 text-rose-700 transition hover:bg-rose-100"
          onClick={onDismiss}
          type="button"
        >
          <ToastCloseIcon />
        </button>
      </div>
    </div>
  )
}

function ToastWarningIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 3.8 3.9 18a1.2 1.2 0 0 0 1 1.8h14.2a1.2 1.2 0 0 0 1-1.8L12 3.8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="M12 9v4.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <circle cx="12" cy="16.7" r="1" fill="currentColor" />
    </svg>
  )
}

function ToastCloseIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 6 18 18M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function getSignInErrorMessage(error: unknown) {
  const rawMessage = getErrorMessage(error, '').toLowerCase()

  if (
    rawMessage.includes('invalid login credentials') ||
    rawMessage.includes('email not confirmed') ||
    rawMessage.includes('invalid credentials')
  ) {
    return 'Invalid login credentials. Check your email and password.'
  }

  if (
    rawMessage.includes('failed to fetch') ||
    rawMessage.includes('fetch failed') ||
    rawMessage.includes('network') ||
    rawMessage.includes('load failed')
  ) {
    return 'Network error. Supabase auth service is unavailable or unreachable.'
  }

  if (
    rawMessage.includes('session') ||
    rawMessage.includes('refresh token') ||
    rawMessage.includes('jwt')
  ) {
    return 'Session error. Clear the saved session and sign in again.'
  }

  if (
    rawMessage.includes('supabase') ||
    rawMessage.includes('auth') ||
    rawMessage.includes('service unavailable')
  ) {
    return 'Supabase auth service is unavailable. Check your auth configuration and try again.'
  }

  return `Unknown sign-in error.${rawMessage ? ` ${getErrorMessage(error, '')}` : ''}`.trim()
}

function HomeIcon() {
  return (
    <svg className="h-[1.1rem] w-[1.1rem]" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 10.6L12 4l8 6.6v8.4a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="h-[1.1rem] w-[1.1rem]" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 7.8v4.5l3.2 1.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function CogIcon() {
  return (
    <svg className="h-[1.1rem] w-[1.1rem]" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Zm7 3.3-.9-.5.1-1.1a1.2 1.2 0 0 0-.8-1.2l-1-.3-.4-1a1.2 1.2 0 0 0-1.3-.7l-1.1.1-.6-.9a1.2 1.2 0 0 0-1.4-.4l-1 .4-1-.4a1.2 1.2 0 0 0-1.4.4l-.6.9-1.1-.1a1.2 1.2 0 0 0-1.3.7l-.4 1-1 .3a1.2 1.2 0 0 0-.8 1.2l.1 1.1-.9.5a1.2 1.2 0 0 0-.5 1.4l.4 1 .1 1.1a1.2 1.2 0 0 0 .8 1.2l1 .3.4 1a1.2 1.2 0 0 0 1.3.7l1.1-.1.6.9a1.2 1.2 0 0 0 1.4.4l1-.4 1 .4a1.2 1.2 0 0 0 1.4-.4l.6-.9 1.1.1a1.2 1.2 0 0 0 1.3-.7l.4-1 1-.3a1.2 1.2 0 0 0 .8-1.2l-.1-1.1.9-.5a1.2 1.2 0 0 0 .5-1.4l-.4-1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg className="h-[1rem] w-[1rem]" fill="none" viewBox="0 0 24 24">
      <path
        d="M10 5.75H7.75A1.75 1.75 0 0 0 6 7.5v9a1.75 1.75 0 0 0 1.75 1.75H10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M13 8.5 17.5 12 13 15.5M17.25 12H10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}
