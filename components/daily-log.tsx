'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { WarningModal } from '@/components/warning-modal'
import {
  clearUserReportDayFormDrafts,
  getUserDailyLogSelectedDate,
  getUserReportDayFormDrafts,
  type ReportDayFormDraft,
  type ReportWorkItemDraft,
  updateUserDailyLogSelectedDate,
  updateUserReportDayFormDrafts,
} from '@/lib/ui-preferences'
import type { DailyEntry, MonthlySummary, Settings, WorkItem } from '@/lib/types'
import {
  getEarliestMissingReportWeekday,
  getEntryHours,
  getEntryInvoicedIncome,
  getCurrentMonthRange,
  getMissingFullReportMonthKeys,
  getMissingReportDateKeys,
  parseDateKey,
  parseMonthKey,
  toDateKey,
  toMonthKey,
} from '@/lib/calculations'
import { formatCurrencyPrecise, formatDate, formatHours, formatNumber } from '@/lib/formatters'

interface DailyLogProps {
  entries: DailyEntry[]
  fillMissingDayTargetDateKey?: string
  fillMissingDaysRequest?: number
  hasUnsavedChanges?: boolean
  monthlySummaries: MonthlySummary[]
  onDeleteSavedEntryImmediately: (dateKey: string) => void
  onBackfillMissingMonth?: (monthKey: string) => void
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
  workItems?: boolean
}

interface DailySoftWarning {
  body: string
  title: string
}

interface DailyValidationIssue {
  body: string
  title: string
}

type WorkItemDraft = ReportWorkItemDraft
type DayInputDraft = ReportDayFormDraft
type DayInputTextField = Exclude<keyof DayInputDraft, 'workItems'>

type InvalidDailyFieldsByDate = Record<string, InvalidDailyFieldsState>
type DailyDraftSaveState =
  | {
      kind: 'expense_only'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        paidIncome: number
        workItems?: WorkItem[]
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
        workItems?: WorkItem[]
      }
    }
  | {
      kind: 'worked'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        paidIncome: number
        workItems?: WorkItem[]
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

function sortWorkItemDrafts(workItems: WorkItemDraft[]) {
  return [...workItems].sort((left, right) => left.lineIndex - right.lineIndex)
}

function sortNewestLineIndexFirst<T extends { lineIndex: number }>(items: T[]) {
  return [...items].sort((left, right) => right.lineIndex - left.lineIndex)
}

function getEntryWorkItemDrafts(entry: DailyEntry | undefined): WorkItemDraft[] | undefined {
  if (
    !entry ||
    entry.dayStatus === 'no_work' ||
    entry.dayStatus === 'vacation' ||
    !entry.workItems ||
    entry.workItems.length === 0
  ) {
    return undefined
  }

  return sortWorkItemDrafts(
    entry.workItems.map((workItem, index) => ({
      id: workItem.id,
      projectName: workItem.projectName,
      hours: workItem.hours > 0 ? workItem.hours.toString() : '',
      hourlyRate:
        typeof workItem.hourlyRate === 'number' && workItem.hourlyRate > 0
          ? workItem.hourlyRate.toString()
          : '',
      invoicedIncome: workItem.invoicedIncome > 0 ? workItem.invoicedIncome.toString() : '',
      lineIndex: workItem.lineIndex ?? index,
    })),
  )
}

function isWorkItemDraftBlank(workItem: WorkItemDraft) {
  return (
    workItem.projectName.trim() === '' &&
    workItem.hours.trim() === '' &&
    workItem.hourlyRate.trim() === '' &&
    workItem.invoicedIncome.trim() === ''
  )
}

function hasWorkItemDraftRows(draft: DayInputDraft) {
  return Array.isArray(draft.workItems) && draft.workItems.length > 0
}

function getResolvedWorkItemInvoiceAmount(workItem: WorkItemDraft) {
  if (workItem.invoicedIncome.trim() !== '') {
    return parseNumber(workItem.invoicedIncome)
  }

  const resolvedHours = parseNumber(workItem.hours)
  const resolvedHourlyRate = parseNumber(workItem.hourlyRate)

  if (resolvedHours > 0 && resolvedHourlyRate > 0) {
    return resolvedHours * resolvedHourlyRate
  }

  return 0
}

function getWorkItemsDraftTotals(workItems: WorkItemDraft[]) {
  return workItems.reduce(
    (totals, workItem) => {
      if (isWorkItemDraftBlank(workItem)) {
        return totals
      }

      return {
        hours: totals.hours + parseNumber(workItem.hours),
        invoicedIncome: totals.invoicedIncome + getResolvedWorkItemInvoiceAmount(workItem),
      }
    },
    { hours: 0, invoicedIncome: 0 },
  )
}

function areWorkItemDraftsEqual(left?: WorkItemDraft[], right?: WorkItemDraft[]) {
  const sortedLeft = sortWorkItemDrafts(left ?? [])
  const sortedRight = sortWorkItemDrafts(right ?? [])

  if (sortedLeft.length !== sortedRight.length) {
    return false
  }

  return sortedLeft.every((leftItem, index) => {
    const rightItem = sortedRight[index]

    return (
      leftItem.id === rightItem.id &&
      leftItem.projectName === rightItem.projectName &&
      leftItem.hours === rightItem.hours &&
      leftItem.hourlyRate === rightItem.hourlyRate &&
      leftItem.invoicedIncome === rightItem.invoicedIncome &&
      leftItem.lineIndex === rightItem.lineIndex
    )
  })
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
  if (!entry) {
    return {
      expenses: '',
      hours: '',
      invoicedIncome: '',
      paidIncome: '',
    }
  }

  if (entry.dayStatus === 'no_work' || entry.dayStatus === 'vacation') {
    return {
      expenses: entry.expenses > 0 ? entry.expenses.toString() : '',
      hours: '',
      invoicedIncome: '',
      paidIncome: '',
    }
  }

  const workItems = getEntryWorkItemDrafts(entry)

  return {
    expenses: entry.expenses > 0 ? entry.expenses.toString() : '',
    hours: getEntryHours(entry) > 0 ? getEntryHours(entry).toString() : '',
    invoicedIncome:
      getEntryInvoicedIncome(entry) > 0 ? getEntryInvoicedIncome(entry).toString() : '',
    paidIncome: entry.paidIncome > 0 ? entry.paidIncome.toString() : '',
    ...(workItems && workItems.length > 0 ? { workItems } : {}),
  }
}

function isDraftEmpty(draft: DayInputDraft) {
  if (hasWorkItemDraftRows(draft)) {
    return false
  }

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
  field: DayInputTextField,
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
      draft.expenses !== entryDraft.expenses ||
      !areWorkItemDraftsEqual(draft.workItems, entryDraft.workItems)
    )
  })
}

