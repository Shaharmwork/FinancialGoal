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
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatDate,
  formatHours,
  formatHoursPrecise,
} from '@/lib/formatters'
import {
  cx,
  FieldLabel,
  GhostButton,
  GoldButton,
  IconButton,
  inputClassName,
  Notice,
  Panel,
  SaveBar,
  ScreenHeader,
  Segmented,
  Stat,
  StatusDot,
  TextButton,
  Toast,
} from '@/components/ui/kit'

interface DailyLogProps {
  entries: DailyEntry[]
  fillMissingDayTargetDateKey?: string
  fillMissingDaysRequest?: number
  hasUnsavedChanges?: boolean
  monthlySummaries: MonthlySummary[]
  onDeleteSavedEntryImmediately: (dateKey: string) => void
  onBackfillMissingMonth?: (monthKey: string) => void
  onDiscardEntries?: () => void
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
  income?: boolean
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

type DayStatusOption = 'worked' | 'no_work' | 'vacation'
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
        workItems?: WorkItem[]
      }
    }
  | {
      kind: 'worked'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
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

function getConfiguredHourlyRate(settings: Settings) {
  const defaultShiftHours = settings.defaultShiftHours ?? 0
  const defaultShiftIncome = settings.defaultShiftIncome ?? 0

  return defaultShiftHours > 0 && defaultShiftIncome > 0
    ? defaultShiftIncome / defaultShiftHours
    : 0
}

function roundCents(value: number) {
  return Math.round(value * 100) / 100
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
      hourlyRate: '',
      totalIncome: '',
    }
  }

  if (entry.dayStatus === 'no_work' || entry.dayStatus === 'vacation') {
    return {
      expenses: entry.expenses > 0 ? entry.expenses.toString() : '',
      hours: '',
      hourlyRate: '',
      totalIncome: '',
    }
  }

  const workItems = getEntryWorkItemDrafts(entry)
  const entryHours = getEntryHours(entry)
  const entryIncome = getEntryInvoicedIncome(entry)
  // Saved days only store the total, so show it back as an hourly rate when
  // hours x rate reproduces it to the cent, otherwise as a total override.
  const derivedHourlyRate = entryHours > 0 ? roundCents(entryIncome / entryHours) : 0
  const canShowAsHourlyRate =
    derivedHourlyRate > 0 && roundCents(derivedHourlyRate * entryHours) === roundCents(entryIncome)

  return {
    expenses: entry.expenses > 0 ? entry.expenses.toString() : '',
    hours: entryHours > 0 ? entryHours.toString() : '',
    hourlyRate: canShowAsHourlyRate ? derivedHourlyRate.toString() : '',
    totalIncome: !canShowAsHourlyRate && entryIncome > 0 ? entryIncome.toString() : '',
    ...(workItems && workItems.length > 0 ? { workItems } : {}),
  }
}

function isDraftEmpty(draft: DayInputDraft) {
  if (hasWorkItemDraftRows(draft)) {
    return false
  }

  return (
    draft.hours.trim() === '' &&
    draft.hourlyRate.trim() === '' &&
    draft.totalIncome.trim() === '' &&
    draft.expenses.trim() === ''
  )
}

