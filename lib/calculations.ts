import { estimateAnnualTaxFor2026, estimateRequiredAnnualBusinessProfitForTargetNet2026 } from './tax-engine'
import { defaultSettings } from './default-state'
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

function isWeekday(date: Date) {
  const day = date.getDay()
  return day !== 0 && day !== 6
}

function isPositiveNumber(value: number | null) {
  return typeof value === 'number' && value > 0
}

function isNonNegativeNumber(value: number | null) {
  return typeof value === 'number' && value >= 0
}

function getTargetNetMonth(settings: Settings) {
  return settings.targetNetMonth ?? 0
}

function getWeeklyHoursTarget(settings: Settings) {
  return settings.weeklyHoursTarget ?? 0
}

function getDefaultShiftIncome(settings: Settings) {
  return settings.defaultShiftIncome ?? 0
}

function getDefaultShiftHours(settings: Settings) {
  return settings.defaultShiftHours ?? 0
}

function getReserveBufferPercent(settings: Settings) {
  return settings.reserveBufferPercent ?? 0
}

function getSelfEmployedDeductionFlag(settings: Settings) {
  return settings.qualifiesForSelfEmployedDeduction ?? false
}

function hasValidBaseConfiguration(settings: Settings) {
  return (
    isPositiveNumber(settings.targetNetMonth) &&
    isPositiveNumber(settings.weeklyHoursTarget) &&
    isPositiveNumber(settings.defaultShiftIncome) &&
    isPositiveNumber(settings.defaultShiftHours) &&
    isNonNegativeNumber(settings.reserveBufferPercent) &&
    typeof settings.qualifiesForSelfEmployedDeduction === 'boolean'
  )
}

function isUsingStarterBaseSettings(settings: Settings) {
  return (
    settings.targetNetMonth === defaultSettings.targetNetMonth &&
    settings.weeklyHoursTarget === defaultSettings.weeklyHoursTarget &&
    settings.defaultShiftIncome === defaultSettings.defaultShiftIncome &&
    settings.defaultShiftHours === defaultSettings.defaultShiftHours &&
    settings.reserveBufferPercent === defaultSettings.reserveBufferPercent &&
    settings.qualifiesForSelfEmployedDeduction ===
      defaultSettings.qualifiesForSelfEmployedDeduction
  )
}

export interface CurrentMonthWeekdayCoverage {
  complete: boolean
  elapsedWeekdaysBeforeToday: number
  loggedWeekdaysBeforeToday: number
  missingWeekdaysBeforeToday: number
}

export interface SetupCompleteness {
  baseConfigurationComplete: boolean
  isUsingStarterBaseSettings: boolean
  previousMonthsComplete: boolean
}

export function isMissingHistoricalData(
  monthlySummaries: MonthlySummary[],
  today = new Date(),
) {
  return getMissingPreviousMonthSummaryKeys(monthlySummaries, today).length > 0
}

export function getMissingPreviousMonthSummaryKeys(
  monthlySummaries: MonthlySummary[],
  today = new Date(),
) {
  if (today.getMonth() === 0) {
    return []
  }

  const currentYear = today.getFullYear()
  const existingMonthKeys = new Set(
    monthlySummaries
      .filter((summary) => summary.monthKey.startsWith(`${currentYear}-`))
      .map((summary) => summary.monthKey),
  )

  return Array.from({ length: today.getMonth() }, (_, index) => {
    return `${currentYear}-${pad(index + 1)}`
  }).filter((monthKey) => !existingMonthKeys.has(monthKey))
}

export function getCurrentMonthWeekdayCoverage(
  entries: DailyEntry[],
  today = new Date(),
): CurrentMonthWeekdayCoverage {
  const { start } = getCurrentMonthRange(today)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)

  if (yesterday < start) {
    return {
      complete: true,
      elapsedWeekdaysBeforeToday: 0,
      loggedWeekdaysBeforeToday: 0,
      missingWeekdaysBeforeToday: 0,
    }
  }

  const elapsedWeekdays = countWeekdays(start, yesterday)
  const currentMonthEntryDays = new Set(
    entries
      .filter((entry) => entry.date >= toDateKey(start) && entry.date < toDateKey(today))
      .filter((entry) => isWeekday(parseDateKey(entry.date)))
      .map((entry) => entry.date),
  )

  const loggedWeekdaysBeforeToday = currentMonthEntryDays.size
  const missingWeekdaysBeforeToday = Math.max(0, elapsedWeekdays - loggedWeekdaysBeforeToday)
  const complete =
    elapsedWeekdays === 0 ||
    missingWeekdaysBeforeToday <= Math.max(1, Math.floor(elapsedWeekdays / 3))

  return {
    complete,
    elapsedWeekdaysBeforeToday: elapsedWeekdays,
    loggedWeekdaysBeforeToday,
    missingWeekdaysBeforeToday,
  }
}

