'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { WarningModal } from '@/components/warning-modal'
import {
  clearUserReportDayFormDrafts,
  getUserReportDayFormDrafts,
  updateUserReportDayFormDrafts,
} from '@/lib/ui-preferences'
import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'
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
  fillMissingDayTargetDateKey?: string
  fillMissingDaysRequest?: number
  hasUnsavedChanges?: boolean
  monthlySummaries: MonthlySummary[]
  onDeleteSavedEntryImmediately: (dateKey: string) => void
  onRemoveEntryForDate: (dateKey: string) => void
  onRegisterNavigationHandlers?: (handlers: DailyLogNavigationHandlers | null) => void
  onSaveEntries: (nextEntries?: DailyEntry[]) => boolean | void
  onUnsavedDayInputDraftsChange?: (hasUnsavedDrafts: boolean) => void
  onUpsertEntry: (entry: DailyEntry) => void
  reportResetRequest?: number
  savedEntries: DailyEntry[]
  settings: Settings
  userId?: string
}

export interface DailyLogNavigationHandlers {
  discard: () => void
  save: () => boolean | void
}

interface CalendarDay {
  date: Date
  isCurrentMonth: boolean
  isWeekend: boolean
  key: string
}

type InvalidDailyFieldsState = {
  hours?: boolean
  invoicedIncome?: boolean
}

interface DailySoftWarning {
  body: string
  title: string
}

interface DailyValidationIssue {
  body: string
  title: string
}

interface DayInputDraft {
  expenses: string
  hours: string
  invoicedIncome: string
  paidIncome: string
}

type InvalidDailyFieldsByDate = Record<string, InvalidDailyFieldsState>
type DailyDraftSaveState =
  | {
      kind: 'expense_only'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        paidIncome: number
      }
    }
  | {
      invalidFields: InvalidDailyFieldsState
      kind: 'invalid'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        paidIncome: number
      }
    }
  | {
      kind: 'worked'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        paidIncome: number
      }
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

function getEntryDraft(entry: DailyEntry | undefined): DayInputDraft {
  if (!entry || entry.dayStatus === 'no_work' || entry.dayStatus === 'vacation') {
    return {
      expenses: '',
      hours: '',
      invoicedIncome: '',
      paidIncome: '',
    }
  }

  return {
    expenses: entry.expenses > 0 ? entry.expenses.toString() : '',
    hours: entry.hours > 0 ? entry.hours.toString() : '',
    invoicedIncome: entry.invoicedIncome > 0 ? entry.invoicedIncome.toString() : '',
    paidIncome: entry.paidIncome > 0 ? entry.paidIncome.toString() : '',
  }
}

function isDraftEmpty(draft: DayInputDraft) {
  return (
    draft.hours.trim() === '' &&
    draft.invoicedIncome.trim() === '' &&
    draft.paidIncome.trim() === '' &&
    draft.expenses.trim() === ''
  )
}

function getResolvedDraftInvoiceAmount(draft: DayInputDraft, settings: Settings) {
  if (draft.invoicedIncome.trim() !== '') {
    return parseNumber(draft.invoicedIncome)
  }

  const resolvedHours = parseNumber(draft.hours)
  const defaultShiftHours = settings.defaultShiftHours ?? 0
  const defaultShiftIncome = settings.defaultShiftIncome ?? 0

  if (resolvedHours > 0 && defaultShiftHours > 0 && defaultShiftIncome > 0) {
    return getCalculatedDefaultInvoiceAmount(draft.hours, settings)
  }

  return 0
}

function persistDayInputDrafts(userId: string, drafts: Record<string, DayInputDraft>) {
  if (Object.keys(drafts).length === 0) {
    clearUserReportDayFormDrafts(userId)
    return
  }

  updateUserReportDayFormDrafts(userId, drafts)
}

