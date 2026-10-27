import { getEntryHours, getEntryInvoicedIncome } from './calculations'
import type { ReportDayFormDraft, ReportWorkItemDraft } from './ui-preferences'
import type { DailyEntry, PricingMode, Settings, WorkItem } from './types'

// Report screen form drafts: converting saved days to editable fields and back.
// Kept out of the component so the pricing rules can be tested directly.

export type WorkItemDraft = ReportWorkItemDraft
export type DayInputDraft = ReportDayFormDraft

export type InvalidDailyFieldsState = {
  hours?: boolean
  income?: boolean
  workItems?: boolean
}

export type DailyDraftSaveState =
  | {
      kind: 'expense_only'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        workItems?: WorkItem[]
        hourlyRate?: number | null
        pricingMode?: PricingMode | null
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
        hourlyRate?: number | null
        pricingMode?: PricingMode | null
      }
    }
  | {
      kind: 'worked'
      values: {
        expenses: number
        hours: number
        invoicedIncome: number
        workItems?: WorkItem[]
        hourlyRate?: number | null
        pricingMode?: PricingMode | null
      }
    }

export function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function getConfiguredHourlyRate(settings: Settings) {
  const defaultShiftHours = settings.defaultShiftHours ?? 0
  const defaultShiftIncome = settings.defaultShiftIncome ?? 0

  return defaultShiftHours > 0 && defaultShiftIncome > 0
    ? defaultShiftIncome / defaultShiftHours
    : 0
}

export function roundCents(value: number) {
  return Math.round(value * 100) / 100
}

export function sortWorkItemDrafts(workItems: WorkItemDraft[]) {
  return [...workItems].sort((left, right) => left.lineIndex - right.lineIndex)
}

export function getEntryWorkItemDrafts(entry: DailyEntry | undefined): WorkItemDraft[] | undefined {
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
        workItem.pricingMode !== 'fixed' &&
        typeof workItem.hourlyRate === 'number' &&
        workItem.hourlyRate > 0
          ? workItem.hourlyRate.toString()
          : '',
      // Hourly lines leave the total empty, so editing hours recalculates the income.
      // Fixed and legacy (mode unknown) lines keep their saved total as entered.
      invoicedIncome:
        workItem.pricingMode !== 'hourly' && workItem.invoicedIncome > 0
          ? workItem.invoicedIncome.toString()
          : '',
      lineIndex: workItem.lineIndex ?? index,
    })),
  )
}

export function isWorkItemDraftBlank(workItem: WorkItemDraft) {
  return (
    workItem.projectName.trim() === '' &&
    workItem.hours.trim() === '' &&
    workItem.hourlyRate.trim() === '' &&
    workItem.invoicedIncome.trim() === ''
  )
}

export function hasWorkItemDraftRows(draft: DayInputDraft) {
  return Array.isArray(draft.workItems) && draft.workItems.length > 0
}

export function getResolvedWorkItemInvoiceAmount(workItem: WorkItemDraft) {
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

export function getWorkItemsDraftTotals(workItems: WorkItemDraft[]) {
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

export function areWorkItemDraftsEqual(left?: WorkItemDraft[], right?: WorkItemDraft[]) {
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

export function getEntryDraft(entry: DailyEntry | undefined): DayInputDraft {
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
  // Hourly days show their saved rate; fixed days and legacy days (saved before the
  // mode was stored) show their saved total, which is never re-derived from hours.
  const isHourly =
    entry.pricingMode === 'hourly' &&
    typeof entry.hourlyRate === 'number' &&
    entry.hourlyRate > 0

  return {
    expenses: entry.expenses > 0 ? entry.expenses.toString() : '',
    hours: entryHours > 0 ? entryHours.toString() : '',
    hourlyRate: isHourly ? String(entry.hourlyRate) : '',
    totalIncome: !isHourly && entryIncome > 0 ? entryIncome.toString() : '',
    ...(workItems && workItems.length > 0 ? { workItems } : {}),
  }
}

export function isDraftEmpty(draft: DayInputDraft) {
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

export function getResolvedDraftIncome(draft: DayInputDraft, settings: Settings) {
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

export function getDailyDraftSaveState(draft: DayInputDraft, settings: Settings): DailyDraftSaveState {
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
      const isFixedTotal = workItem.invoicedIncome.trim() !== ''

      if (resolvedHours <= 0 || resolvedInvoicedIncome <= 0) {
        hasInvalidWorkItem = true
        return
      }

      resolvedWorkItems.push({
        id: workItem.id,
        projectName: workItem.projectName.trim(),
        hours: Number(resolvedHours.toFixed(2)),
        hourlyRate:
          !isFixedTotal && resolvedHourlyRate > 0 ? Number(resolvedHourlyRate.toFixed(2)) : null,
        invoicedIncome: Number(resolvedInvoicedIncome.toFixed(2)),
        lineIndex: workItem.lineIndex ?? index,
        pricingMode: isFixedTotal ? 'fixed' : 'hourly',
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

  const isFixedTotal = draft.totalIncome.trim() !== ''
  const resolvedHourlyRate =
    draft.hourlyRate.trim() !== '' ? parseNumber(draft.hourlyRate) : getConfiguredHourlyRate(settings)
  const values = {
    ...baseValues,
    hours: parseNumber(draft.hours),
    invoicedIncome: getResolvedDraftIncome(draft, settings),
    // Stored explicitly so reopening the day never guesses: a typed total is a
    // fixed price; otherwise the (typed or default) rate is the hourly price.
    hourlyRate: isFixedTotal || resolvedHourlyRate <= 0 ? null : Number(resolvedHourlyRate.toFixed(2)),
    pricingMode: isFixedTotal ? ('fixed' as const) : ('hourly' as const),
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
      values: { ...values, hourlyRate: null, pricingMode: null },
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