export function isCurrentMonthIncomplete(entries: DailyEntry[], today = new Date()) {
  return !getCurrentMonthWeekdayCoverage(entries, today).complete
}

export function getEarliestMissingCurrentMonthWeekday(
  entries: DailyEntry[],
  today = new Date(),
) {
  const { start } = getCurrentMonthRange(today)
  const todayKey = toDateKey(today)
  const entryDays = new Set(entries.map((entry) => entry.date))
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  while (toDateKey(cursor) < todayKey) {
    const dateKey = toDateKey(cursor)
    if (isWeekday(cursor) && !entryDays.has(dateKey)) {
      return dateKey
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return undefined
}

export function getSetupCompleteness(
  settings: Settings,
  monthlySummaries: MonthlySummary[],
  today = new Date(),
): SetupCompleteness {
  return {
    baseConfigurationComplete: hasValidBaseConfiguration(settings),
    isUsingStarterBaseSettings: isUsingStarterBaseSettings(settings),
    previousMonthsComplete: !isMissingHistoricalData(monthlySummaries, today),
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

function getMonthProgress(today: Date, endOfMonth: Date) {
  return today.getDate() / endOfMonth.getDate()
}


function getElapsedYearMonths(today: Date, endOfMonth: Date) {
  return today.getMonth() + getMonthProgress(today, endOfMonth)
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

function getUniqueWorkDays(entries: DailyEntry[]) {
  return new Set(
    entries
      .filter((entry) => entry.dayStatus !== 'no_work' && entry.hours > 0)
      .map((entry) => entry.date),
  ).size
}

function projectFromPace(actualValue: number, progress: number) {
  if (actualValue > 0 && progress > 0) {
    return actualValue / progress
  }

  return undefined
}

function projectFromPaceOrZero(actualValue: number, progress: number) {
  if (progress <= 0) {
    return 0
  }

  return actualValue > 0 ? actualValue / progress : 0
}

function getGoalAnnualBusinessProfit(settings: Settings) {
  return estimateRequiredAnnualBusinessProfitForTargetNet2026({
    targetAnnualNet: getTargetNetMonth(settings) * 12,
    qualifiesForSelfEmployedDeduction: getSelfEmployedDeductionFlag(settings),
  })
}

function getReserveTarget(estimatedAnnualTax: number, settings: Settings) {
  return estimatedAnnualTax * (1 + Math.max(0, getReserveBufferPercent(settings)) / 100)
}

interface BusinessTotals {
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
  profit: number
}

function createEmptyBusinessTotals(): BusinessTotals {
  return {
    hours: 0,
    invoicedIncome: 0,
    paidIncome: 0,
    expenses: 0,
    profit: 0,
  }
}

function toBusinessTotals(input: {
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
}): BusinessTotals {
  return {
    hours: input.hours,
    invoicedIncome: input.invoicedIncome,
    paidIncome: input.paidIncome,
    expenses: input.expenses,
    profit: input.invoicedIncome - input.expenses,
  }
}

function combineBusinessTotals(left: BusinessTotals, right: BusinessTotals) {
  return toBusinessTotals({
    hours: left.hours + right.hours,
    invoicedIncome: left.invoicedIncome + right.invoicedIncome,
    paidIncome: left.paidIncome + right.paidIncome,
    expenses: left.expenses + right.expenses,
  })
}

function hasBusinessData(totals: BusinessTotals) {
  return (
    totals.hours > 0 ||
    totals.invoicedIncome > 0 ||
    totals.paidIncome > 0 ||
    totals.expenses > 0
  )
}

function getMonthKeysUntilCurrentMonth(today: Date) {
  return Array.from({ length: today.getMonth() + 1 }, (_, index) => {
    return `${today.getFullYear()}-${pad(index + 1)}`
  })
}

function getMonthTotalsFromEntries(entries: DailyEntry[], monthKey: string) {
  return getMonthTotalsForEntryList(entries.filter((entry) => entry.date.slice(0, 7) === monthKey))
}

function getMonthTotalsForEntryList(entries: DailyEntry[]) {
  return toBusinessTotals({
    hours: sumEntries(entries, 'hours'),
    invoicedIncome: sumEntries(entries, 'invoicedIncome'),
    paidIncome: sumEntries(entries, 'paidIncome'),
    expenses: sumEntries(entries, 'expenses'),
  })
}

function getMonthTotals(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  monthKey: string,
) {
  const monthEntries = entries.filter((entry) => entry.date.slice(0, 7) === monthKey)

  // Specific daily entries always win for a month. Manual summaries are only the fallback.
  if (monthEntries.length > 0) {
    return getMonthTotalsForEntryList(monthEntries)
  }

  const monthlySummary = monthlySummaries.find((summary) => summary.monthKey === monthKey)

  if (monthlySummary) {
    return toBusinessTotals(monthlySummary)
  }

  return getMonthTotalsFromEntries(entries, monthKey)
}

function getTotalsForMonths(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  monthKeys: string[],
) {
  return monthKeys.reduce((combined, monthKey) => {
    return combineBusinessTotals(combined, getMonthTotals(entries, monthlySummaries, monthKey))
  }, createEmptyBusinessTotals())
}

function getAnnualReserveModel(
  totals: BusinessTotals,
  yearProgress: number,
  settings: Settings,
) {
  if (!hasBusinessData(totals) || yearProgress <= 0) {
    return undefined
  }

  const annualBusinessIncome = projectFromPaceOrZero(totals.invoicedIncome, yearProgress)
  const annualBusinessExpenses = projectFromPaceOrZero(totals.expenses, yearProgress)
  const annualTaxEstimate = estimateAnnualTaxFor2026({
    annualBusinessIncome,
    annualBusinessExpenses,
    qualifiesForSelfEmployedDeduction: getSelfEmployedDeductionFlag(settings),
  })

  return {
    annualBusinessIncome,
    annualBusinessExpenses,
    projectedAnnualProfit: annualBusinessIncome - annualBusinessExpenses,
    estimatedAnnualTax: annualTaxEstimate.estimatedAnnualTax,
    projectedAnnualNet: annualTaxEstimate.projectedAnnualNet,
    projectedMonthlyNet: annualTaxEstimate.projectedMonthlyNet,
    annualReserveTarget: getReserveTarget(annualTaxEstimate.estimatedAnnualTax, settings),
  }
}

function projectCurrentMonthTotals(
  currentMonthTotals: BusinessTotals,
  currentMonthProgress: number,
) {
  if (!hasBusinessData(currentMonthTotals) || currentMonthProgress <= 0) {
    return createEmptyBusinessTotals()
  }

  return toBusinessTotals({
    hours: projectFromPaceOrZero(currentMonthTotals.hours, currentMonthProgress),
    invoicedIncome: projectFromPaceOrZero(currentMonthTotals.invoicedIncome, currentMonthProgress),
    paidIncome: projectFromPaceOrZero(currentMonthTotals.paidIncome, currentMonthProgress),
    expenses: projectFromPaceOrZero(currentMonthTotals.expenses, currentMonthProgress),
  })
}

function getPreviousMonthKeys(today: Date) {
  return Array.from({ length: today.getMonth() }, (_, index) => {
    return `${today.getFullYear()}-${pad(index + 1)}`
  })
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
  reservedTaxFromPreviousMonths?: number
  forecastCalculatedTaxToSaveThisMonth?: number
}

export interface YearStats {
  goalAnnualBusinessProfit: number
  goalAnnualNet: number
  ytdInvoicedIncome: number
  ytdPaidIncome: number
  ytdExpenses: number
  ytdProfit: number
  projectedAnnualProfit?: number
  estimatedAnnualTax?: number
  projectedAnnualNet?: number
  projectedMonthlyNet?: number
  annualReserveTarget?: number
}

export function getCurrentWeekStats(
  entries: DailyEntry[],
  settings: Settings,
  today = new Date(),
): WeekStats {
  const { start, end } = getCurrentWeekRange(today)
  const weekEntries = filterEntriesByRange(entries, start, end)
  const workedWeekEntries = weekEntries.filter((entry) => entry.dayStatus !== 'no_work')
  const actualHours = sumEntries(weekEntries, 'hours')
  const workDaysLogged = getUniqueWorkDays(weekEntries)
  const remainingStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const remainingWeekdays = remainingStart <= end ? countWeekdays(remainingStart, end) : 0
  const dailyHoursEstimate =
    workDaysLogged > 0 ? actualHours / workDaysLogged : getDefaultShiftHours(settings)
  const projectedHours = actualHours + remainingWeekdays * dailyHoursEstimate

  return {
    goalHours: roundHours(getWeeklyHoursTarget(settings)),
    actualHours: roundHours(actualHours),
    projectedHours: workedWeekEntries.length > 0 ? roundHours(projectedHours) : undefined,
    hoursLeft: roundHours(Math.max(0, getWeeklyHoursTarget(settings) - actualHours)),
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
  const monthKeys = getMonthKeysUntilCurrentMonth(today)
  const yearToDateTotals = getTotalsForMonths(entries, monthlySummaries, monthKeys)
  const hasYearData = hasBusinessData(yearToDateTotals)
  const annualReserveModel = getAnnualReserveModel(yearToDateTotals, yearProgress, settings)

  return {
    goalAnnualBusinessProfit: getGoalAnnualBusinessProfit(settings),
    goalAnnualNet: roundCurrency(getTargetNetMonth(settings) * 12),
    ytdInvoicedIncome: roundCurrency(yearToDateTotals.invoicedIncome),
    ytdPaidIncome: roundCurrency(yearToDateTotals.paidIncome),
    ytdExpenses: roundCurrency(yearToDateTotals.expenses),
    ytdProfit: roundCurrency(yearToDateTotals.profit),
    projectedAnnualProfit:
      !hasYearData || annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.projectedAnnualProfit),
    estimatedAnnualTax:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.estimatedAnnualTax),
    projectedAnnualNet:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.projectedAnnualNet),
    projectedMonthlyNet:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.projectedMonthlyNet),
    annualReserveTarget:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.annualReserveTarget),
  }
}

export function getCurrentMonthStats(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  settings: Settings,
  today = new Date(),
): MonthStats {
  const currentMonthTotals = getMonthTotals(entries, monthlySummaries, toMonthKey(today))
  const currentMonthProgress = getMonthProgress(today, getCurrentMonthRange(today).end)
  const completedPreviousMonths = today.getMonth()
  const previousMonthFraction = completedPreviousMonths / 12
  const currentMonthFraction = (completedPreviousMonths + 1) / 12
  const previousMonthKeys = getPreviousMonthKeys(today)
  const previousMonthsTotals = getTotalsForMonths(entries, monthlySummaries, previousMonthKeys)
  const previousMonthsReserveModel = getAnnualReserveModel(
    previousMonthsTotals,
    previousMonthFraction,
    settings,
  )
  const reservedTaxFromPreviousMonths =
    previousMonthsReserveModel === undefined
      ? 0
      : previousMonthsReserveModel.annualReserveTarget * previousMonthFraction
  const currentMonthProjectedTotals = projectCurrentMonthTotals(
    currentMonthTotals,
    currentMonthProgress,
  )
  const monthEndTotals = combineBusinessTotals(previousMonthsTotals, currentMonthProjectedTotals)
  const monthEndReserveModel = getAnnualReserveModel(
    monthEndTotals,
    currentMonthFraction,
    settings,
  )
  const forecastCalculatedTaxToSaveThisMonth =
    monthEndReserveModel === undefined
      ? 0
      : Math.max(
          0,
          monthEndReserveModel.annualReserveTarget * currentMonthFraction -
            reservedTaxFromPreviousMonths,
        )

  return {
    hours: roundHours(currentMonthTotals.hours),
    invoicedIncome: roundCurrency(currentMonthTotals.invoicedIncome),
    paidIncome: roundCurrency(currentMonthTotals.paidIncome),
    expenses: roundCurrency(currentMonthTotals.expenses),
    profit: roundCurrency(currentMonthTotals.profit),
    cashOutstanding: roundCurrency(
      Math.max(0, currentMonthTotals.invoicedIncome - currentMonthTotals.paidIncome),
    ),
    reservedTaxFromPreviousMonths: roundCurrency(reservedTaxFromPreviousMonths),
    forecastCalculatedTaxToSaveThisMonth: roundCurrency(
      forecastCalculatedTaxToSaveThisMonth,
    ),
  }
}

export function getBackfillMonthOption(monthlySummaries: MonthlySummary[]) {
  const missingPreviousMonths = getMissingPreviousMonthSummaryKeys(monthlySummaries)

  if (missingPreviousMonths.length > 0) {
    return missingPreviousMonths[0]
  }

  if (monthlySummaries.length === 0) {
    return `${new Date().getFullYear()}-01`
  }

  const latestMonth = monthlySummaries
    .slice()
    .sort((left, right) => left.monthKey.localeCompare(right.monthKey))
    .at(-1)

  if (!latestMonth) {
    return `${new Date().getFullYear()}-01`
  }

  const nextMonthDate = parseMonthKey(latestMonth.monthKey)
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1)
  return toMonthKey(nextMonthDate)
}

export function sortMonthlySummaries(monthlySummaries: MonthlySummary[]) {
  const byMonthKey = new Map<string, MonthlySummary>()

  monthlySummaries.forEach((monthlySummary) => {
    byMonthKey.set(monthlySummary.monthKey, monthlySummary)
  })

  return Array.from(byMonthKey.values()).sort((left, right) => right.monthKey.localeCompare(left.monthKey))
}
