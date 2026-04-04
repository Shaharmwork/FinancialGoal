import type { DailyEntry, MonthlySummary, Settings } from './types'

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundHours(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function parseMonthKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

export function getCurrentWeekRange(today = new Date()) {
  const day = today.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  return { start, end }
}

export function getCurrentMonthRange(today = new Date()) {
  return {
    start: new Date(today.getFullYear(), today.getMonth(), 1),
    end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
  }
}

export function getCurrentYearRange(today = new Date()) {
  return {
    start: new Date(today.getFullYear(), 0, 1),
    end: new Date(today.getFullYear(), 11, 31),
  }
}

export function filterEntriesByRange(entries: DailyEntry[], start: Date, end: Date) {
  const startKey = toDateKey(start)
  const endKey = toDateKey(end)
  return entries.filter((entry) => entry.date >= startKey && entry.date <= endKey)
}

type EntryField = 'hours' | 'invoicedIncome' | 'paidIncome' | 'expenses'

function sumEntries(entries: DailyEntry[], field: EntryField) {
  return entries.reduce((total, entry) => total + entry[field], 0)
}

function getDefaultHourlyRate(settings: Settings) {
  if (settings.defaultShiftHours <= 0) {
    return 0
  }

  return settings.defaultShiftIncome / settings.defaultShiftHours
}

function getTaxRate(settings: Settings) {
  return Math.max(0, settings.incomeTaxPercent + settings.additionalTaxPercent) / 100
}

function getTaxFromProfit(profit: number, settings: Settings) {
  return roundCurrency(Math.max(0, profit) * getTaxRate(settings))
}

function getReserveTarget(taxAmount: number, settings: Settings) {
  const bufferMultiplier = 1 + Math.max(0, settings.reserveBufferPercent) / 100
  return roundCurrency(Math.max(0, taxAmount) * bufferMultiplier)
}

function getMonthProgress(today: Date, monthEnd: Date) {
  return today.getDate() / monthEnd.getDate()
}

function getElapsedYearMonths(today: Date, monthEnd: Date) {
  return today.getMonth() + getMonthProgress(today, monthEnd)
}

function getUniqueWorkDays(entries: DailyEntry[]) {
  return new Set(entries.filter((entry) => entry.hours > 0).map((entry) => entry.date)).size
}

function countWeekdays(start: Date, end: Date) {
  let count = 0
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  while (cursor <= end) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      count += 1
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return count
}

function projectFromPace(actualValue: number, progress: number) {
  if (actualValue > 0 && progress > 0) {
    return actualValue / progress
  }

  return undefined
}

function getMonthKeysUpToCurrentMonth(today: Date) {
  return Array.from({ length: today.getMonth() + 1 }, (_, index) => {
    return `${today.getFullYear()}-${pad(index + 1)}`
  })
}

function getMonthKeysBeforeCurrentMonth(today: Date) {
  return Array.from({ length: today.getMonth() }, (_, index) => {
    return `${today.getFullYear()}-${pad(index + 1)}`
  })
}

interface Totals {
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
  profit: number
}

function createEmptyTotals(): Totals {
  return {
    hours: 0,
    invoicedIncome: 0,
    paidIncome: 0,
    expenses: 0,
    profit: 0,
  }
}

function toTotals(source: {
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
}) {
  return {
    hours: source.hours,
    invoicedIncome: source.invoicedIncome,
    paidIncome: source.paidIncome,
    expenses: source.expenses,
    profit: source.invoicedIncome - source.expenses,
  }
}

function addTotals(left: Totals, right: Totals) {
  return toTotals({
    hours: left.hours + right.hours,
    invoicedIncome: left.invoicedIncome + right.invoicedIncome,
    paidIncome: left.paidIncome + right.paidIncome,
    expenses: left.expenses + right.expenses,
  })
}

function hasTotalsData(totals: Totals) {
  return (
    totals.hours > 0 ||
    totals.invoicedIncome > 0 ||
    totals.paidIncome > 0 ||
    totals.expenses > 0
  )
}

function getEntryMonthTotals(entries: DailyEntry[], monthKey: string) {
  const monthEntries = entries.filter((entry) => entry.date.slice(0, 7) === monthKey)

  return toTotals({
    hours: sumEntries(monthEntries, 'hours'),
    invoicedIncome: sumEntries(monthEntries, 'invoicedIncome'),
    paidIncome: sumEntries(monthEntries, 'paidIncome'),
    expenses: sumEntries(monthEntries, 'expenses'),
  })
}

function getMonthTotals(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  monthKey: string,
) {
  const manualSummary = monthlySummaries.find((summary) => summary.monthKey === monthKey)

  if (manualSummary) {
    return toTotals(manualSummary)
  }

  return getEntryMonthTotals(entries, monthKey)
}

function getTotalsForMonthKeys(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  monthKeys: string[],
) {
  return monthKeys.reduce((combined, monthKey) => {
    return addTotals(combined, getMonthTotals(entries, monthlySummaries, monthKey))
  }, createEmptyTotals())
}

function getGoalAnnualNet(settings: Settings) {
  return roundCurrency(settings.monthlyNetGoal * 12)
}

function getGoalAnnualProfit(settings: Settings) {
  const taxRate = getTaxRate(settings)

  if (taxRate >= 0.95) {
    return getGoalAnnualNet(settings)
  }

  return roundCurrency(getGoalAnnualNet(settings) / (1 - taxRate))
}

export interface WeekStats {
  goalHours: number
  actualHours: number
  projectedHours?: number
  hoursLeft: number
}

export interface MonthStats {
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
  profit: number
  cashOutstanding: number
  reserveProjection?: number
  reserveTargetToDate?: number
  reserveGapToDate?: number
}

export interface YearStats {
  goalProfit: number
  goalNet: number
  ytdInvoicedIncome: number
  ytdPaidIncome: number
  ytdExpenses: number
  ytdProfit: number
  projectedProfit?: number
  projectedTax?: number
  projectedNet?: number
  annualReserveTarget?: number
}

export function getCurrentWeekStats(
  entries: DailyEntry[],
  settings: Settings,
  today = new Date(),
): WeekStats {
  const { start, end } = getCurrentWeekRange(today)
  const weekEntries = filterEntriesByRange(entries, start, end)
  const actualHours = sumEntries(weekEntries, 'hours')
  const workDaysLogged = getUniqueWorkDays(weekEntries)
  const remainingStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const remainingWeekdays = remainingStart <= end ? countWeekdays(remainingStart, end) : 0
  const dailyHoursEstimate =
    workDaysLogged > 0 ? actualHours / workDaysLogged : settings.defaultShiftHours
  const projectedHours = actualHours + remainingWeekdays * dailyHoursEstimate

  return {
    goalHours: roundHours(settings.weeklyHoursGoal),
    actualHours: roundHours(actualHours),
    projectedHours: weekEntries.length > 0 ? roundHours(projectedHours) : undefined,
    hoursLeft: roundHours(Math.max(0, settings.weeklyHoursGoal - actualHours)),
  }
}

export function getCurrentYearStats(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  settings: Settings,
  today = new Date(),
): YearStats {
  const currentMonthEnd = getCurrentMonthRange(today).end
  const elapsedYearMonths = Math.max(getElapsedYearMonths(today, currentMonthEnd), 1 / 12)
  const yearProgress = Math.min(1, elapsedYearMonths / 12)
  const monthKeys = getMonthKeysUpToCurrentMonth(today)
  const ytdTotals = getTotalsForMonthKeys(entries, monthlySummaries, monthKeys)
  const hasYearData = hasTotalsData(ytdTotals)
  const projectedProfit =
    !hasYearData ? undefined : projectFromPace(ytdTotals.profit, yearProgress)
  const projectedTax =
    projectedProfit === undefined ? undefined : getTaxFromProfit(projectedProfit, settings)
  const projectedNet =
    projectedProfit === undefined || projectedTax === undefined
      ? undefined
      : projectedProfit - projectedTax

  return {
    goalProfit: getGoalAnnualProfit(settings),
    goalNet: getGoalAnnualNet(settings),
    ytdInvoicedIncome: roundCurrency(ytdTotals.invoicedIncome),
    ytdPaidIncome: roundCurrency(ytdTotals.paidIncome),
    ytdExpenses: roundCurrency(ytdTotals.expenses),
    ytdProfit: roundCurrency(ytdTotals.profit),
    projectedProfit: projectedProfit === undefined ? undefined : roundCurrency(projectedProfit),
    projectedTax: projectedTax === undefined ? undefined : roundCurrency(projectedTax),
    projectedNet: projectedNet === undefined ? undefined : roundCurrency(projectedNet),
    annualReserveTarget:
      projectedTax === undefined ? undefined : getReserveTarget(projectedTax, settings),
  }
}

export function getCurrentMonthStats(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  settings: Settings,
  today = new Date(),
): MonthStats {
  const currentMonthKey = toMonthKey(today)
  const currentMonthEnd = getCurrentMonthRange(today).end
  const currentMonthTotals = getMonthTotals(entries, monthlySummaries, currentMonthKey)
  const year = getCurrentYearStats(entries, monthlySummaries, settings, today)
  const elapsedYearProgress = Math.min(1, getElapsedYearMonths(today, currentMonthEnd) / 12)
  const monthEndYearProgress = Math.min(1, (today.getMonth() + 1) / 12)
  const totalsBeforeCurrentMonth = getTotalsForMonthKeys(
    entries,
    monthlySummaries,
    getMonthKeysBeforeCurrentMonth(today),
  )
  const reserveBasisBeforeCurrentMonth = getReserveTarget(
    getTaxFromProfit(totalsBeforeCurrentMonth.profit, settings),
    settings,
  )
  const reserveBasisToDate = getReserveTarget(
    getTaxFromProfit(year.ytdProfit, settings),
    settings,
  )
  const reserveTargetToDate =
    year.annualReserveTarget === undefined
      ? undefined
      : year.annualReserveTarget * elapsedYearProgress
  const reserveGapToDate =
    reserveTargetToDate === undefined
      ? undefined
      : Math.max(0, reserveTargetToDate - reserveBasisToDate)
  const reserveProjection =
    year.annualReserveTarget === undefined
      ? undefined
      : Math.max(0, year.annualReserveTarget * monthEndYearProgress - reserveBasisBeforeCurrentMonth)

  return {
    hours: roundHours(currentMonthTotals.hours),
    invoicedIncome: roundCurrency(currentMonthTotals.invoicedIncome),
    paidIncome: roundCurrency(currentMonthTotals.paidIncome),
    expenses: roundCurrency(currentMonthTotals.expenses),
    profit: roundCurrency(currentMonthTotals.profit),
    cashOutstanding: roundCurrency(
      Math.max(0, currentMonthTotals.invoicedIncome - currentMonthTotals.paidIncome),
    ),
    reserveProjection:
      reserveProjection === undefined ? undefined : roundCurrency(reserveProjection),
    reserveTargetToDate:
      reserveTargetToDate === undefined ? undefined : roundCurrency(reserveTargetToDate),
    reserveGapToDate:
      reserveGapToDate === undefined ? undefined : roundCurrency(reserveGapToDate),
  }
}

export function getBackfillMonthOption(monthlySummaries: MonthlySummary[]) {
  if (monthlySummaries.length === 0) {
    return '2026-01'
  }

  const latest = monthlySummaries
    .slice()
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey))
    .at(-1)

  if (!latest) {
    return '2026-01'
  }

  const latestDate = parseMonthKey(latest.monthKey)
  latestDate.setMonth(latestDate.getMonth() + 1)
  return toMonthKey(latestDate)
}

export function sortMonthlySummaries(monthlySummaries: MonthlySummary[]) {
  const byMonth = new Map<string, MonthlySummary>()

  monthlySummaries.forEach((summary) => {
    byMonth.set(summary.monthKey, summary)
  })

  return Array.from(byMonth.values()).sort((left, right) => left.monthKey.localeCompare(right.monthKey))
}

export function getDefaultHourlyRateForSettings(settings: Settings) {
  return roundCurrency(getDefaultHourlyRate(settings))
}
