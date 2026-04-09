'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { DailyEntry, Settings } from '@/lib/types'
import {
  getCurrentMonthRange,
  getEarliestMissingCurrentMonthWeekday,
  parseDateKey,
  parseMonthKey,
  toDateKey,
  toMonthKey,
} from '@/lib/calculations'
import { formatCurrencyPrecise, formatDate, formatHours } from '@/lib/formatters'

interface DailyLogProps {
  entries: DailyEntry[]
  fillMissingDaysRequest?: number
  hasUnsavedChanges?: boolean
  onRemoveEntryForDate: (dateKey: string) => void
  onSaveEntries: (nextEntries?: DailyEntry[]) => void
  onUpsertEntry: (entry: DailyEntry) => void
  reportResetRequest?: number
  settings: Settings
}

interface CalendarDay {
  date: Date
  isCurrentMonth: boolean
  isWeekend: boolean
  key: string
}

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isWeekend(date: Date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

function getWeekStart(date: Date) {
  const day = date.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + mondayOffset)
}

function getWeekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index)
    return {
      date,
      isCurrentMonth: true,
      isWeekend: isWeekend(date),
      key: toDateKey(date),
    }
  })
}

function getMonthStartGridDate(monthDate: Date) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const day = monthStart.getDay()
  const mondayOffset = day === 0 ? 6 : day - 1
  return new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate() - mondayOffset)
}

function getCalendarRows(monthDate: Date) {
  const gridStart = getMonthStartGridDate(monthDate)

  return Array.from({ length: 6 }, (_, rowIndex) =>
    Array.from({ length: 7 }, (_, columnIndex) => {
      const cellDate = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + rowIndex * 7 + columnIndex,
      )

      return {
        date: cellDate,
        isCurrentMonth:
          cellDate.getFullYear() === monthDate.getFullYear() &&
          cellDate.getMonth() === monthDate.getMonth(),
        isWeekend: isWeekend(cellDate),
        key: toDateKey(cellDate),
      }
    }),
  )
}

function getMonthLabel(monthDate: Date) {
  return monthDate.toLocaleDateString('en-NL', {
    month: 'long',
    year: 'numeric',
  })
}

function getCompactDayLabel(date: Date) {
  return date.toLocaleDateString('en-NL', {
    weekday: 'short',
  })
}

function getCalculatedDefaultInvoiceAmount(hours: string, settings: Settings) {
  const resolvedHours = parseNumber(hours)
  const defaultShiftHours = settings.defaultShiftHours ?? 0
  const defaultShiftIncome = settings.defaultShiftIncome ?? 0

  if (resolvedHours > 0 && defaultShiftHours > 0) {
    return (resolvedHours / defaultShiftHours) * defaultShiftIncome
  }

  return defaultShiftIncome
}

function shiftDateKey(dateKey: string, deltaDays: number) {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + deltaDays)
  return toDateKey(date)
}

function shiftMonth(monthKey: string, delta: number) {
  const date = parseMonthKey(monthKey)
  date.setMonth(date.getMonth() + delta)
  return toMonthKey(date)
}

function getDefaultDateForMonth(monthKey: string, today: Date) {
  return monthKey === toMonthKey(today) ? toDateKey(today) : toDateKey(parseMonthKey(monthKey))
}

