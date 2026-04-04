'use client'

import { useEffect, useState } from 'react'
import { Configuration as ConfigurationScreen } from '@/components/configuration'
import { DailyLog } from '@/components/daily-log'
import { Dashboard } from '@/components/dashboard'
import {
  defaultStoredState,
  normalizeStoredState,
  STORAGE_KEY,
} from '@/lib/default-state'
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
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY)
      if (!storedValue) {
        setHasLoaded(true)
        return
      }

      const parsed = normalizeStoredState(JSON.parse(storedValue))
      setCurrentScreen(parsed.currentScreen)
      setEntries(parsed.entries)
      setMonthlySummaries(parsed.monthlySummaries)
      setSettings(parsed.settings)
    } catch {
      window.localStorage.removeItem(STORAGE_KEY)
    } finally {
      setHasLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!hasLoaded) {
      return
    }

    const stateToStore: StoredAppState = {
      currentScreen,
      entries,
      monthlySummaries,
      settings,
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToStore))
  }, [currentScreen, entries, monthlySummaries, settings, hasLoaded])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [currentScreen])

  const handleAddEntry = (entry: DailyEntry) => {
    setEntries((previousEntries) => [entry, ...previousEntries])
    setCurrentScreen('dashboard')
  }

  const handleScreenChange = (screen: Screen) => {
    setCurrentScreen(screen)
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(255,216,107,0.35),transparent_36%),radial-gradient(circle_at_top_right,rgba(136,201,255,0.28),transparent_32%),radial-gradient(circle_at_30%_75%,rgba(201,188,255,0.22),transparent_26%)]" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-[30rem] flex-col px-4 pb-[calc(7.75rem+env(safe-area-inset-bottom))] pt-4 sm:px-5">
        <div className="w-full">
          {currentScreen === 'dashboard' ? (
            <section key="dashboard" data-screen-panel="dashboard" className="screen-panel-active">
              <Dashboard
                entries={entries}
                monthlySummaries={monthlySummaries}
                settings={settings}
              />
            </section>
          ) : null}

          {currentScreen === 'daily-log' ? (
            <section key="daily-log" data-screen-panel="daily-log" className="screen-panel-active">
              <DailyLog entries={entries} settings={settings} onAddEntry={handleAddEntry} />
            </section>
          ) : null}

          {currentScreen === 'configuration' ? (
            <section
              key="configuration"
              data-screen-panel="configuration"
              className="screen-panel-active"
            >
              <ConfigurationScreen
                monthlySummaries={monthlySummaries}
                onUpdateMonthlySummaries={setMonthlySummaries}
                settings={settings}
                onUpdateSettings={setSettings}
              />
            </section>
          ) : null}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-[120] px-4 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-3">
        <div className="mx-auto grid max-w-[30rem] grid-cols-3 gap-2 rounded-[2rem] border border-border bg-card p-2 shadow-[0_18px_36px_rgba(24,32,48,0.14)]">
          {navItems.map((item) => {
            const isActive = currentScreen === item.id

            return (
              <button
                key={item.id}
                aria-current={isActive ? 'page' : undefined}
                className={`touch-manipulation select-none rounded-[1.45rem] px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-[linear-gradient(135deg,rgba(255,216,107,0.95),rgba(255,143,122,0.85))] text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
                onClick={() => {
                  handleScreenChange(item.id)
                }}
                onMouseDown={() => {
                  handleScreenChange(item.id)
                }}
                onPointerUp={() => {
                  handleScreenChange(item.id)
                }}
                onTouchStart={() => {
                  handleScreenChange(item.id)
                }}
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
      </nav>
    </div>
  )
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