function getResolvedDraftIncome(draft: DayInputDraft, settings: Settings) {
  if (draft.totalIncome.trim() !== '') {
    return parseNumber(draft.totalIncome)
  }

  const resolvedHours = parseNumber(draft.hours)
  const resolvedHourlyRate =
    draft.hourlyRate.trim() !== '' ? parseNumber(draft.hourlyRate) : getConfiguredHourlyRate(settings)

  if (resolvedHours > 0 && resolvedHourlyRate > 0) {
    return resolvedHours * resolvedHourlyRate
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
      draft.hourlyRate !== entryDraft.hourlyRate ||
      draft.totalIncome !== entryDraft.totalIncome ||
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
    invoicedIncome: getResolvedDraftIncome(draft, settings),
  }
  const hasIncomeInput =
    values.invoicedIncome > 0 ||
    parseNumber(draft.hourlyRate) > 0 ||
    parseNumber(draft.totalIncome) > 0

  const hasAnyValue = values.hours > 0 || hasIncomeInput || values.expenses > 0

  if (!hasAnyValue) {
    return {
      kind: 'invalid',
      invalidFields: {
        hours: true,
        income: true,
      },
      values,
    }
  }

  const isExpenseOnlyDay = values.expenses > 0 && values.hours <= 0 && !hasIncomeInput

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
      income: values.invoicedIncome <= 0,
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
  onDiscardEntries,
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
  const [hourlyRate, setHourlyRate] = useState('')
  const [totalIncome, setTotalIncome] = useState('')
  const [expenses, setExpenses] = useState('')
  const [dayInputDrafts, setDayInputDrafts] = useState<Record<string, DayInputDraft>>({})
  // Status messages now come from the save bar and toasts; the setter stays for the handlers.
  const [, setFormMessage] = useState('')
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [saveToastMessage, setSaveToastMessage] = useState('')
  const [saveToastVersion, setSaveToastVersion] = useState(0)
  const [entryEditFocusRequest, setEntryEditFocusRequest] = useState(0)
  const [invalidFieldsByDate, setInvalidFieldsByDate] = useState<InvalidDailyFieldsByDate>({})
  const [validationIssue, setValidationIssue] = useState<DailyValidationIssue | null>(null)
  const [softWarning, setSoftWarning] = useState<DailySoftWarning | null>(null)
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<DailyEntry | null>(null)
  const [loadedDayInputDraftsUserId, setLoadedDayInputDraftsUserId] = useState<string | null>(null)
  const formRef = useRef<HTMLElement | null>(null)
  const reportListRef = useRef<HTMLElement | null>(null)
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
  const configuredHourlyRate = getConfiguredHourlyRate(settings)
  const hasConfiguredHourlyRate = configuredHourlyRate > 0
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
  const flatDraftHours = parseNumber(hours)
  const isUsingTotalIncome = totalIncome.trim() !== ''
  // With no hours typed yet, preview a standard configured shift (matches the hours placeholder).
  const previewHours = flatDraftHours > 0 ? flatDraftHours : (settings.defaultShiftHours ?? 0)
  const rateBasedIncome =
    previewHours * (hourlyRate.trim() !== '' ? parseNumber(hourlyRate) : configuredHourlyRate)
  const currentInvalidFields = invalidFieldsByDate[date] ?? {}

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
    setHourlyRate(nextDraft.hourlyRate)
    setTotalIncome(nextDraft.totalIncome)
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
      currentWorkItems.length === 0 &&
      (hours.trim() !== '' || hourlyRate.trim() !== '' || totalIncome.trim() !== '')
    const nextWorkItem: WorkItemDraft = {
      projectName: '',
      hours: shouldSeedFromFlatValues ? hours : '',
      hourlyRate: shouldSeedFromFlatValues && hourlyRate.trim() !== '' ? hourlyRate : defaultHourlyRate,
      invoicedIncome: shouldSeedFromFlatValues ? totalIncome : '',
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
        invalidFields.income ? 'an hourly rate or total income' : null,
      ].filter((field): field is string => field !== null)

      return {
        title: missingFields.length === 1 ? 'Complete required field' : 'Complete required fields',
        body: `For ${formatDate(parseDateKey(invalidDateKey))}, add ${missingFields.join(' and ')} before saving this worked day. Expense-only days are allowed, but worked days still need billed hours and an hourly rate (or a total income). Project rows need hours and an hourly rate, or hours and a total.`,
      }
    }

    const invalidSummary = invalidDates
      .map(([invalidDateKey, invalidFields]) => {
        const missingFields = [
          invalidFields.workItems ? 'project rows' : null,
          invalidFields.hours ? 'billed hours' : null,
          invalidFields.income ? 'an hourly rate or total income' : null,
        ].filter((field): field is string => field !== null)

        return `${formatDate(parseDateKey(invalidDateKey))}: ${missingFields.join(' and ')}`
      })
      .join('\n')

    return {
      title: 'Complete required fields',
      body: `Some worked days are still missing required fields. Expense-only days are allowed, but worked days still need billed hours and an hourly rate (or a total income). Project rows need hours and an hourly rate, or hours and a total.\n\n${invalidSummary}`,
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
        draft.hourlyRate.trim() === '' &&
        draft.totalIncome.trim() === ''

      if (isStatusExpenseDraft && existingEntry) {
        const resolvedExpenses = parseNumber(draft.expenses)
        const nextEntry: DailyEntry = {
          id: existingEntry.id,
          date: draftDateKey,
          dayStatus: existingEntry.dayStatus === 'vacation' ? 'vacation' : 'no_work',
          hours: 0,
          invoicedIncome: 0,
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
    setHourlyRate(selectedEntryDraft.hourlyRate)
    setTotalIncome(selectedEntryDraft.totalIncome)
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
      expenses: resolvedExpenses,
    })
    setHours('')
    setHourlyRate('')
    setTotalIncome('')
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
    setHourlyRate('')
    setTotalIncome('')
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
      expenses: resolvedExpenses,
    })
    setHours('')
    setHourlyRate('')
    setTotalIncome('')
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
        expenses: resolvedExpenses,
      })
    } else {
      onRemoveEntryForDate(date)
    }

    setHours('')
    setHourlyRate('')
    setTotalIncome('')
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
    setHourlyRate('')
    setTotalIncome('')
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

  const selectedDayStatus: DayStatusOption = isSelectedDayMarkedNoWork
    ? 'no_work'
    : isSelectedDayMarkedVacation
      ? 'vacation'
      : 'worked'

  // One switch replaces the separate "mark as" / "remove mark" buttons.
  const handleChangeDayStatus = (nextStatus: DayStatusOption) => {
    if (nextStatus === selectedDayStatus) {
      return
    }

    if (nextStatus === 'no_work') {
      handleMarkNoWork()
      return
    }

    if (nextStatus === 'vacation') {
      handleMarkVacation()
      return
    }

    if (selectedDayStatus === 'no_work') {
      handleRemoveNoWorkMark()
      return
    }

    handleRemoveVacationMark()
  }

  const discardAllReportChanges = () => {
    discardDayInputDrafts()
    onDiscardEntries?.()
    setIsDiscardConfirmOpen(false)
  }

  const visibleMonthTotals = monthEntries.reduce(
    (totals, entry) => {
      if ((entry.dayStatus ?? 'worked') !== 'worked') {
        return totals
      }

      return {
        hours: totals.hours + getEntryHours(entry),
        income: totals.income + getEntryInvoicedIncome(entry),
      }
    },
    { hours: 0, income: 0 },
  )
  const visibleMonthMissingDateKeys = [...missingReportDateKeys]
    .filter((dateKey) => dateKey.startsWith(visibleMonthKey))
    .sort()
  const visibleMonthMissingCount = visibleMonthMissingDateKeys.length
  const visibleMonthSummary = monthlySummaries.find((summary) => summary.monthKey === visibleMonthKey)
  const previousMonthKey = shiftMonth(visibleMonthKey, -1)
  const nextMonthKey = shiftMonth(visibleMonthKey, 1)

  const jumpToFirstMissingDay = () => {
    const [firstMissingDateKey] = visibleMonthMissingDateKeys

    if (!firstMissingDateKey) {
      return
    }

    syncSelectedDate(firstMissingDateKey, true)
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      hoursInputRef.current?.focus({ preventScroll: true })
    }, 60)
  }

  // The report list follows the calendar month; these buttons move both.
  const showReportsForMonth = (delta: number) => {
    handleMonthChange(delta)
    window.setTimeout(() => {
      reportListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }
  const selectedDateLabel = parseDateKey(date).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const isSelectedDayToday = date === todayDateKey
  const isSelectedDayFuture = date > todayDateKey
  const flatHourlyRate = hourlyRate.trim() !== '' ? parseNumber(hourlyRate) : configuredHourlyRate
  const isEditorDisabled = isSelectedMonthEmployment

  const renderFlatCalculation = () => {
    if (isUsingTotalIncome) {
      const total = parseNumber(totalIncome)

      return flatDraftHours > 0 && total > 0 ? (
        <>
          Works out to{' '}
          <span className="font-semibold text-[#f3e4cf]">
            {formatCurrencyPrecise(total / flatDraftHours)}
          </span>{' '}
          per hour. The total counts; the rate is ignored.
        </>
      ) : (
        'Add the hours to see the hourly rate this total works out to.'
      )
    }

    if (flatDraftHours > 0 && flatHourlyRate > 0) {
      return (
        <>
          {formatHoursPrecise(flatDraftHours)} × {formatCurrencyPrecise(flatHourlyRate)}
          {hourlyRate.trim() === '' ? ' (default rate)' : ''} ={' '}
          <span className="font-semibold text-[#f3e4cf]">
            {formatCurrencyPrecise(flatDraftHours * flatHourlyRate)}
          </span>
        </>
      )
    }

    if (hasConfiguredHourlyRate) {
      return (
        <>
          Leave the rate empty to use your default {formatCurrencyPrecise(configuredHourlyRate)}/h.
          A standard shift is {formatHours(previewHours)} ={' '}
          <span className="font-semibold text-[#f3e4cf]">{formatCurrencyPrecise(rateBasedIncome)}</span>.
        </>
      )
    }

    return 'Enter hours and an hourly rate, or a total for a fixed-price day.'
  }

  const renderCalendarDay = (day: CalendarDay, variant: 'week' | 'month') => {
    const isSelected = day.key === date
    const isToday = day.key === todayDateKey
    const isNoWork = noWorkDateKeys.has(day.key)
    const isVacation = vacationDateKeys.has(day.key)
    const isFilled = filledDateKeys.has(day.key)
    const isMissing = missingReportDateKeys.has(day.key) && (variant === 'week' || day.isCurrentMonth)
    const dotTone = isNoWork
      ? 'no_work'
      : isVacation
        ? 'vacation'
        : isFilled
          ? 'worked'
          : isMissing
            ? 'missing'
            : null

    return (
      <button
        key={day.key}
        aria-label={`${formatDate(day.date)}${isMissing ? ', missing report' : ''}`}
        aria-pressed={isSelected}
        className={cx(
          'relative flex min-w-0 flex-col items-center justify-center rounded-[12px] border transition',
          variant === 'week' ? 'h-[4.1rem] gap-0.5' : 'h-11',
          isSelected
            ? 'border-[#fff1c4]/70 bg-[linear-gradient(180deg,#ffe6a6_0%,#f0b65f_48%,#bf7a3c_100%)] text-[#1b0f05] shadow-[0_0_12px_rgba(255,190,90,0.3)]'
            : !day.isCurrentMonth && variant === 'month'
              ? 'pointer-events-none border-transparent text-[#4a3a2c]'
              : isMissing
                ? 'border-[#ff7a6a]/40 bg-[#1f0e0b] text-[#ffcfc6]'
                : day.isWeekend
                  ? 'border-transparent text-[#7d6650] hover:bg-[#1d1510]'
                  : 'border-[#8a603d]/30 bg-[#120d0a] text-[#ead7bd] hover:border-[#e7b277]/50',
          isToday && !isSelected ? 'ring-1 ring-[#e7b277]/80' : '',
        )}
        disabled={variant === 'month' && !day.isCurrentMonth}
        onClick={() => syncSelectedDate(day.key, variant === 'month')}
        type="button"
      >
        {variant === 'week' ? (
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-75">
            {getCompactDayLabel(day.date)}
          </span>
        ) : null}
        <span className={cx('font-semibold', variant === 'week' ? 'text-lg leading-none' : 'text-sm')}>
          {day.date.getDate()}
        </span>
        <span className="flex h-1.5 items-center">
          {dotTone ? <StatusDot onGold={isSelected} tone={dotTone} /> : null}
        </span>
      </button>
    )
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
            ? 'This deletes the saved report for this day right away. Other unsaved changes stay in your draft.'
            : 'This removes the day from your unsaved draft.'
        }
        isOpen={pendingDeleteEntry !== null}
        onClose={() => setPendingDeleteEntry(null)}
        onPrimaryAction={handleConfirmDeleteEntry}
        onSecondaryAction={() => setPendingDeleteEntry(null)}
        primaryActionLabel="Delete"
        secondaryActionLabel="Cancel"
        title={
          pendingDeleteEntry
            ? `Delete ${formatDate(parseDateKey(pendingDeleteEntry.date))}?`
            : 'Delete this day?'
        }
      />
      <WarningModal
        body="All report changes you haven't saved yet will be lost."
        isOpen={isDiscardConfirmOpen}
        onClose={() => setIsDiscardConfirmOpen(false)}
        onPrimaryAction={discardAllReportChanges}
        onSecondaryAction={() => setIsDiscardConfirmOpen(false)}
        primaryActionLabel="Discard changes"
        secondaryActionLabel="Keep editing"
        title="Discard unsaved reports?"
      />
      <Toast message={saveToastMessage} onDismiss={() => setSaveToastMessage('')} tone="success" />

      <div className="space-y-4">
        <ScreenHeader
          eyebrow="Report"
          title={getMonthLabel(visibleMonthDate)}
          action={
            <GhostButton onClick={resetToCurrentDayAndWeek} size="sm">
              Today
            </GhostButton>
          }
        />

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Hours" value={formatHours(visibleMonthTotals.hours)} />
          <Stat label="Earned" value={formatCurrency(visibleMonthTotals.income)} />
          <Stat
            hint={visibleMonthMissingCount > 0 ? 'Go to first ›' : undefined}
            label="Missing days"
            onClick={visibleMonthMissingCount > 0 ? jumpToFirstMissingDay : undefined}
            tone={visibleMonthMissingCount > 0 ? 'warn' : 'good'}
            value={visibleMonthMissingCount > 0 ? visibleMonthMissingCount : 'None'}
          />
        </div>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <IconButton
              disabled={false}
              label={isMonthExpanded ? 'Previous month' : 'Previous week'}
              onClick={() => (isMonthExpanded ? handleMonthChange(-1) : handleWeekChange(-1))}
            >
              ‹
            </IconButton>
            <button
              aria-expanded={isMonthExpanded}
              className="flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-[#1d1510]"
              onClick={() => setIsMonthExpanded((currentValue) => !currentValue)}
              title={isMonthExpanded ? 'Show one week' : 'Show the whole month'}
              type="button"
            >
              <span className="dashboard-gold-title truncate text-[13px] font-semibold uppercase tracking-[0.14em]">
                {isMonthExpanded
                  ? getMonthLabel(visibleMonthDate)
                  : getWeekRangeLabel(visibleWeekDays[0].date, visibleWeekDays[6].date)}
              </span>
              <span
                aria-hidden="true"
                className={cx('text-xs text-[#c9a57f] transition', isMonthExpanded && 'rotate-180')}
              >
                ▾
              </span>
            </button>
            <IconButton
              disabled={
                isMonthExpanded
                  ? visibleMonthKey >= currentMonthKey
                  : visibleWeekStartKey >= currentWeekStartKey
              }
              label={isMonthExpanded ? 'Next month' : 'Next week'}
              onClick={() => (isMonthExpanded ? handleMonthChange(1) : handleWeekChange(1))}
            >
              ›
            </IconButton>
          </div>

          {isMonthExpanded ? (
            <div className="mt-4">
              <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8f7559]">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div className="mt-2 space-y-1.5">
                {calendarRows.map((weekRow, rowIndex) => (
                  <div key={`${visibleMonthKey}-week-${rowIndex}`} className="grid grid-cols-7 gap-1.5">
                    {weekRow.map((day) => renderCalendarDay(day, 'month'))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {visibleWeekDays.map((day) => renderCalendarDay(day, 'week'))}
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-[11px] text-[#a88c71]">
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="worked" />Worked</span>
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="no_work" />No work</span>
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="vacation" />Vacation</span>
            <span className="inline-flex items-center gap-1.5"><StatusDot tone="missing" />Missing</span>
          </div>

          {visibleFullMissingMonthKey ? (
            <div className="mt-4">
              <Notice
                action={
                  onBackfillMissingMonth ? (
                    <GoldButton
                      onClick={() => onBackfillMissingMonth(visibleFullMissingMonthKey)}
                      size="sm"
                    >
                      Add month total
                    </GoldButton>
                  ) : null
                }
                title={`${getMonthLabel(parseMonthKey(visibleFullMissingMonthKey))} has no reports`}
                tone="warn"
              >
                Report the days here, or add the whole month at once in Configuration.
              </Notice>
            </div>
          ) : null}
        </Panel>

        <Panel
          panelRef={formRef}
          title={selectedDateLabel}
          subtitle={
            isSelectedDayToday
              ? 'Today'
              : isSelectedDayFuture
                ? 'A future day'
                : savedEntryDateKeys.has(date)
                  ? 'Saved'
                  : missingReportDateKeys.has(date)
                    ? 'Not reported yet'
                    : undefined
          }
          titleAction={
            selectedEntry ? (
              <IconButton
                label={`Delete ${formatDate(parseDateKey(date))}`}
                onClick={() => handleRequestDeleteEntry(selectedEntry)}
              >
                <TrashIcon />
              </IconButton>
            ) : null
          }
        >
          <form className="space-y-4" onSubmit={handleSaveAllEntries}>
            {isSelectedMonthEmployment ? (
              <Notice title="Employment month" tone="info">
                This month is set as an employment / pre-business month in Configuration, so it
                doesn&apos;t take daily reports.
              </Notice>
            ) : null}

            <Segmented<DayStatusOption>
              disabled={isEditorDisabled}
              firstButtonRef={statusActionButtonRef}
              label="Day status"
              onChange={handleChangeDayStatus}
              options={[
                { value: 'worked', label: 'Worked' },
                { value: 'no_work', label: 'No work' },
                { value: 'vacation', label: 'Vacation' },
              ]}
              value={selectedDayStatus}
            />

            {selectedDayStatus === 'worked' ? (
              isWorkItemMode ? (
                <div
                  className={cx(
                    'space-y-3 rounded-[16px] border p-3',
                    currentInvalidFields.workItems
                      ? 'border-[#ff6b5b]/60 bg-[#240c09]/60'
                      : 'border-[#8a603d]/35 bg-[#120d0a]/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9a57f]">
                        Projects
                      </p>
                      <p className="mt-0.5 text-xs text-[#a88c71]">
                        {formatHours(workItemDraftTotals.hours)} ·{' '}
                        {formatCurrencyPrecise(workItemDraftTotals.invoicedIncome)}
                      </p>
                    </div>
                    <GhostButton disabled={isEditorDisabled} onClick={handleAddProjectRow} size="sm">
                      + Project
                    </GhostButton>
                  </div>

                  {displayedCurrentWorkItems.map((workItem, index) => {
                    const rowHours = parseNumber(workItem.hours)
                    const rowHourlyRate = parseNumber(workItem.hourlyRate)
                    const rowTotal = parseNumber(workItem.invoicedIncome)
                    const isUsingRowTotal = workItem.invoicedIncome.trim() !== ''

                    return (
                      <div
                        key={`${workItem.lineIndex}-${index}`}
                        className="space-y-2.5 rounded-[14px] border border-[#8a603d]/30 bg-[#0f0b08]/80 p-3"
                      >
                        <div className="flex items-end gap-2">
                          <label className="block min-w-0 flex-1">
                            <FieldLabel>Project / client</FieldLabel>
                            <input
                              ref={(element) => {
                                projectNameInputRefs.current[workItem.lineIndex] = element
                              }}
                              className={inputClassName(false, 'py-2.5 text-sm')}
                              disabled={isEditorDisabled}
                              placeholder="e.g. Handyman"
                              type="text"
                              value={workItem.projectName}
                              onChange={(event) =>
                                handleUpdateProjectRow(workItem.lineIndex, 'projectName', event.target.value)
                              }
                            />
                          </label>
                          <IconButton
                            className="mb-0.5"
                            disabled={isEditorDisabled}
                            label="Remove project"
                            onClick={() => handleRemoveProjectRow(workItem.lineIndex)}
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <label className="block min-w-0">
                            <FieldLabel>Hours</FieldLabel>
                            <input
                              className={inputClassName(false, 'px-3 py-2.5 text-sm')}
                              disabled={isEditorDisabled}
                              inputMode="decimal"
                              min="0"
                              step="0.25"
                              type="number"
                              value={workItem.hours}
                              onChange={(event) =>
                                handleUpdateProjectRow(workItem.lineIndex, 'hours', event.target.value)
                              }
                            />
                          </label>
                          <label className={cx('block min-w-0 transition', isUsingRowTotal && 'opacity-50')}>
                            <FieldLabel>Rate €/h</FieldLabel>
                            <input
                              className={inputClassName(false, 'px-3 py-2.5 text-sm')}
                              disabled={isEditorDisabled}
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              type="number"
                              value={workItem.hourlyRate}
                              onChange={(event) =>
                                handleUpdateProjectRow(workItem.lineIndex, 'hourlyRate', event.target.value)
                              }
                            />
                          </label>
                          <label className="block min-w-0">
                            <FieldLabel>Total €</FieldLabel>
                            <input
                              className={inputClassName(false, 'px-3 py-2.5 text-sm')}
                              disabled={isEditorDisabled}
                              inputMode="decimal"
                              min="0"
                              placeholder="optional"
                              step="0.01"
                              type="number"
                              value={workItem.invoicedIncome}
                              onChange={(event) =>
                                handleUpdateProjectRow(workItem.lineIndex, 'invoicedIncome', event.target.value)
                              }
                            />
                          </label>
                        </div>
                        <p className="text-xs text-[#a88c71]">
                          {isUsingRowTotal && rowHours > 0 && rowTotal > 0
                            ? `Works out to ${formatCurrencyPrecise(rowTotal / rowHours)} per hour.`
                            : rowHours > 0 && rowHourlyRate > 0
                              ? `${formatHoursPrecise(rowHours)} × ${formatCurrencyPrecise(rowHourlyRate)} = ${formatCurrencyPrecise(rowHours * rowHourlyRate)}`
                              : 'Hours and a rate, or hours and a total.'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block min-w-0">
                      <FieldLabel>Hours</FieldLabel>
                      <input
                        ref={hoursInputRef}
                        className={inputClassName(currentInvalidFields.hours, 'px-3')}
                        disabled={isEditorDisabled}
                        inputMode="decimal"
                        min="0"
                        placeholder={settings.defaultShiftHours?.toString() ?? ''}
                        step="0.25"
                        type="number"
                        value={hours}
                        onChange={(event) => {
                          updateDraftField('hours', event.target.value, 'hours')
                          setHours(event.target.value)
                        }}
                      />
                    </label>
                    <label className={cx('block min-w-0 transition', isUsingTotalIncome && 'opacity-50')}>
                      <FieldLabel>Rate €/h</FieldLabel>
                      <input
                        className={inputClassName(currentInvalidFields.income && !isUsingTotalIncome, 'px-3')}
                        disabled={isEditorDisabled}
                        inputMode="decimal"
                        min="0"
                        placeholder={hasConfiguredHourlyRate ? configuredHourlyRate.toFixed(2) : ''}
                        step="0.01"
                        type="number"
                        value={hourlyRate}
                        onChange={(event) => {
                          updateDraftField('hourlyRate', event.target.value, 'income')
                          setHourlyRate(event.target.value)
                        }}
                      />
                    </label>
                    <label className="block min-w-0">
                      <FieldLabel>Total €</FieldLabel>
                      <input
                        className={inputClassName(currentInvalidFields.income && isUsingTotalIncome, 'px-3')}
                        disabled={isEditorDisabled}
                        inputMode="decimal"
                        min="0"
                        placeholder="optional"
                        step="0.01"
                        type="number"
                        value={totalIncome}
                        onChange={(event) => {
                          updateDraftField('totalIncome', event.target.value, 'income')
                          setTotalIncome(event.target.value)
                        }}
                      />
                    </label>
                  </div>
                  <p className="text-xs leading-5 text-[#a88c71]">{renderFlatCalculation()}</p>
                  <TextButton disabled={isEditorDisabled} onClick={handleAddProjectRow}>
                    + Split into projects or rates
                  </TextButton>
                </div>
              )
            ) : (
              <p className="rounded-[14px] border border-[#8a603d]/30 bg-[#120d0a]/70 px-3.5 py-3 text-sm text-[#cdb497]">
                {selectedDayStatus === 'vacation'
                  ? 'Marked as vacation. It counts as reported and is tracked apart from no-work days.'
                  : 'Marked as no work. It counts as reported, so it won’t show up as missing.'}
              </p>
            )}

            <label className="block">
              <FieldLabel>Business expenses (excl. VAT)</FieldLabel>
              <input
                className={inputClassName(false)}
                disabled={isEditorDisabled}
                inputMode="decimal"
                min="0"
                placeholder="0"
                step="0.01"
                type="number"
                value={expenses}
                onChange={(event) => {
                  updateDraftField('expenses', event.target.value)
                  setExpenses(event.target.value)
                }}
              />
            </label>
          </form>
        </Panel>

        <Panel
          panelRef={reportListRef}
          title={`${getMonthLabel(visibleMonthDate)} reports`}
          subtitle={
            monthEntries.length === 0
              ? undefined
              : `${monthEntries.length} day${monthEntries.length === 1 ? '' : 's'} · ${formatHours(visibleMonthTotals.hours)} · ${formatCurrencyPrecise(visibleMonthTotals.income)}`
          }
        >
          {monthEntries.length === 0 ? (
            visibleMonthSummary ? (
              <Notice
                title={
                  visibleMonthSummary.monthType === 'employment'
                    ? 'Employment month'
                    : `Reported as a month total: ${formatHours(visibleMonthSummary.hours ?? 0)} · ${formatCurrency(visibleMonthSummary.invoicedIncome ?? 0)}`
                }
              >
                {visibleMonthSummary.monthType === 'employment'
                  ? 'This month was set up as an employment month in Configuration.'
                  : 'This month has no daily reports. Its total is under Configuration → Past months.'}
              </Notice>
            ) : (
              <p className="py-4 text-center text-sm text-[#a88c71]">
                No reports yet for {getMonthLabel(visibleMonthDate)}.
              </p>
            )
          ) : (
            <ul className="space-y-2">
              {monthEntries.map((entry) => {
                const entryDate = parseDateKey(entry.date)
                const entryHours = getEntryHours(entry)
                const entryIncome = getEntryInvoicedIncome(entry)
                const entryStatus = entry.dayStatus ?? 'worked'
                const projectCount =
                  entryStatus === 'worked' && entry.workItems ? entry.workItems.length : 0
                const isSelected = entry.date === date

                const entryDetails = [
                  projectCount > 1 ? `${projectCount} projects` : null,
                  entry.expenses > 0 ? `${formatCurrencyPrecise(entry.expenses)} expenses` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <li key={entry.id}>
                    <button
                      className={cx(
                        'flex w-full min-w-0 items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition',
                        isSelected
                          ? 'border-[#e7b277]/70 bg-[#2a1e15]'
                          : 'border-[#8a603d]/30 bg-[#120d0a]/80 hover:border-[#e7b277]/45',
                      )}
                      onClick={() => handleEditEntry(entry)}
                      type="button"
                    >
                      <span className="flex w-10 shrink-0 flex-col items-center leading-none">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#a88c71]">
                          {getCompactDayLabel(entryDate)}
                        </span>
                        <span className="mt-1 text-lg font-semibold text-[#f3e4cf]">
                          {entryDate.getDate()}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-[#ead7bd]">
                          <StatusDot tone={entryStatus === 'worked' ? 'worked' : entryStatus} />
                          {entryStatus === 'no_work'
                            ? 'No work'
                            : entryStatus === 'vacation'
                              ? 'Vacation'
                              : entryHours > 0
                                ? formatHours(entryHours)
                                : 'Expenses only'}
                        </span>
                        {entryDetails ? (
                          <span className="mt-0.5 block truncate text-xs text-[#8f7559]">
                            {entryDetails}
                          </span>
                        ) : null}
                      </span>
                      {entryStatus === 'worked' && entryIncome > 0 ? (
                        <span className="dashboard-gold-value shrink-0 text-[15px] font-semibold">
                          {formatCurrencyPrecise(entryIncome)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#8a603d]/25 pt-3">
            <GhostButton onClick={() => showReportsForMonth(-1)} size="sm">
              ‹ {getMonthLabel(parseMonthKey(previousMonthKey))}
            </GhostButton>
            {nextMonthKey <= currentMonthKey ? (
              <GhostButton onClick={() => showReportsForMonth(1)} size="sm">
                {getMonthLabel(parseMonthKey(nextMonthKey))} ›
              </GhostButton>
            ) : null}
          </div>
        </Panel>
      </div>

      <SaveBar
        detail="Kept on this device"
        onDiscard={() => setIsDiscardConfirmOpen(true)}
        onSave={() => {
          handleSaveAllEntries()
        }}
        saveLabel="Save reports"
        title="Unsaved reports"
        visible={hasUnsavedChanges}
      />
    </>
  )
}

function getWeekRangeLabel(start: Date, end: Date) {
  const startLabel = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const endLabel = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${startLabel} – ${endLabel}`
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