function getNextDayInputDrafts(
  currentValue: Record<string, DayInputDraft>,
  dateKey: string,
  selectedEntry: DailyEntry | undefined,
  field: keyof DayInputDraft,
  value: string,
) {
  const existingDraft = currentValue[dateKey] ?? getEntryDraft(selectedEntry)
  const nextDraft = {
    ...existingDraft,
    [field]: value,
  }

  if (isDraftEmpty(nextDraft) && !selectedEntry) {
    const nextValue = { ...currentValue }
    delete nextValue[dateKey]
    return nextValue
  }

  return {
    ...currentValue,
    [dateKey]: nextDraft,
  }
}

function hasMeaningfulDayInputDrafts(
  drafts: Record<string, DayInputDraft>,
  entries: DailyEntry[],
) {
  return Object.entries(drafts).some(([dateKey, draft]) => {
    const entryDraft = getEntryDraft(entries.find((entry) => entry.date === dateKey))

    return (
      draft.hours !== entryDraft.hours ||
      draft.invoicedIncome !== entryDraft.invoicedIncome ||
      draft.paidIncome !== entryDraft.paidIncome ||
      draft.expenses !== entryDraft.expenses
    )
  })
}

function getDailyDraftSaveState(draft: DayInputDraft, settings: Settings): DailyDraftSaveState {
  const values = {
    expenses: parseNumber(draft.expenses),
    hours: parseNumber(draft.hours),
    invoicedIncome: getResolvedDraftInvoiceAmount(draft, settings),
    paidIncome: parseNumber(draft.paidIncome),
  }

  const hasAnyValue =
    values.hours > 0 ||
    values.invoicedIncome > 0 ||
    values.paidIncome > 0 ||
    values.expenses > 0

  if (!hasAnyValue) {
    return {
      kind: 'invalid',
      invalidFields: {
        hours: true,
        invoicedIncome: true,
      },
      values,
    }
  }

  const isExpenseOnlyDay =
    values.expenses > 0 &&
    values.hours <= 0 &&
    values.invoicedIncome <= 0 &&
    values.paidIncome <= 0

  if (isExpenseOnlyDay) {
    return {
      kind: 'expense_only',
      values,
    }
  }

  if (values.hours > 0 && values.invoicedIncome > 0) {
    return {
      kind: 'worked',
      values,
    }
  }

  return {
    kind: 'invalid',
    invalidFields: {
      hours: values.hours <= 0,
      invoicedIncome: values.invoicedIncome <= 0,
    },
    values,
  }
}

