'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Configuration as ConfigurationScreen } from '@/components/configuration'
import { DailyLog } from '@/components/daily-log'
import { Dashboard } from '@/components/dashboard'
import { LoginForm } from '@/components/login-form'
import {
  loadRemoteAppData,
  saveDailyEntriesToSupabase,
  saveMonthlySummariesToSupabase,
  saveSettingsToSupabase,
} from '@/lib/app-data-store'
import {
  defaultStoredState,
  normalizeStoredState,
  STORAGE_KEY,
} from '@/lib/default-state'
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
  StoredAppState,
} from '@/lib/types'

const navItems: Array<{ id: Screen; label: string }> = [
  { id: 'dashboard', label: 'Home' },
  { id: 'daily-log', label: 'Report' },
  { id: 'configuration', label: 'Configuration' },
]

export default function Home() {
  const [currentScreen, setCurrentScreen] = useState<Screen>(defaultStoredState.currentScreen)
  const [entries, setEntries] = useState<DailyEntry[]>(defaultStoredState.entries)
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>(
    defaultStoredState.monthlySummaries,
  )
  const [settings, setSettings] = useState<Settings>(defaultStoredState.settings)
  const [localStateForMigration, setLocalStateForMigration] = useState<StoredAppState | null>(null)
  const [hasLoadedLocalState, setHasLoadedLocalState] = useState(false)
  const [hasCheckedSession, setHasCheckedSession] = useState(false)
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [toastErrorMessage, setToastErrorMessage] = useState('')

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY)
      if (storedValue) {
        const parsedLocalState = normalizeStoredState(JSON.parse(storedValue))
        setLocalStateForMigration(parsedLocalState)
        setCurrentScreen(parsedLocalState.currentScreen)
        setEntries(parsedLocalState.entries)
        setMonthlySummaries(parsedLocalState.monthlySummaries)
        setSettings(parsedLocalState.settings)
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
    } finally {
      setHasLoadedLocalState(true)
    }
  }, [])

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
      return
    }

    let isActive = true
    setHasLoadedRemoteState(false)

    void loadRemoteAppData(localStateForMigration)
      .then((remoteData) => {
        if (!isActive) {
          return
        }

        setEntries(remoteData.entries)
        setMonthlySummaries(remoteData.monthlySummaries)
        setSettings(remoteData.settings)
        setHasLoadedRemoteState(true)
      })
      .catch((error) => {
        console.error('[Financial Goal] Failed to load Supabase data.', error)
        if (!isActive) {
          return
        }

        setHasLoadedRemoteState(true)
      })

    return () => {
      isActive = false
    }
  }, [hasCheckedSession, session, localStateForMigration])

  useEffect(() => {
    if (!hasLoadedLocalState) {
      return
    }

    const stateToStore: StoredAppState = {
      currentScreen,
      entries,
      monthlySummaries,
      settings,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToStore))
  }, [currentScreen, entries, monthlySummaries, settings, hasLoadedLocalState])

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return
    }

    void saveSettingsToSupabase(settings).catch((error) => {
      console.error('[Financial Goal] Failed to save settings.', error)
    })
  }, [settings, hasLoadedRemoteState])

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return
    }

    void saveDailyEntriesToSupabase(entries).catch((error) => {
      console.error('[Financial Goal] Failed to save daily entries.', error)
    })
  }, [entries, hasLoadedRemoteState])

  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return
    }

    void saveMonthlySummariesToSupabase(monthlySummaries).catch((error) => {
      console.error('[Financial Goal] Failed to save monthly summaries.', error)
    })
  }, [monthlySummaries, hasLoadedRemoteState])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [currentScreen])

  useEffect(() => {
    console.log('[Financial Goal] currentScreen changed:', currentScreen)
  }, [currentScreen])

  const handleAddEntry = (entry: DailyEntry) => {
    setEntries((previousEntries) => [entry, ...previousEntries])
    setCurrentScreen('dashboard')
  }

  const handleScreenChange = (screen: Screen) => {
    setCurrentScreen(screen)
  }

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

  const activeScreen = useMemo(() => {
    if (currentScreen === 'dashboard') {
      return (
        <Dashboard
          entries={entries}
          monthlySummaries={monthlySummaries}
          settings={settings}
        />
      )
    }

    if (currentScreen === 'daily-log') {
      return <DailyLog entries={entries} settings={settings} onAddEntry={handleAddEntry} />
    }

    return (
      <ConfigurationScreen
        monthlySummaries={monthlySummaries}
        onUpdateMonthlySummaries={setMonthlySummaries}
        settings={settings}
        onUpdateSettings={setSettings}
      />
    )
  }, [currentScreen, entries, monthlySummaries, settings])

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

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[30rem] flex-col px-4 pb-[calc(12rem+env(safe-area-inset-bottom))] pt-4 sm:px-5">
        <section key={currentScreen} data-screen={currentScreen} className="w-full">
          {!hasLoadedRemoteState ? (
            <div className="rounded-[1.9rem] border border-border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">Loading your data...</p>
            </div>
          ) : null}
          {activeScreen}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-[140] px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3">
        <div className="mx-auto max-w-[30rem]">
          <div className="grid grid-cols-3 gap-2 rounded-[2rem] border border-border bg-card p-2 shadow-[0_18px_36px_rgba(24,32,48,0.14)]">
            {navItems.map((item) => {
              const isActive = currentScreen === item.id

              return (
                <button
                  key={item.id}
                  aria-current={isActive ? 'page' : undefined}
                  className={`min-h-[4.5rem] w-full touch-manipulation select-none rounded-[1.45rem] px-3 py-3 text-sm font-medium transition ${
                    isActive
                      ? 'bg-[linear-gradient(135deg,rgba(255,216,107,0.95),rgba(255,143,122,0.85))] text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => handleScreenChange(item.id)}
                  type="button"
                >
                  <span className="flex flex-col items-center justify-center gap-1">
                    <span aria-hidden="true">
                      {item.id === 'dashboard' ? (
                        <HomeIcon />
                      ) : item.id === 'daily-log' ? (
                        <ClockIcon />
                      ) : (
                        <CogIcon />
                      )}
                    </span>
                    <span className="block text-[13px]">{item.label}</span>
                  </span>
                  <span
                    className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${
                      isActive ? 'bg-foreground/75' : 'bg-transparent'
                    }`}
                  />
                </button>
              )
            })}
          </div>

          <button
            className="mt-2 w-full rounded-[1.4rem] border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-[0_18px_36px_rgba(24,32,48,0.14)] disabled:opacity-60"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            type="button"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </nav>

      <ErrorToast message={toastErrorMessage} onDismiss={() => setToastErrorMessage('')} />
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
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[200] px-4">
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