export function DailyLog({
  entries,
  fillMissingDaysRequest = 0,
  hasUnsavedChanges = false,
  onRemoveEntryForDate,
  onSaveEntries,
  onUpsertEntry,
  reportResetRequest = 0,
  settings,
}: DailyLogProps) {
  const today = new Date()
  const todayDateKey = toDateKey(today)
  const currentMonthKey = toMonthKey(today)
  const currentWeekStartKey = toDateKey(getWeekStart(today))
  const [date, setDate] = useState(todayDateKey)
  const [visibleWeekStartKey, setVisibleWeekStartKey] = useState(currentWeekStartKey)
  const [visibleMonthKey, setVisibleMonthKey] = useState(currentMonthKey)
  const [isMonthExpanded, setIsMonthExpanded] = useState(false)
  const [hours, setHours] = useState('')
  const [invoicedIncome, setInvoicedIncome] = useState('')
  const [paidIncome, setPaidIncome] = useState('')
  const [expenses, setExpenses] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const formRef = useRef<HTMLElement | null>(null)
  const hoursInputRef = useRef<HTMLInputElement | null>(null)
  const visibleMonthDate = parseMonthKey(visibleMonthKey)
  const { start, end } = getCurrentMonthRange(visibleMonthDate)
  const visibleWeekDays = useMemo(
    () => getWeekDays(parseDateKey(visibleWeekStartKey)),
    [visibleWeekStartKey],
  )
  const calendarRows = useMemo(() => getCalendarRows(visibleMonthDate), [visibleMonthDate])
  const monthEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.date >= toDateKey(start) && entry.date <= toDateKey(end))
        .sort((left, right) => right.date.localeCompare(left.date)),
    [entries, end, start],
  )
  const filledDateKeys = useMemo(() => new Set(entries.map((entry) => entry.date)), [entries])
  const noWorkDateKeys = useMemo(
    () => new Set(entries.filter((entry) => entry.dayStatus === 'no_work').map((entry) => entry.date)),
    [entries],
  )
  const calculatedDefaultInvoiceAmount = getCalculatedDefaultInvoiceAmount(hours, settings)
  const hasConfiguredInvoiceDefaults =
    typeof settings.defaultShiftHours === 'number' &&
    settings.defaultShiftHours > 0 &&
    typeof settings.defaultShiftIncome === 'number' &&
    settings.defaultShiftIncome > 0

  const syncSelectedDate = (nextDateKey: string, collapseMonth = false) => {
    const nextDate = parseDateKey(nextDateKey)
    setDate(nextDateKey)
    setVisibleWeekStartKey(toDateKey(getWeekStart(nextDate)))
    setVisibleMonthKey(toMonthKey(nextDate))
    if (collapseMonth) {
      setIsMonthExpanded(false)
    }
  }

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.date === date),
    [date, entries],
  )
  const isSelectedDayMarkedNoWork = selectedEntry?.dayStatus === 'no_work'
  const selectedWorkedHours =
    selectedEntry && selectedEntry.dayStatus !== 'no_work' && selectedEntry.hours > 0
      ? selectedEntry.hours.toString()
      : ''
  const selectedWorkedInvoicedIncome =
    selectedEntry && selectedEntry.dayStatus !== 'no_work' && selectedEntry.invoicedIncome > 0
      ? selectedEntry.invoicedIncome.toString()
      : ''
  const selectedWorkedPaidIncome =
    selectedEntry && selectedEntry.dayStatus !== 'no_work' && selectedEntry.paidIncome > 0
      ? selectedEntry.paidIncome.toString()
      : ''
  const selectedWorkedExpenses =
    selectedEntry && selectedEntry.dayStatus !== 'no_work' && selectedEntry.expenses > 0
      ? selectedEntry.expenses.toString()
      : ''
  const hasPendingSelectedDayChanges =
    !isSelectedDayMarkedNoWork &&
    (hours !== selectedWorkedHours ||
      invoicedIncome !== selectedWorkedInvoicedIncome ||
      paidIncome !== selectedWorkedPaidIncome ||
      expenses !== selectedWorkedExpenses)

  const resetToCurrentDayAndWeek = () => {
    syncSelectedDate(todayDateKey, true)
  }

  useEffect(() => {
    if (reportResetRequest <= 0) {
      return
    }

    resetToCurrentDayAndWeek()
  }, [reportResetRequest, todayDateKey])

  useEffect(() => {
    if (fillMissingDaysRequest <= 0) {
      return
    }

    const todayDate = parseDateKey(todayDateKey)
    const targetDateKey =
      getEarliestMissingCurrentMonthWeekday(entries, todayDate) ?? todayDateKey
    syncSelectedDate(targetDateKey, true)
    formRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    const focusTimeoutId = window.setTimeout(() => {
      hoursInputRef.current?.focus()
    }, 180)

    return () => {
      window.clearTimeout(focusTimeoutId)
    }
  }, [entries, fillMissingDaysRequest, todayDateKey])

  useEffect(() => {
    if (!selectedEntry) {
      setHours('')
      setInvoicedIncome('')
      setPaidIncome('')
      setExpenses('')
      return
    }

    if (selectedEntry.dayStatus === 'no_work') {
      setHours('')
      setInvoicedIncome('')
      setPaidIncome('')
      setExpenses('')
      return
    }

    setHours(selectedEntry.hours > 0 ? selectedEntry.hours.toString() : '')
    setInvoicedIncome(
      selectedEntry.invoicedIncome > 0 ? selectedEntry.invoicedIncome.toString() : '',
    )
    setPaidIncome(selectedEntry.paidIncome > 0 ? selectedEntry.paidIncome.toString() : '')
    setExpenses(selectedEntry.expenses > 0 ? selectedEntry.expenses.toString() : '')
  }, [selectedEntry])

  const handleWeekChange = (delta: number) => {
    const selectedDate = parseDateKey(date)
    const visibleWeekStart = parseDateKey(visibleWeekStartKey)
    const dayOffset = Math.round(
      (selectedDate.getTime() - visibleWeekStart.getTime()) / (24 * 60 * 60 * 1000),
    )
    const nextWeekStartKey = shiftDateKey(visibleWeekStartKey, delta * 7)
    const nextSelectedDateKey = shiftDateKey(nextWeekStartKey, Math.min(Math.max(dayOffset, 0), 6))
    syncSelectedDate(nextSelectedDateKey)
  }

  const handleMonthChange = (delta: number) => {
    const nextMonthKey = shiftMonth(visibleMonthKey, delta)
    syncSelectedDate(getDefaultDateForMonth(nextMonthKey, today))
  }

  const buildSelectedWorkedEntry = () => {
    const resolvedHours = parseNumber(hours)
    const resolvedInvoicedIncome =
      invoicedIncome.trim() === ''
        ? getCalculatedDefaultInvoiceAmount(hours, settings)
        : parseNumber(invoicedIncome)
    const resolvedPaidIncome = parseNumber(paidIncome)
    const resolvedExpenses = parseNumber(expenses)

    if (!date || resolvedHours <= 0) {
      setFormMessage('Enter a date and billed hours first.')
      return null
    }

    if (resolvedInvoicedIncome <= 0) {
      setFormMessage('Enter an invoice amount before saving.')
      return null
    }

    return {
      id: selectedEntry?.id ?? `entry-${date}-${Date.now()}`,
      date,
      dayStatus: 'worked' as const,
      hours: resolvedHours,
      invoicedIncome: Number(resolvedInvoicedIncome.toFixed(2)),
      paidIncome: Number(resolvedPaidIncome.toFixed(2)),
      expenses: Number(resolvedExpenses.toFixed(2)),
    }
  }

  const handleSaveAllEntries = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    let nextEntriesToSave = entries

    if (hasPendingSelectedDayChanges) {
      const nextEntry = buildSelectedWorkedEntry()

      if (!nextEntry) {
        return
      }

      nextEntriesToSave = [
        nextEntry,
        ...entries.filter((existingEntry) => existingEntry.date !== nextEntry.date),
      ]
    }

    onSaveEntries(nextEntriesToSave)
    setFormMessage('Saved daily reports.')
  }

  const handleMarkNoWork = () => {
    onUpsertEntry({
      id: selectedEntry?.id ?? `entry-${date}-no-work`,
      date,
      dayStatus: 'no_work' as const,
      hours: 0,
      invoicedIncome: 0,
      paidIncome: 0,
      expenses: 0,
    })
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setFormMessage('Marked as no work. Save daily reports to keep all changes.')
  }

  const handleRemoveNoWorkMark = () => {
    onRemoveEntryForDate(date)
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setFormMessage('No work mark removed. Save daily reports to keep all changes.')
  }

  return (
    <div className="space-y-4 pb-8">
      <section ref={formRef} className="rounded-[1.9rem] border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Log work entry</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Update each day you want here, then save all daily reports when you are ready.
        </p>

        <form className="mt-4 space-y-4" onSubmit={handleSaveAllEntries}>
          <div className="flex flex-wrap gap-2">
            {isSelectedDayMarkedNoWork ? (
              <button
                className="rounded-2xl bg-sky-100 px-4 py-3 text-sm font-semibold text-sky-800 transition hover:bg-sky-200"
                onClick={handleRemoveNoWorkMark}
                type="button"
              >
                Remove no work mark
              </button>
            ) : (
              <button
                className="rounded-2xl bg-sky-100 px-4 py-3 text-sm font-semibold text-sky-800 transition hover:bg-sky-200"
                onClick={handleMarkNoWork}
                type="button"
              >
                Mark as no work
              </button>
            )}
          </div>

          <div className="rounded-[1.55rem] bg-muted/75 p-3">
            <div className="flex items-center justify-between gap-3">
              <button
                aria-label="Show previous week"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-background text-foreground transition hover:bg-card"
                onClick={() => handleWeekChange(-1)}
                type="button"
              >
                ‹
              </button>
              <div className="text-center">
                <div className="text-sm font-semibold text-foreground">{getMonthLabel(visibleMonthDate)}</div>
              </div>
              <button
                aria-label="Show next week"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-background text-foreground transition hover:bg-card disabled:opacity-35"
                disabled={visibleWeekStartKey >= currentWeekStartKey}
                onClick={() => handleWeekChange(1)}
                type="button"
              >
                ›
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2">
              {visibleWeekDays.map((day) => {
                const isSelected = day.key === date
                const isToday = day.key === todayDateKey
                const isFilled = filledDateKeys.has(day.key)
                const isNoWork = noWorkDateKeys.has(day.key)
                const isMissing =
                  day.key.slice(0, 7) === currentMonthKey &&
                  !day.isWeekend &&
                  day.key < todayDateKey &&
                  !isFilled

                return (
                  <button
                    key={day.key}
                    className={`relative min-h-[4.4rem] rounded-[1rem] border px-1 py-2 text-center transition ${
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : day.isWeekend
                          ? 'border-transparent bg-slate-100 text-slate-500'
                          : isNoWork
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                          : isFilled
                            ? 'border-emerald-200 bg-emerald-100 text-emerald-900'
                            : isMissing
                              ? 'border-rose-200 bg-rose-50 text-rose-700'
                              : 'border-border bg-background text-foreground'
                    } ${isToday && !isSelected ? 'ring-2 ring-sky-300 ring-offset-1 ring-offset-muted/75' : ''}`}
                    onClick={() => syncSelectedDate(day.key)}
                    type="button"
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] opacity-75">
                      {getCompactDayLabel(day.date)}
                    </span>
                    <span className="mt-2 block text-lg font-semibold">{day.date.getDate()}</span>
                    {isFilled && !isSelected ? (
                      <span
                        className={`absolute bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${
                          isNoWork ? 'bg-sky-500' : 'bg-emerald-600'
                        }`}
                      />
                    ) : null}
                    {isMissing && !isSelected ? (
                      <span className="absolute bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-rose-500" />
                    ) : null}
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">
                Selected: {formatDate(parseDateKey(date))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-full bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-card"
                  onClick={resetToCurrentDayAndWeek}
                  type="button"
                >
                  Today
                </button>
                <button
                  className="rounded-full bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-card"
                  onClick={() => setIsMonthExpanded((currentValue) => !currentValue)}
                  type="button"
                >
                  {isMonthExpanded ? 'Hide month' : 'Show month'}
                </button>
              </div>
            </div>

            {isMonthExpanded ? (
              <div className="mt-4 rounded-[1.3rem] bg-background/80 p-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    aria-label="Show previous month"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition hover:bg-muted/80"
                    onClick={() => handleMonthChange(-1)}
                    type="button"
                  >
                    ‹
                  </button>
                  <div className="text-sm font-semibold text-foreground">{getMonthLabel(visibleMonthDate)}</div>
                  <button
                    aria-label="Show next month"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition hover:bg-muted/80 disabled:opacity-35"
                    disabled={visibleMonthKey >= currentMonthKey}
                    onClick={() => handleMonthChange(1)}
                    type="button"
                  >
                    ›
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {calendarRows.map((weekRow, rowIndex) => (
                    <div key={`${visibleMonthKey}-week-${rowIndex}`} className="grid grid-cols-7 gap-2">
                      {weekRow.map((day) => {
                        const isSelected = day.key === date
                        const isToday = day.key === todayDateKey
                        const isFilled = filledDateKeys.has(day.key)
                        const isNoWork = noWorkDateKeys.has(day.key)
                        const isMissing =
                          day.key.slice(0, 7) === currentMonthKey &&
                          day.isCurrentMonth &&
                          !day.isWeekend &&
                          day.key < todayDateKey &&
                          !isFilled

                        return (
                          <button
                            key={day.key}
                            className={`relative min-h-[3.1rem] rounded-[0.95rem] border text-sm font-medium transition ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : !day.isCurrentMonth
                                  ? 'border-transparent bg-transparent text-muted-foreground/40'
                                  : day.isWeekend
                                    ? 'border-transparent bg-slate-100 text-slate-500'
                                    : isNoWork
                                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                                    : isFilled
                                      ? 'border-emerald-200 bg-emerald-100 text-emerald-900'
                                      : isMissing
                                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                                        : 'border-border bg-background text-foreground'
                            } ${isToday && !isSelected ? 'ring-2 ring-sky-300 ring-offset-1 ring-offset-background' : ''}`}
                            disabled={!day.isCurrentMonth}
                            onClick={() => syncSelectedDate(day.key, true)}
                            type="button"
                          >
                            <span className="block">{day.date.getDate()}</span>
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Billed hours</span>
            <input
              ref={hoursInputRef}
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedDayMarkedNoWork}
              type="number"
              min="0"
              step="0.25"
              placeholder={settings.defaultShiftHours?.toString() ?? ''}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Invoice amount</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedDayMarkedNoWork}
              type="number"
              min="0"
              step="0.01"
              placeholder={hasConfiguredInvoiceDefaults ? calculatedDefaultInvoiceAmount.toFixed(2) : ''}
              value={invoicedIncome}
              onChange={(event) => setInvoicedIncome(event.target.value)}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              {hasConfiguredInvoiceDefaults
                ? 'Leave empty to calculate the default from your hours and configuration.'
                : 'Enter the invoice amount manually until you finish base configuration.'}
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Paid income</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedDayMarkedNoWork}
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={paidIncome}
              onChange={(event) => setPaidIncome(event.target.value)}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              Use this only when money actually came in.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Expenses</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedDayMarkedNoWork}
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={expenses}
              onChange={(event) => setExpenses(event.target.value)}
            />
          </label>

          <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            {isSelectedDayMarkedNoWork ? (
              'This day is marked as no work. It counts as handled for completeness and is not treated as missing.'
            ) : hasConfiguredInvoiceDefaults ? (
              <>
                Default invoice amount right now is{' '}
                <span className="font-medium text-foreground">
                  {formatCurrencyPrecise(calculatedDefaultInvoiceAmount)}
                </span>
                . It scales from billed hours using your configured shift income and shift hours.
              </>
            ) : (
              'Finish base configuration if you want the app to suggest invoice amounts automatically.'
            )}
          </div>

          <button
            className="w-full rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-95"
            type="submit"
          >
            Save daily reports
          </button>

          {formMessage ? <p className="text-sm text-muted-foreground">{formMessage}</p> : null}
          {hasUnsavedChanges ? (
            <p className="text-sm font-medium text-amber-700">
              You have unsaved daily reports in this screen.
            </p>
          ) : null}
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Entries For {getMonthLabel(visibleMonthDate)}
          </h2>
          <span className="text-sm text-muted-foreground">{monthEntries.length} in view</span>
        </div>

        {monthEntries.length === 0 ? (
          <div className="rounded-[1.8rem] border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            No entries yet for {getMonthLabel(visibleMonthDate)}.
          </div>
        ) : (
          <div className="space-y-3">
            {monthEntries.map((entry) => {
              const entryDate = parseDateKey(entry.date)
              const profit = entry.invoicedIncome - entry.expenses

              return (
                <article
                  key={entry.id}
                  className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{formatDate(entryDate)}</p>
                      {entry.dayStatus === 'no_work' ? (
                        <p className="mt-1 text-sm font-medium text-sky-700">No work</p>
                      ) : (
                        <>
                          <p className="mt-1 text-sm text-muted-foreground">{formatHours(entry.hours)}</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Invoiced: {formatCurrencyPrecise(entry.invoicedIncome)}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Paid: {formatCurrencyPrecise(entry.paidIncome)}
                          </p>
                        </>
                      )}
                      {entry.dayStatus !== 'no_work' && entry.expenses > 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expenses: {formatCurrencyPrecise(entry.expenses)}
                        </p>
                      ) : null}
                    </div>

                    <div className="text-right">
                      {entry.dayStatus === 'no_work' ? (
                        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                          Handled
                        </span>
                      ) : (
                        <>
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Profit</p>
                          <p className="mt-2 text-lg font-semibold text-foreground">
                            {formatCurrencyPrecise(profit)}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