export function DailyLog({
  entries,
  fillMissingDayTargetDateKey,
  fillMissingDaysRequest = 0,
  hasUnsavedChanges = false,
  monthlySummaries,
  onDeleteSavedEntryImmediately,
  onRemoveEntryForDate,
  onRegisterNavigationHandlers,
  onSaveEntries,
  onUnsavedDayInputDraftsChange,
  onUpsertEntry,
  reportResetRequest = 0,
  savedEntries,
  settings,
  userId,
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
  const [dayInputDrafts, setDayInputDrafts] = useState<Record<string, DayInputDraft>>({})
  const [formMessage, setFormMessage] = useState('')
  const [invalidFieldsByDate, setInvalidFieldsByDate] = useState<InvalidDailyFieldsByDate>({})
  const [validationIssue, setValidationIssue] = useState<DailyValidationIssue | null>(null)
  const [softWarning, setSoftWarning] = useState<DailySoftWarning | null>(null)
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<DailyEntry | null>(null)
  const [loadedDayInputDraftsUserId, setLoadedDayInputDraftsUserId] = useState<string | null>(null)
  const formRef = useRef<HTMLElement | null>(null)
  const hoursInputRef = useRef<HTMLInputElement | null>(null)
  const dayInputDraftsRef = useRef<Record<string, DayInputDraft>>({})
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
  const vacationDateKeys = useMemo(
    () => new Set(entries.filter((entry) => entry.dayStatus === 'vacation').map((entry) => entry.date)),
    [entries],
  )
  const employmentMonthKeys = useMemo(
    () =>
      new Set(
        monthlySummaries
          .filter((summary) => summary.monthType === 'employment')
          .map((summary) => summary.monthKey),
      ),
    [monthlySummaries],
  )
  const savedEntryDateKeys = useMemo(
    () => new Set(savedEntries.map((entry) => entry.date)),
    [savedEntries],
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
  const selectedDraft = dayInputDrafts[date]
  const isSelectedDayMarkedNoWork = selectedEntry?.dayStatus === 'no_work'
  const isSelectedDayMarkedVacation = selectedEntry?.dayStatus === 'vacation'
  const isSelectedMonthEmployment = employmentMonthKeys.has(date.slice(0, 7))
  const selectedEntryDraft = getEntryDraft(selectedEntry)
  const selectedWorkedHours = selectedEntryDraft.hours
  const selectedWorkedInvoicedIncome = selectedEntryDraft.invoicedIncome
  const selectedWorkedPaidIncome = selectedEntryDraft.paidIncome
  const selectedWorkedExpenses = selectedEntryDraft.expenses
  const currentInvalidFields = invalidFieldsByDate[date] ?? {}
  const hasPendingSelectedDayChanges =
    !isSelectedDayMarkedNoWork &&
    !isSelectedDayMarkedVacation &&
    !isSelectedMonthEmployment &&
    !!selectedDraft &&
    (hours !== selectedWorkedHours ||
      invoicedIncome !== selectedWorkedInvoicedIncome ||
      paidIncome !== selectedWorkedPaidIncome ||
      expenses !== selectedWorkedExpenses)

  const resetToCurrentDayAndWeek = () => {
    syncSelectedDate(todayDateKey, true)
  }

  useEffect(() => {
    if (!userId) {
      dayInputDraftsRef.current = {}
      setDayInputDrafts({})
      setLoadedDayInputDraftsUserId(null)
      return
    }

    const savedDrafts = getUserReportDayFormDrafts(userId)
    dayInputDraftsRef.current = savedDrafts
    setDayInputDrafts(savedDrafts)
    setLoadedDayInputDraftsUserId(userId)
  }, [userId])

  useEffect(() => {
    dayInputDraftsRef.current = dayInputDrafts

    if (!userId || loadedDayInputDraftsUserId !== userId) {
      return
    }

    persistDayInputDrafts(userId, dayInputDrafts)
  }, [dayInputDrafts, loadedDayInputDraftsUserId, userId])

  useEffect(() => {
    onUnsavedDayInputDraftsChange?.(hasMeaningfulDayInputDrafts(dayInputDrafts, entries))
  }, [dayInputDrafts, entries, onUnsavedDayInputDraftsChange])

  useEffect(() => {
    return () => {
      onUnsavedDayInputDraftsChange?.(false)
    }
  }, [onUnsavedDayInputDraftsChange])

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
      fillMissingDayTargetDateKey ??
      getEarliestMissingCurrentMonthWeekday(entries, todayDate) ??
      todayDateKey
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
  }, [entries, fillMissingDayTargetDateKey, fillMissingDaysRequest, todayDateKey])

  useEffect(() => {
    const nextDraft = selectedDraft ?? getEntryDraft(selectedEntry)

    setHours(nextDraft.hours)
    setInvoicedIncome(nextDraft.invoicedIncome)
    setPaidIncome(nextDraft.paidIncome)
    setExpenses(nextDraft.expenses)
  }, [date, selectedDraft, selectedEntry])

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

  const updateDraftField = (
    field: keyof DayInputDraft,
    value: string,
    invalidField?: keyof InvalidDailyFieldsState,
  ) => {
    if (isSelectedMonthEmployment) {
      setValidationIssue({
        title: 'Non-business month',
        body: 'This month is marked as a non-business month. Adding daily business entries here would make your calculations inaccurate.',
      })
      return
    }

    const nextValue = getNextDayInputDrafts(
      dayInputDraftsRef.current,
      date,
      selectedEntry,
      field,
      value,
    )

    dayInputDraftsRef.current = nextValue
    setDayInputDrafts(nextValue)

    if (userId) {
      persistDayInputDrafts(userId, nextValue)
    }

    onUnsavedDayInputDraftsChange?.(hasMeaningfulDayInputDrafts(nextValue, entries))

    if (!invalidField || !currentInvalidFields[invalidField]) {
      return
    }

    setInvalidFieldsByDate((currentValue) => ({
      ...currentValue,
      [date]: {
        ...currentValue[date],
        [invalidField]: false,
      },
    }))
  }

  function getDailyValidationIssue(nextInvalidFieldsByDate: InvalidDailyFieldsByDate): DailyValidationIssue {
    const invalidDates = Object.entries(nextInvalidFieldsByDate)

    if (invalidDates.length === 1) {
      const [invalidDateKey, invalidFields] = invalidDates[0]
      const missingFields = [
        invalidFields.hours ? 'billed hours' : null,
        invalidFields.invoicedIncome ? 'invoice amount' : null,
      ].filter((field): field is string => field !== null)

      return {
        title: missingFields.length === 1 ? 'Complete required field' : 'Complete required fields',
        body: `For ${formatDate(parseDateKey(invalidDateKey))}, add ${missingFields.join(' and ')} before saving this worked day. Expense-only days are allowed, but worked days still need both billed hours and invoice amount.`,
      }
    }

    const invalidSummary = invalidDates
      .map(([invalidDateKey, invalidFields]) => {
        const missingFields = [
          invalidFields.hours ? 'billed hours' : null,
          invalidFields.invoicedIncome ? 'invoice amount' : null,
        ].filter((field): field is string => field !== null)

        return `${formatDate(parseDateKey(invalidDateKey))}: ${missingFields.join(' and ')}`
      })
      .join('\n')

    return {
      title: 'Complete required fields',
      body: `Some worked days are still missing required fields. Expense-only days are allowed, but worked days still need both billed hours and invoice amount.\n\n${invalidSummary}`,
    }
  }

  const handleSaveAllEntries = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    let nextEntriesToSave = entries
    const nextInvalidFieldsByDate: InvalidDailyFieldsByDate = {}
    const softWarnings: DailySoftWarning[] = []
    const employmentDraftDateKey = Object.keys(dayInputDrafts).find((draftDateKey) =>
      employmentMonthKeys.has(draftDateKey.slice(0, 7)),
    )

    if (employmentDraftDateKey) {
      setValidationIssue({
        title: 'Non-business month',
        body: 'This month is marked as a non-business month. Adding daily business entries here would make your calculations inaccurate.',
      })
      syncSelectedDate(employmentDraftDateKey, true)
      return false
    }

    Object.entries(dayInputDrafts).forEach(([draftDateKey, draft]) => {
      const draftSaveState = getDailyDraftSaveState(draft, settings)

      if (draftSaveState.kind === 'invalid') {
        nextInvalidFieldsByDate[draftDateKey] = draftSaveState.invalidFields
        return
      }

      const {
        expenses: resolvedExpenses,
        hours: resolvedHours,
        invoicedIncome: resolvedInvoicedIncome,
        paidIncome: resolvedPaidIncome,
      } = draftSaveState.values

      if (draftSaveState.kind === 'expense_only') {
        softWarnings.push({
          title: 'Expense-only day saved',
          body: formatDate(parseDateKey(draftDateKey)),
        })
      }

      const existingEntry = entries.find((entry) => entry.date === draftDateKey)
      if (
        (existingEntry?.dayStatus === 'no_work' || existingEntry?.dayStatus === 'vacation') &&
        isDraftEmpty(draft)
      ) {
        return
      }
      const nextEntry: DailyEntry = {
        id: existingEntry?.id ?? `entry-${draftDateKey}-${Date.now()}`,
        date: draftDateKey,
        dayStatus: 'worked',
        hours: resolvedHours,
        invoicedIncome: Number(resolvedInvoicedIncome.toFixed(2)),
        paidIncome: Number(resolvedPaidIncome.toFixed(2)),
        expenses: Number(resolvedExpenses.toFixed(2)),
      }

      nextEntriesToSave = [
        nextEntry,
        ...nextEntriesToSave.filter((existingItem) => existingItem.date !== draftDateKey),
      ]
    })

    if (Object.keys(nextInvalidFieldsByDate).length > 0) {
      setInvalidFieldsByDate(nextInvalidFieldsByDate)
      setValidationIssue(getDailyValidationIssue(nextInvalidFieldsByDate))
      setFormMessage('Complete the highlighted required fields before saving.')
      const [firstInvalidDateKey] = Object.keys(nextInvalidFieldsByDate)
      syncSelectedDate(firstInvalidDateKey, true)
      return false
    }

    setInvalidFieldsByDate({})

    const didSaveContinue = onSaveEntries(nextEntriesToSave)

    if (didSaveContinue !== false) {
      setDayInputDrafts({})
      dayInputDraftsRef.current = {}
      onUnsavedDayInputDraftsChange?.(false)
      if (softWarnings.length > 0) {
        const warningDates = softWarnings.map((warning) => warning.body)
        const combinedBody =
          warningDates.length === 1
            ? `${warningDates[0]} was saved with expenses only. Add hours or income later if this should count as a worked day.`
            : `These dates were saved with expenses only:\n\n${warningDates.join('\n')}\n\nAdd hours or income later if any of them should count as worked days.`

        setSoftWarning({
          title: warningDates.length === 1 ? 'Expense-only day saved' : 'Expense-only days saved',
          body: combinedBody,
        })
        setFormMessage('Saved daily reports with a small warning.')
      } else {
        setFormMessage('Saved daily reports.')
      }
    }

    return didSaveContinue !== false
  }

  const discardDayInputDrafts = () => {
    const selectedEntryDraft = getEntryDraft(selectedEntry)

    dayInputDraftsRef.current = {}
    setDayInputDrafts({})
    setInvalidFieldsByDate({})
    setHours(selectedEntryDraft.hours)
    setInvoicedIncome(selectedEntryDraft.invoicedIncome)
    setPaidIncome(selectedEntryDraft.paidIncome)
    setExpenses(selectedEntryDraft.expenses)
    onUnsavedDayInputDraftsChange?.(false)

    if (userId) {
      clearUserReportDayFormDrafts(userId)
    }
  }

  useEffect(() => {
    onRegisterNavigationHandlers?.({
      discard: discardDayInputDrafts,
      save: handleSaveAllEntries,
    })

    return () => {
      onRegisterNavigationHandlers?.(null)
    }
  })

  const handleMarkNoWork = () => {
    if (isSelectedMonthEmployment) {
      setValidationIssue({
        title: 'Non-business month',
        body: 'This month is marked as a non-business month. Adding daily business entries here would make your calculations inaccurate.',
      })
      return
    }

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
    setDayInputDrafts((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setInvalidFieldsByDate((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setFormMessage('Marked as no work. Save daily reports to keep all changes.')
  }

  const handleRemoveNoWorkMark = () => {
    onRemoveEntryForDate(date)
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setDayInputDrafts((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setInvalidFieldsByDate((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setFormMessage('No work mark removed. Save daily reports to keep all changes.')
  }

  const handleMarkVacation = () => {
    if (isSelectedMonthEmployment) {
      setValidationIssue({
        title: 'Non-business month',
        body: 'This month is marked as a non-business month. Adding daily business entries here would make your calculations inaccurate.',
      })
      return
    }

    onUpsertEntry({
      id: selectedEntry?.id ?? `entry-${date}-vacation`,
      date,
      dayStatus: 'vacation' as const,
      hours: 0,
      invoicedIncome: 0,
      paidIncome: 0,
      expenses: 0,
    })
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setDayInputDrafts((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setInvalidFieldsByDate((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setFormMessage('Marked as vacation. Save daily reports to keep all changes.')
  }

  const handleRemoveVacationMark = () => {
    onRemoveEntryForDate(date)
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setDayInputDrafts((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setInvalidFieldsByDate((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[date]
      return nextValue
    })
    setFormMessage('Vacation mark removed. Save daily reports to keep all changes.')
  }

  const handleRequestDeleteEntry = (entry: DailyEntry) => {
    setPendingDeleteEntry(entry)
  }

  const handleConfirmDeleteEntry = () => {
    if (!pendingDeleteEntry) {
      return
    }

    const deletedDateKey = pendingDeleteEntry.date
    const isSavedEntry = savedEntryDateKeys.has(deletedDateKey)

    syncSelectedDate(deletedDateKey)
    if (isSavedEntry) {
      onDeleteSavedEntryImmediately(deletedDateKey)
    } else {
      onRemoveEntryForDate(deletedDateKey)
    }
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setDayInputDrafts((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[deletedDateKey]
      return nextValue
    })
    setInvalidFieldsByDate((currentValue) => {
      const nextValue = { ...currentValue }
      delete nextValue[deletedDateKey]
      return nextValue
    })
    setFormMessage(
      isSavedEntry
        ? 'Entry deleted.'
        : hasUnsavedChanges
          ? 'Entry removed from the current draft. Save daily reports to keep all changes.'
          : 'Entry removed from the current draft.',
    )
    setPendingDeleteEntry(null)
  }

  return (
    <>
      <WarningModal
        body={validationIssue?.body ?? ''}
        isOpen={validationIssue !== null}
        onClose={() => setValidationIssue(null)}
        primaryActionLabel="Close"
        title={validationIssue?.title ?? ''}
      />
      <WarningModal
        body={softWarning?.body ?? ''}
        isOpen={softWarning !== null}
        onClose={() => setSoftWarning(null)}
        primaryActionLabel="Close"
        title={softWarning?.title ?? ''}
      />
      <WarningModal
        body={
          pendingDeleteEntry && savedEntryDateKeys.has(pendingDeleteEntry.date)
            ? 'This will delete that saved daily entry right away. Any other unsaved report changes will stay in your current draft.'
            : 'This removes the current day entry from your report draft. Save daily reports afterward if you want to keep the deletion.'
        }
        isOpen={pendingDeleteEntry !== null}
        onClose={() => setPendingDeleteEntry(null)}
        onPrimaryAction={handleConfirmDeleteEntry}
        onSecondaryAction={() => setPendingDeleteEntry(null)}
        primaryActionLabel={
          pendingDeleteEntry && savedEntryDateKeys.has(pendingDeleteEntry.date)
            ? 'Delete entry now'
            : 'Delete entry'
        }
        secondaryActionLabel="Cancel"
        title="Delete daily entry?"
      />

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
            ) : isSelectedDayMarkedVacation ? (
              <button
                className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-200"
                onClick={handleRemoveVacationMark}
                type="button"
              >
                Remove vacation mark
              </button>
            ) : (
              <>
                <button
                  className="rounded-2xl bg-sky-100 px-4 py-3 text-sm font-semibold text-sky-800 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSelectedMonthEmployment}
                  onClick={handleMarkNoWork}
                  type="button"
                >
                  Mark as no work
                </button>
                <button
                  className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSelectedMonthEmployment}
                  onClick={handleMarkVacation}
                  type="button"
                >
                  Mark as vacation
                </button>
              </>
            )}
          </div>

          <div className="rounded-[1.55rem] bg-muted/75 p-3">
            {isMonthExpanded ? (
              <div className="rounded-[1.3rem] bg-background/80 p-3">
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
                        const isVacation = vacationDateKeys.has(day.key)
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
                                      : isVacation
                                        ? 'border-amber-200 bg-amber-50 text-amber-800'
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
            ) : (
              <>
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
                    const isVacation = vacationDateKeys.has(day.key)
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
                                : isVacation
                                  ? 'border-amber-200 bg-amber-50 text-amber-800'
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
                              isNoWork ? 'bg-sky-500' : isVacation ? 'bg-amber-500' : 'bg-emerald-600'
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
              </>
            )}

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

          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Billed hours</span>
            <input
              ref={hoursInputRef}
              className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition ${
                currentInvalidFields.hours
                  ? 'border-rose-300 bg-rose-50/50 focus:border-rose-500'
                  : 'border-border focus:border-primary'
              }`}
              disabled={isSelectedDayMarkedNoWork || isSelectedDayMarkedVacation || isSelectedMonthEmployment}
              type="number"
              min="0"
              step="0.25"
              placeholder={settings.defaultShiftHours?.toString() ?? ''}
              value={hours}
              onChange={(event) => {
                updateDraftField('hours', event.target.value, 'hours')
                setHours(event.target.value)
              }}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Invoice amount</span>
            <input
              className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition ${
                currentInvalidFields.invoicedIncome
                  ? 'border-rose-300 bg-rose-50/50 focus:border-rose-500'
                  : 'border-border focus:border-primary'
              }`}
              disabled={isSelectedDayMarkedNoWork || isSelectedDayMarkedVacation || isSelectedMonthEmployment}
              type="number"
              min="0"
              step="0.01"
              placeholder={hasConfiguredInvoiceDefaults ? calculatedDefaultInvoiceAmount.toFixed(2) : ''}
              value={invoicedIncome}
              onChange={(event) => {
                updateDraftField('invoicedIncome', event.target.value, 'invoicedIncome')
                setInvoicedIncome(event.target.value)
              }}
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
              disabled={isSelectedDayMarkedNoWork || isSelectedDayMarkedVacation || isSelectedMonthEmployment}
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={paidIncome}
              onChange={(event) => {
                updateDraftField('paidIncome', event.target.value)
                setPaidIncome(event.target.value)
              }}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              Use this only when money actually came in.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Expenses</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedDayMarkedNoWork || isSelectedDayMarkedVacation || isSelectedMonthEmployment}
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={expenses}
              onChange={(event) => {
                updateDraftField('expenses', event.target.value)
                setExpenses(event.target.value)
              }}
            />
          </label>

          <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            {isSelectedMonthEmployment ? (
              'This month is marked as an employment / pre-business month. Daily reports are disabled for this month so calculations stay accurate.'
            ) : isSelectedDayMarkedNoWork ? (
              'This day is marked as no work. It counts as handled for completeness and is not treated as missing.'
            ) : isSelectedDayMarkedVacation ? (
              'This day is marked as vacation. It counts as handled for completeness and is tracked separately from no-work days.'
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
                      ) : entry.dayStatus === 'vacation' ? (
                        <p className="mt-1 text-sm font-medium text-amber-700">Vacation</p>
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
                      {entry.dayStatus === 'worked' && entry.expenses > 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expenses: {formatCurrencyPrecise(entry.expenses)}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-3 text-right">
                      <button
                        aria-label={`Delete entry for ${formatDate(entryDate)}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => handleRequestDeleteEntry(entry)}
                        type="button"
                      >
                        <TrashIcon />
                      </button>
                      {entry.dayStatus === 'no_work' ? (
                        <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                          Handled
                        </span>
                      ) : entry.dayStatus === 'vacation' ? (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                          Vacation
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
    </>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M4.5 7.5h15M9.5 3.75h5l.6 1.5h3.15a.75.75 0 0 1 0 1.5H5.75a.75.75 0 0 1 0-1.5H8.9l.6-1.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M7.5 7.5v9a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5v-9M10 11v4.75M14 11v4.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}