function getHandledReportDateKeys(
  entries: DailyEntry[],
  drafts: Record<string, DayInputDraft>,
) {
  const handledDateKeys = new Set(entries.map((entry) => entry.date))

  Object.entries(drafts).forEach(([dateKey, draft]) => {
    if (!isDraftEmpty(draft)) {
      handledDateKeys.add(dateKey)
    }
  })

  return handledDateKeys
}

function getFirstMissingWeekdayInWeekForReport(
  weekStartKey: string,
  missingReportDateKeys: Set<string>,
) {
  const weekStart = parseDateKey(weekStartKey)

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const cursor = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + dayOffset,
    )
    const dateKey = toDateKey(cursor)

    if (missingReportDateKeys.has(dateKey)) {
      return dateKey
    }
  }

  return undefined
}

function getDailyDraftSaveState(draft: DayInputDraft, settings: Settings): DailyDraftSaveState {
  const baseValues = {
    expenses: parseNumber(draft.expenses),
    paidIncome: parseNumber(draft.paidIncome),
  }

  if (hasWorkItemDraftRows(draft)) {
    const resolvedWorkItems: WorkItem[] = []
    let hasInvalidWorkItem = false

    sortWorkItemDrafts(draft.workItems ?? []).forEach((workItem, index) => {
      if (isWorkItemDraftBlank(workItem)) {
        return
      }

      const resolvedHours = parseNumber(workItem.hours)
      const resolvedHourlyRate = parseNumber(workItem.hourlyRate)
      const resolvedInvoicedIncome = getResolvedWorkItemInvoiceAmount(workItem)

      if (resolvedHours <= 0 || resolvedInvoicedIncome <= 0) {
        hasInvalidWorkItem = true
        return
      }

      resolvedWorkItems.push({
        id: workItem.id,
        projectName: workItem.projectName.trim(),
        hours: Number(resolvedHours.toFixed(2)),
        hourlyRate: resolvedHourlyRate > 0 ? Number(resolvedHourlyRate.toFixed(2)) : null,
        invoicedIncome: Number(resolvedInvoicedIncome.toFixed(2)),
        lineIndex: workItem.lineIndex ?? index,
      })
    })

    const workItemTotals = resolvedWorkItems.reduce(
      (totals, workItem) => ({
        hours: totals.hours + workItem.hours,
        invoicedIncome: totals.invoicedIncome + workItem.invoicedIncome,
      }),
      { hours: 0, invoicedIncome: 0 },
    )

    const values = {
      ...baseValues,
      hours: Number(workItemTotals.hours.toFixed(2)),
      invoicedIncome: Number(workItemTotals.invoicedIncome.toFixed(2)),
      workItems: resolvedWorkItems,
    }

    if (hasInvalidWorkItem || resolvedWorkItems.length === 0) {
      return {
        kind: 'invalid',
        invalidFields: {
          workItems: true,
        },
        values,
      }
    }

    return {
      kind: 'worked',
      values,
    }
  }

  const values = {
    ...baseValues,
    hours: parseNumber(draft.hours),
    invoicedIncome: getResolvedDraftInvoiceAmount(draft, settings),
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
  onBackfillMissingMonth,
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
  const [saveToastMessage, setSaveToastMessage] = useState('')
  const [saveToastVersion, setSaveToastVersion] = useState(0)
  const [entryEditFocusRequest, setEntryEditFocusRequest] = useState(0)
  const [invalidFieldsByDate, setInvalidFieldsByDate] = useState<InvalidDailyFieldsByDate>({})
  const [validationIssue, setValidationIssue] = useState<DailyValidationIssue | null>(null)
  const [softWarning, setSoftWarning] = useState<DailySoftWarning | null>(null)
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<DailyEntry | null>(null)
  const [loadedDayInputDraftsUserId, setLoadedDayInputDraftsUserId] = useState<string | null>(null)
  const formRef = useRef<HTMLElement | null>(null)
  const hoursInputRef = useRef<HTMLInputElement | null>(null)
  const statusActionButtonRef = useRef<HTMLButtonElement | null>(null)
  const projectNameInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const pendingProjectRowFocusLineIndexRef = useRef<number | null>(null)
  const pendingEntryEditFocusDateKeyRef = useRef<string | null>(null)
  const dayInputDraftsRef = useRef<Record<string, DayInputDraft>>({})
  const handledFillMissingDaysRequestRef = useRef(0)
  const hasRestoredSelectedDateRef = useRef(false)
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
  const handledReportDateKeys = useMemo(
    () => getHandledReportDateKeys(entries, dayInputDrafts),
    [dayInputDrafts, entries],
  )
  const missingReportDateKeys = useMemo(
    () =>
      new Set(
        getMissingReportDateKeys(
          entries,
          monthlySummaries,
          parseDateKey(todayDateKey),
          handledReportDateKeys,
        ),
      ),
    [entries, handledReportDateKeys, monthlySummaries, todayDateKey],
  )
  const missingFullReportMonthKeys = useMemo(
    () =>
      new Set(
        getMissingFullReportMonthKeys(
          entries,
          monthlySummaries,
          parseDateKey(todayDateKey),
          handledReportDateKeys,
        ),
      ),
    [entries, handledReportDateKeys, monthlySummaries, todayDateKey],
  )
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
  const configuredHourlyRate = hasConfiguredInvoiceDefaults
    ? (settings.defaultShiftIncome ?? 0) / (settings.defaultShiftHours ?? 1)
    : 0
  const visibleFullMissingMonthKey = missingFullReportMonthKeys.has(visibleMonthKey)
    ? visibleMonthKey
    : null

  const syncSelectedDate = (nextDateKey: string, collapseMonth = false) => {
    const nextDate = parseDateKey(nextDateKey)
    setDate(nextDateKey)
    setVisibleWeekStartKey(toDateKey(getWeekStart(nextDate)))
    setVisibleMonthKey(toMonthKey(nextDate))
    if (userId && loadedDayInputDraftsUserId === userId) {
      updateUserDailyLogSelectedDate(userId, nextDateKey)
    }
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
  const currentDraft = selectedDraft ?? selectedEntryDraft
  const currentWorkItems = currentDraft.workItems ?? []
  const displayedCurrentWorkItems = sortNewestLineIndexFirst(currentWorkItems)
  const isWorkItemMode = currentWorkItems.length > 0
  const workItemDraftTotals = getWorkItemsDraftTotals(currentWorkItems)
  const flatDraftInvoiceAmount = getResolvedDraftInvoiceAmount(
    {
      expenses,
      hours,
      invoicedIncome,
      paidIncome,
    },
    settings,
  )
  const suggestedPaidIncome = isWorkItemMode ? workItemDraftTotals.invoicedIncome : flatDraftInvoiceAmount
  const paidIncomePlaceholder = suggestedPaidIncome > 0 ? suggestedPaidIncome.toFixed(2) : '0'
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
      expenses !== selectedWorkedExpenses ||
      !areWorkItemDraftsEqual(selectedDraft.workItems, selectedEntryDraft.workItems))

  const resetToCurrentDayAndWeek = () => {
    syncSelectedDate(todayDateKey, true)
  }

  const getPreferredReportDateKey = () =>
    getEarliestMissingReportWeekday(
      entries,
      monthlySummaries,
      parseDateKey(todayDateKey),
      getHandledReportDateKeys(entries, dayInputDraftsRef.current),
    ) ?? todayDateKey

  const resetToPreferredReportDayAndWeek = () => {
    syncSelectedDate(getPreferredReportDateKey(), true)
  }

  useEffect(() => {
    if (!userId) {
      dayInputDraftsRef.current = {}
      setDayInputDrafts({})
      setLoadedDayInputDraftsUserId(null)
      hasRestoredSelectedDateRef.current = false
      return
    }

    const savedDrafts = getUserReportDayFormDrafts(userId)
    dayInputDraftsRef.current = savedDrafts
    setDayInputDrafts(savedDrafts)
    setLoadedDayInputDraftsUserId(userId)
    hasRestoredSelectedDateRef.current = false
  }, [userId])

  useEffect(() => {
    dayInputDraftsRef.current = dayInputDrafts

    if (!userId || loadedDayInputDraftsUserId !== userId) {
      return
    }

    persistDayInputDrafts(userId, dayInputDrafts)
  }, [dayInputDrafts, loadedDayInputDraftsUserId, userId])

  useEffect(() => {
    if (
      !userId ||
      loadedDayInputDraftsUserId !== userId ||
      hasRestoredSelectedDateRef.current
    ) {
      return
    }

    hasRestoredSelectedDateRef.current = true
    const restoredDateKey =
      getUserDailyLogSelectedDate(userId) ??
      getEarliestMissingReportWeekday(
        entries,
        monthlySummaries,
        parseDateKey(todayDateKey),
        getHandledReportDateKeys(entries, dayInputDraftsRef.current),
      ) ??
      todayDateKey

    syncSelectedDate(restoredDateKey, true)
  }, [entries, loadedDayInputDraftsUserId, monthlySummaries, todayDateKey, userId])

  useEffect(() => {
    onUnsavedDayInputDraftsChange?.(hasMeaningfulDayInputDrafts(dayInputDrafts, entries))
  }, [dayInputDrafts, entries, onUnsavedDayInputDraftsChange])

  useEffect(() => {
    return () => {
      onUnsavedDayInputDraftsChange?.(false)
    }
  }, [onUnsavedDayInputDraftsChange])

  useEffect(() => {
    if (!saveToastMessage) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSaveToastMessage('')
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [saveToastMessage, saveToastVersion])

  useEffect(() => {
    if (reportResetRequest <= 0) {
      return
    }

    resetToPreferredReportDayAndWeek()
  }, [reportResetRequest, todayDateKey])

  useEffect(() => {
    if (
      fillMissingDaysRequest <= 0 ||
      handledFillMissingDaysRequestRef.current === fillMissingDaysRequest
    ) {
      return
    }

    handledFillMissingDaysRequestRef.current = fillMissingDaysRequest

    const todayDate = parseDateKey(todayDateKey)
    const targetDateKey =
      fillMissingDayTargetDateKey ??
      getEarliestMissingReportWeekday(
        entries,
        monthlySummaries,
        todayDate,
        getHandledReportDateKeys(entries, dayInputDraftsRef.current),
      ) ??
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
  }, [entries, fillMissingDayTargetDateKey, fillMissingDaysRequest, monthlySummaries, todayDateKey])

  useEffect(() => {
    const nextDraft = selectedDraft ?? getEntryDraft(selectedEntry)

    setHours(nextDraft.hours)
    setInvoicedIncome(nextDraft.invoicedIncome)
    setPaidIncome(nextDraft.paidIncome)
    setExpenses(nextDraft.expenses)
  }, [date, selectedDraft, selectedEntry])

  useEffect(() => {
    const lineIndex = pendingProjectRowFocusLineIndexRef.current

    if (lineIndex === null) {
      return
    }

    const input = projectNameInputRefs.current[lineIndex]

    if (!input) {
      return
    }

    input.focus()
    pendingProjectRowFocusLineIndexRef.current = null
  }, [currentWorkItems])

  useEffect(() => {
    if (pendingEntryEditFocusDateKeyRef.current !== date) {
      return
    }

    const firstProjectRow = displayedCurrentWorkItems[0]
    const focusTarget = isWorkItemMode
      ? firstProjectRow
        ? projectNameInputRefs.current[firstProjectRow.lineIndex]
        : null
      : isSelectedDayMarkedNoWork || isSelectedDayMarkedVacation
        ? statusActionButtonRef.current
        : hoursInputRef.current

    focusTarget?.focus()
    pendingEntryEditFocusDateKeyRef.current = null
  }, [
    date,
    displayedCurrentWorkItems,
    entryEditFocusRequest,
    isSelectedDayMarkedNoWork,
    isSelectedDayMarkedVacation,
    isWorkItemMode,
  ])

  const handleWeekChange = (delta: number) => {
    const nextWeekStartKey = shiftDateKey(visibleWeekStartKey, delta * 7)
    const nextSelectedDateKey =
      getFirstMissingWeekdayInWeekForReport(nextWeekStartKey, missingReportDateKeys) ??
      nextWeekStartKey

    syncSelectedDate(nextSelectedDateKey)
  }

  const handleMonthChange = (delta: number) => {
    const nextMonthKey = shiftMonth(visibleMonthKey, delta)
    syncSelectedDate(getDefaultDateForMonth(nextMonthKey, today))
  }

  const updateDraftField = (
    field: DayInputTextField,
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

  const updateWorkItemDrafts = (nextWorkItems: WorkItemDraft[]) => {
    if (isSelectedMonthEmployment) {
      setValidationIssue({
        title: 'Non-business month',
        body: 'This month is marked as a non-business month. Adding daily business entries here would make your calculations inaccurate.',
      })
      return
    }

    const existingDraft = dayInputDraftsRef.current[date] ?? getEntryDraft(selectedEntry)
    const sortedWorkItems = sortWorkItemDrafts(nextWorkItems)
    const nextDraft: DayInputDraft = {
      ...existingDraft,
      workItems: sortedWorkItems.length > 0 ? sortedWorkItems : undefined,
    }
    const nextValue = { ...dayInputDraftsRef.current }

    if (isDraftEmpty(nextDraft) && !selectedEntry) {
      delete nextValue[date]
    } else {
      nextValue[date] = nextDraft
    }

    dayInputDraftsRef.current = nextValue
    setDayInputDrafts(nextValue)

    if (userId) {
      persistDayInputDrafts(userId, nextValue)
    }

    onUnsavedDayInputDraftsChange?.(hasMeaningfulDayInputDrafts(nextValue, entries))

    if (currentInvalidFields.workItems) {
      setInvalidFieldsByDate((currentValue) => ({
        ...currentValue,
        [date]: {
          ...currentValue[date],
          workItems: false,
        },
      }))
    }
  }

  const handleAddProjectRow = () => {
    const defaultHourlyRate = configuredHourlyRate > 0 ? configuredHourlyRate.toFixed(2) : ''
    const nextLineIndex =
      currentWorkItems.length > 0
        ? Math.max(...currentWorkItems.map((workItem) => workItem.lineIndex)) + 1
        : 0
    const shouldSeedFromFlatValues =
      currentWorkItems.length === 0 && (hours.trim() !== '' || invoicedIncome.trim() !== '')
    const nextWorkItem: WorkItemDraft = {
      projectName: '',
      hours: shouldSeedFromFlatValues ? hours : '',
      hourlyRate: defaultHourlyRate,
      invoicedIncome: shouldSeedFromFlatValues ? invoicedIncome : '',
      lineIndex: nextLineIndex,
    }

    pendingProjectRowFocusLineIndexRef.current = nextLineIndex
    updateWorkItemDrafts([...currentWorkItems, nextWorkItem])
  }

  const handleUpdateProjectRow = (
    lineIndex: number,
    field: Exclude<keyof WorkItemDraft, 'id' | 'lineIndex'>,
    value: string,
  ) => {
    updateWorkItemDrafts(
      currentWorkItems.map((workItem) =>
        workItem.lineIndex === lineIndex
          ? {
              ...workItem,
              [field]: value,
            }
          : workItem,
      ),
    )
  }

  const handleRemoveProjectRow = (lineIndex: number) => {
    updateWorkItemDrafts(currentWorkItems.filter((workItem) => workItem.lineIndex !== lineIndex))
  }

  const showSaveToast = (message: string) => {
    setSaveToastMessage(message)
    setSaveToastVersion((currentValue) => currentValue + 1)
  }

  function getDailyValidationIssue(nextInvalidFieldsByDate: InvalidDailyFieldsByDate): DailyValidationIssue {
    const invalidDates = Object.entries(nextInvalidFieldsByDate)

    if (invalidDates.length === 1) {
      const [invalidDateKey, invalidFields] = invalidDates[0]
      const missingFields = [
        invalidFields.workItems ? 'project rows' : null,
        invalidFields.hours ? 'billed hours' : null,
        invalidFields.invoicedIncome ? 'invoice amount' : null,
      ].filter((field): field is string => field !== null)

      return {
        title: missingFields.length === 1 ? 'Complete required field' : 'Complete required fields',
        body: `For ${formatDate(parseDateKey(invalidDateKey))}, add ${missingFields.join(' and ')} before saving this worked day. Expense-only days are allowed, but worked days still need billed hours and invoice amount. Project rows need hours and an invoice amount, or hours and an hourly rate.`,
      }
    }

    const invalidSummary = invalidDates
      .map(([invalidDateKey, invalidFields]) => {
        const missingFields = [
          invalidFields.workItems ? 'project rows' : null,
          invalidFields.hours ? 'billed hours' : null,
          invalidFields.invoicedIncome ? 'invoice amount' : null,
        ].filter((field): field is string => field !== null)

        return `${formatDate(parseDateKey(invalidDateKey))}: ${missingFields.join(' and ')}`
      })
      .join('\n')

    return {
      title: 'Complete required fields',
      body: `Some worked days are still missing required fields. Expense-only days are allowed, but worked days still need billed hours and invoice amount. Project rows need hours and an invoice amount, or hours and an hourly rate.\n\n${invalidSummary}`,
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
      const existingEntry = entries.find((entry) => entry.date === draftDateKey)
      const isExistingExpenseEditableStatusEntry =
        existingEntry?.dayStatus === 'no_work' || existingEntry?.dayStatus === 'vacation'
      const isStatusExpenseDraft =
        isExistingExpenseEditableStatusEntry &&
        !hasWorkItemDraftRows(draft) &&
        draft.hours.trim() === '' &&
        draft.invoicedIncome.trim() === '' &&
        draft.paidIncome.trim() === ''

      if (isStatusExpenseDraft && existingEntry) {
        const resolvedExpenses = parseNumber(draft.expenses)
        const nextEntry: DailyEntry = {
          id: existingEntry.id,
          date: draftDateKey,
          dayStatus: existingEntry.dayStatus === 'vacation' ? 'vacation' : 'no_work',
          hours: 0,
          invoicedIncome: 0,
          paidIncome: 0,
          expenses: Number(resolvedExpenses.toFixed(2)),
        }

        nextEntriesToSave = [
          nextEntry,
          ...nextEntriesToSave.filter((existingItem) => existingItem.date !== draftDateKey),
        ]
        return
      }

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
        workItems: resolvedWorkItems,
      } = draftSaveState.values

      if (draftSaveState.kind === 'expense_only' && !isExistingExpenseEditableStatusEntry) {
        softWarnings.push({
          title: 'Expense-only day saved',
          body: formatDate(parseDateKey(draftDateKey)),
        })
      }

      if (
        (existingEntry?.dayStatus === 'no_work' || existingEntry?.dayStatus === 'vacation') &&
        isDraftEmpty(draft)
      ) {
        return
      }
      const nextEntryId = existingEntry?.id ?? `entry-${draftDateKey}-${Date.now()}`
      const shouldKeepExpenseEditableStatus =
        isExistingExpenseEditableStatusEntry && draftSaveState.kind === 'expense_only'
      const nextEntry: DailyEntry = {
        id: nextEntryId,
        date: draftDateKey,
        dayStatus: shouldKeepExpenseEditableStatus && existingEntry
          ? existingEntry.dayStatus === 'vacation'
            ? 'vacation'
            : 'no_work'
          : 'worked',
        hours: shouldKeepExpenseEditableStatus ? 0 : resolvedHours,
        invoicedIncome: shouldKeepExpenseEditableStatus
          ? 0
          : Number(resolvedInvoicedIncome.toFixed(2)),
        paidIncome: shouldKeepExpenseEditableStatus ? 0 : Number(resolvedPaidIncome.toFixed(2)),
        expenses: Number(resolvedExpenses.toFixed(2)),
        ...(!shouldKeepExpenseEditableStatus && resolvedWorkItems && resolvedWorkItems.length > 0
          ? {
              workItems: resolvedWorkItems.map((workItem, index) => ({
                ...workItem,
                dailyEntryId: nextEntryId,
                lineIndex: workItem.lineIndex ?? index,
              })),
            }
          : {}),
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
        showSaveToast('Saved daily reports with a warning.')
      } else {
        setFormMessage('Saved daily reports.')
        showSaveToast('Saved daily reports.')
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

    const resolvedExpenses = Number(parseNumber(expenses).toFixed(2))

    onUpsertEntry({
      id: selectedEntry?.id ?? `entry-${date}-no-work`,
      date,
      dayStatus: 'no_work' as const,
      hours: 0,
      invoicedIncome: 0,
      paidIncome: 0,
      expenses: resolvedExpenses,
    })
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses(resolvedExpenses > 0 ? resolvedExpenses.toString() : '')
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

    const resolvedExpenses = Number(parseNumber(expenses).toFixed(2))

    onUpsertEntry({
      id: selectedEntry?.id ?? `entry-${date}-vacation`,
      date,
      dayStatus: 'vacation' as const,
      hours: 0,
      invoicedIncome: 0,
      paidIncome: 0,
      expenses: resolvedExpenses,
    })
    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses(resolvedExpenses > 0 ? resolvedExpenses.toString() : '')
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
    const resolvedExpenses = Number(parseNumber(expenses).toFixed(2))

    if (resolvedExpenses > 0) {
      onUpsertEntry({
        id: selectedEntry?.id ?? `entry-${date}-${Date.now()}`,
        date,
        dayStatus: 'worked' as const,
        hours: 0,
        invoicedIncome: 0,
        paidIncome: 0,
        expenses: resolvedExpenses,
      })
    } else {
      onRemoveEntryForDate(date)
    }

    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses(resolvedExpenses > 0 ? resolvedExpenses.toString() : '')
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
    setFormMessage(
      resolvedExpenses > 0
        ? 'Vacation mark removed. Expenses were kept. Save daily reports to keep all changes.'
        : 'Vacation mark removed. Save daily reports to keep all changes.',
    )
  }

  const handleRequestDeleteEntry = (entry: DailyEntry) => {
    setPendingDeleteEntry(entry)
  }

  const handleEditEntry = (entry: DailyEntry) => {
    pendingEntryEditFocusDateKeyRef.current = entry.date
    syncSelectedDate(entry.date, true)
    setEntryEditFocusRequest((currentValue) => currentValue + 1)
    formRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
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
      <SuccessToast message={saveToastMessage} onDismiss={() => setSaveToastMessage('')} />
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
                ref={statusActionButtonRef}
                type="button"
              >
                Remove no work mark
              </button>
            ) : isSelectedDayMarkedVacation ? (
              <button
                className="rounded-2xl bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-200"
                onClick={handleRemoveVacationMark}
                ref={statusActionButtonRef}
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
            {visibleFullMissingMonthKey ? (
              <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">
                      {getMonthLabel(parseMonthKey(visibleFullMissingMonthKey))} has no daily reports.
                    </p>
                    <p className="mt-1 text-xs text-rose-800/80">
                      Add a daily entry to report it here, or backfill the whole month from configuration.
                    </p>
                  </div>
                  {onBackfillMissingMonth ? (
                    <button
                      className="shrink-0 rounded-full bg-rose-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-800"
                      onClick={() => onBackfillMissingMonth(visibleFullMissingMonthKey)}
                      type="button"
                    >
                      Backfill full month
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

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
                        const isMissing = day.isCurrentMonth && missingReportDateKeys.has(day.key)

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
                    const isMissing = missingReportDateKeys.has(day.key)

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

          {!isSelectedDayMarkedNoWork && !isSelectedDayMarkedVacation ? (
            <div
              className={`rounded-2xl border bg-background p-4 transition ${
                currentInvalidFields.workItems ? 'border-rose-300 bg-rose-50/50' : 'border-border'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Projects / rates</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isWorkItemMode
                      ? `${formatHours(workItemDraftTotals.hours)} · ${formatCurrencyPrecise(
                          workItemDraftTotals.invoicedIncome,
                        )} invoiced`
                      : 'Optional for days split across projects or rates.'}
                  </p>
                </div>
                <button
                  className="rounded-full bg-muted px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSelectedMonthEmployment}
                  onClick={handleAddProjectRow}
                  type="button"
                >
                  Add project row
                </button>
              </div>

              {isWorkItemMode ? (
                <div className="mt-4 space-y-3">
                  {displayedCurrentWorkItems.map((workItem, index) => {
                    const rowHours = parseNumber(workItem.hours)
                    const rowHourlyRate = parseNumber(workItem.hourlyRate)
                    const derivedInvoiceAmount =
                      rowHours > 0 && rowHourlyRate > 0 ? rowHours * rowHourlyRate : 0

                    return (
                      <div
                        key={`${workItem.lineIndex}-${index}`}
                        className="grid gap-3 rounded-2xl border border-border bg-card p-3 sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr_auto] sm:items-end"
                      >
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            Project / client
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                            disabled={isSelectedMonthEmployment}
                            ref={(element) => {
                              projectNameInputRefs.current[workItem.lineIndex] = element
                            }}
                            type="text"
                            value={workItem.projectName}
                            onChange={(event) =>
                              handleUpdateProjectRow(workItem.lineIndex, 'projectName', event.target.value)
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">Hours</span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                            disabled={isSelectedMonthEmployment}
                            min="0"
                            step="0.25"
                            type="number"
                            value={workItem.hours}
                            onChange={(event) =>
                              handleUpdateProjectRow(workItem.lineIndex, 'hours', event.target.value)
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            Hourly rate (excl. VAT)
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                            disabled={isSelectedMonthEmployment}
                            min="0"
                            step="0.01"
                            type="number"
                            value={workItem.hourlyRate}
                            onChange={(event) =>
                              handleUpdateProjectRow(workItem.lineIndex, 'hourlyRate', event.target.value)
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            Invoice amount (excl. VAT)
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                            disabled={isSelectedMonthEmployment}
                            min="0"
                            placeholder={derivedInvoiceAmount > 0 ? derivedInvoiceAmount.toFixed(2) : '0'}
                            step="0.01"
                            type="number"
                            value={workItem.invoicedIncome}
                            onChange={(event) =>
                              handleUpdateProjectRow(
                                workItem.lineIndex,
                                'invoicedIncome',
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <button
                          aria-label="Remove project row"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-rose-50 hover:text-rose-700"
                          disabled={isSelectedMonthEmployment}
                          onClick={() => handleRemoveProjectRow(workItem.lineIndex)}
                          type="button"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {!isWorkItemMode ? (
            <>
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
                <span className="mb-2 block text-sm font-medium text-foreground">
                  Invoice amount (excl. VAT)
                </span>
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
                    ? `Leave empty to auto-calculate at ${formatCurrencyPrecise(configuredHourlyRate)} per hour (${formatCurrencyPrecise(
                        settings.defaultShiftIncome ?? 0,
                      )} / ${formatNumber(settings.defaultShiftHours ?? 0)}h).`
                    : 'Enter the invoice amount manually until you finish base configuration.'}
                </span>
              </label>
            </>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">
              Paid income (excl. VAT)
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedDayMarkedNoWork || isSelectedDayMarkedVacation || isSelectedMonthEmployment}
              type="number"
              min="0"
              step="0.01"
              placeholder={paidIncomePlaceholder}
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
            <span className="mb-2 block text-sm font-medium text-foreground">
              Expenses (excl. VAT)
            </span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={isSelectedMonthEmployment}
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
            ) : isWorkItemMode ? (
              <>
                Project rows total{' '}
                <span className="font-medium text-foreground">
                  {formatHours(workItemDraftTotals.hours)}
                </span>{' '}
                and{' '}
                <span className="font-medium text-foreground">
                  {formatCurrencyPrecise(workItemDraftTotals.invoicedIncome)}
                </span>{' '}
                invoiced. Paid income and expenses stay day-level.
              </>
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
              const entryHours = getEntryHours(entry)
              const entryInvoicedIncome = getEntryInvoicedIncome(entry)
              const profit = entryInvoicedIncome - entry.expenses
              const entryWorkItems =
                entry.dayStatus === 'worked' && entry.workItems && entry.workItems.length > 0
                  ? sortNewestLineIndexFirst(entry.workItems)
                  : []

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
                          <p className="mt-1 text-sm text-muted-foreground">{formatHours(entryHours)}</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Invoiced: {formatCurrencyPrecise(entryInvoicedIncome)}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Paid: {formatCurrencyPrecise(entry.paidIncome)}
                          </p>
                          {entryWorkItems.length > 0 ? (
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <p className="font-medium text-foreground">
                                {entryWorkItems.length} project{entryWorkItems.length === 1 ? '' : 's'}
                              </p>
                              {entryWorkItems.slice(0, 3).map((workItem, index) => (
                                <p key={workItem.id ?? `${entry.id}-work-item-${index}`}>
                                  {workItem.projectName.trim() || 'Project'} · {formatHours(workItem.hours)} ·{' '}
                                  {formatCurrencyPrecise(workItem.invoicedIncome)}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}
                      {entry.expenses > 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expenses: {formatCurrencyPrecise(entry.expenses)}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-3 text-right">
                      <div className="flex items-center gap-2">
                        <button
                          aria-label={`Edit entry for ${formatDate(entryDate)}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-emerald-50 hover:text-emerald-700"
                          onClick={() => handleEditEntry(entry)}
                          type="button"
                        >
                          <EditIcon />
                        </button>
                        <button
                          aria-label={`Delete entry for ${formatDate(entryDate)}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => handleRequestDeleteEntry(entry)}
                          type="button"
                        >
                          <TrashIcon />
                        </button>
                      </div>
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

function SuccessToast({
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
      <div className="pointer-events-auto mx-auto flex w-full max-w-[30rem] items-start gap-3 rounded-[1.3rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-[0_18px_36px_rgba(24,32,48,0.14)]">
        <div className="mt-0.5 shrink-0">
          <ToastCheckIcon />
        </div>
        <p className="flex-1">{message}</p>
        <button
          aria-label="Dismiss save message"
          className="shrink-0 rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
          onClick={onDismiss}
          type="button"
        >
          <ToastCloseIcon />
        </button>
      </div>
    </div>
  )
}

function ToastCheckIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function ToastCloseIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m6 6 12 12M18 6 6 18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m14.25 5.25 4.5 4.5M5 19l4.1-.8 9.15-9.15a2.12 2.12 0 0 0-3-3L6.1 15.2 5 19Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
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
