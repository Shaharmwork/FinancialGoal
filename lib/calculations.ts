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

function getVacationDaysPerYear(settings: Settings) {
  return settings.vacationDaysPerYear ?? 0
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
    typeof settings.qualifiesForSelfEmployedDeduction === 'boolean' &&
    (settings.vacationDaysPerYear === null || isNonNegativeNumber(settings.vacationDaysPerYear))
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
      defaultSettings.qualifiesForSelfEmployedDeduction &&
    settings.vacationDaysPerYear === defaultSettings.vacationDaysPerYear
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
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  today = new Date(),
) {
  return getMissingPreviousMonthSummaryKeys(entries, monthlySummaries, today).length > 0
}

export function getMissingPreviousMonthSummaryKeys(
  entries: DailyEntry[],
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
  const reportedMonthKeys = new Set(
    entries
      .filter((entry) => entry.date.startsWith(`${currentYear}-`))
      .map((entry) => entry.date.slice(0, 7)),
  )

  return Array.from({ length: today.getMonth() }, (_, index) => {
    return `${currentYear}-${pad(index + 1)}`
  }).filter((monthKey) => {
    return !existingMonthKeys.has(monthKey) && !reportedMonthKeys.has(monthKey)
  })
}

export function getEarliestMissingPreviousMonthWeekday(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  today = new Date(),
) {
  if (today.getMonth() === 0) {
    return undefined
  }

  const currentYear = today.getFullYear()
  const summaryMonthKeys = new Set(
    monthlySummaries
      .filter((summary) => summary.monthKey.startsWith(`${currentYear}-`))
      .map((summary) => summary.monthKey),
  )
  const entryDays = new Set(entries.map((entry) => entry.date))
  const entryMonthKeys = new Set(
    entries
      .filter((entry) => entry.date.startsWith(`${currentYear}-`))
      .map((entry) => entry.date.slice(0, 7)),
  )

  for (let monthIndex = 0; monthIndex < today.getMonth(); monthIndex += 1) {
    const monthKey = `${currentYear}-${pad(monthIndex + 1)}`

    if (summaryMonthKeys.has(monthKey) || !entryMonthKeys.has(monthKey)) {
      continue
    }

    const cursor = new Date(currentYear, monthIndex, 1)
    const monthEnd = new Date(currentYear, monthIndex + 1, 0)

    while (cursor <= monthEnd) {
      const dateKey = toDateKey(cursor)

      if (isWeekday(cursor) && !entryDays.has(dateKey)) {
        return dateKey
      }

      cursor.setDate(cursor.getDate() + 1)
    }
  }

  return undefined
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
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  today = new Date(),
): SetupCompleteness {
  return {
    baseConfigurationComplete: hasValidBaseConfiguration(settings),
    isUsingStarterBaseSettings: isUsingStarterBaseSettings(settings),
    previousMonthsComplete: !isMissingHistoricalData(entries, monthlySummaries, today),
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

function getEasterSunday(year: number) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

// TODO: Replace this static NL baseline with a country/year holiday provider if localization expands.
export function getDutchPublicHolidayWeekdays(year: number) {
  const easterSunday = getEasterSunday(year)
  const holidays = [
    new Date(year, 0, 1),
    addDays(easterSunday, -2),
    addDays(easterSunday, 1),
    new Date(year, 3, 27),
    new Date(year, 4, 5),
    addDays(easterSunday, 39),
    addDays(easterSunday, 50),
    new Date(year, 11, 25),
    new Date(year, 11, 26),
  ]

  return holidays.filter(isWeekday)
}

function countYearWeekdays(year: number) {
  return countWeekdays(new Date(year, 0, 1), new Date(year, 11, 31))
}

export interface PlanningConsistency {
  targetAnnualNet: number
  projectedAnnualNet: number
  projectedAnnualBeforeTax: number
  difference: number
  availableWorkdays: number
  nlPublicHolidayWeekdays: number
  plannedYearlyHours: number
}

export function getPlanningConsistency(settings: Settings, today = new Date()) {
  const targetNetMonth = getTargetNetMonth(settings)
  const weeklyHoursTarget = getWeeklyHoursTarget(settings)
  const defaultShiftHours = getDefaultShiftHours(settings)
  const defaultShiftIncome = getDefaultShiftIncome(settings)
  const vacationDaysPerYear = getVacationDaysPerYear(settings)

  if (
    targetNetMonth <= 0 ||
    weeklyHoursTarget <= 0 ||
    defaultShiftHours <= 0 ||
    defaultShiftIncome <= 0 ||
    vacationDaysPerYear < 0
  ) {
    return undefined
  }

  const year = today.getFullYear()
  const nlPublicHolidayWeekdays = getDutchPublicHolidayWeekdays(year).length
  const availableWorkdays = Math.max(
    0,
    countYearWeekdays(year) - vacationDaysPerYear,
  )
  const plannedYearlyHours = (availableWorkdays / 5) * weeklyHoursTarget
  const plannedShifts = plannedYearlyHours / defaultShiftHours
  const projectedAnnualBeforeTax = plannedShifts * defaultShiftIncome
  const taxEstimate = estimateAnnualTaxFor2026({
    annualBusinessIncome: projectedAnnualBeforeTax,
    annualBusinessExpenses: 0,
    qualifiesForSelfEmployedDeduction: getSelfEmployedDeductionFlag(settings),
  })
  const targetAnnualNet = targetNetMonth * 12
  const projectedAnnualNet = taxEstimate.projectedAnnualNet

  return {
    targetAnnualNet: roundCurrency(targetAnnualNet),
    projectedAnnualNet: roundCurrency(projectedAnnualNet),
    projectedAnnualBeforeTax: roundCurrency(projectedAnnualBeforeTax),
    difference: roundCurrency(projectedAnnualNet - targetAnnualNet),
    availableWorkdays: roundHours(availableWorkdays),
    nlPublicHolidayWeekdays,
    plannedYearlyHours: roundHours(plannedYearlyHours),
  }
}

function getUniqueWorkDays(entries: DailyEntry[]) {
  return new Set(
    entries
      .filter((entry) => (entry.dayStatus ?? 'worked') === 'worked' && entry.hours > 0)
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

function getRequiredAnnualBeforeTaxAmount(settings: Settings) {
  return estimateRequiredAnnualBusinessProfitForTargetNet2026({
    targetAnnualNet: getTargetNetMonth(settings) * 12,
    qualifiesForSelfEmployedDeduction: getSelfEmployedDeductionFlag(settings),
  })
}

function getReserveTarget(estimatedAnnualTax: number, settings: Settings) {
  return estimatedAnnualTax * (1 + Math.max(0, getReserveBufferPercent(settings)) / 100)
}

function getRemainingTaxReserveTarget(remainingTaxToSave: number, settings: Settings) {
  return remainingTaxToSave * (1 + Math.max(0, getReserveBufferPercent(settings)) / 100)
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
  hours?: number | null
  invoicedIncome?: number | null
  paidIncome?: number | null
  expenses?: number | null
}): BusinessTotals {
  const hours = input.hours ?? 0
  const invoicedIncome = input.invoicedIncome ?? 0
  const paidIncome = input.paidIncome ?? 0
  const expenses = input.expenses ?? 0

  return {
    hours,
    invoicedIncome,
    paidIncome,
    expenses,
    profit: invoicedIncome - expenses,
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

interface EmploymentTotals {
  hours: number
  grossSalary: number
  netSalaryReceived: number
  taxAlreadyWithheld: number
}

function createEmptyEmploymentTotals(): EmploymentTotals {
  return {
    hours: 0,
    grossSalary: 0,
    netSalaryReceived: 0,
    taxAlreadyWithheld: 0,
  }
}

function toEmploymentTotals(input: {
  hours?: number | null
  grossSalary?: number | null
  netSalaryReceived?: number | null
  taxAlreadyWithheld?: number | null
}): EmploymentTotals {
  return {
    hours: input.hours ?? 0,
    grossSalary: input.grossSalary ?? 0,
    netSalaryReceived: input.netSalaryReceived ?? 0,
    taxAlreadyWithheld: input.taxAlreadyWithheld ?? 0,
  }
}

function combineEmploymentTotals(left: EmploymentTotals, right: EmploymentTotals) {
  return toEmploymentTotals({
    hours: left.hours + right.hours,
    grossSalary: left.grossSalary + right.grossSalary,
    netSalaryReceived: left.netSalaryReceived + right.netSalaryReceived,
    taxAlreadyWithheld: left.taxAlreadyWithheld + right.taxAlreadyWithheld,
  })
}

function hasEmploymentData(totals: EmploymentTotals) {
  return (
    totals.hours > 0 ||
    totals.grossSalary > 0 ||
    totals.netSalaryReceived > 0 ||
    totals.taxAlreadyWithheld > 0
  )
}

interface YearlyIncomeTotals {
  business: BusinessTotals
  employment: EmploymentTotals
}

function createEmptyYearlyIncomeTotals(): YearlyIncomeTotals {
  return {
    business: createEmptyBusinessTotals(),
    employment: createEmptyEmploymentTotals(),
  }
}

function combineYearlyIncomeTotals(left: YearlyIncomeTotals, right: YearlyIncomeTotals) {
  return {
    business: combineBusinessTotals(left.business, right.business),
    employment: combineEmploymentTotals(left.employment, right.employment),
  }
}

function hasYearlyIncomeData(totals: YearlyIncomeTotals) {
  return hasBusinessData(totals.business) || hasEmploymentData(totals.employment)
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

  if (monthlySummary?.monthType === 'business') {
    return toBusinessTotals(monthlySummary)
  }

  return getMonthTotalsFromEntries(entries, monthKey)
}

function getEmploymentTotalsFromSummary(
  monthlySummaries: MonthlySummary[],
  monthKey: string,
) {
  const monthlySummary = monthlySummaries.find((summary) => summary.monthKey === monthKey)

  if (monthlySummary?.monthType === 'employment') {
    return toEmploymentTotals(monthlySummary)
  }

  return createEmptyEmploymentTotals()
}

function getYearlyIncomeTotalsForMonth(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  monthKey: string,
) {
  return {
    business: getMonthTotals(entries, monthlySummaries, monthKey),
    employment: getEmploymentTotalsFromSummary(monthlySummaries, monthKey),
  }
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

function getYearlyIncomeTotalsForMonths(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  monthKeys: string[],
) {
  return monthKeys.reduce((combined, monthKey) => {
    return combineYearlyIncomeTotals(
      combined,
      getYearlyIncomeTotalsForMonth(entries, monthlySummaries, monthKey),
    )
  }, createEmptyYearlyIncomeTotals())
}

function getAnnualReserveModel(
  totals: YearlyIncomeTotals,
  yearProgress: number,
  settings: Settings,
) {
  if (!hasYearlyIncomeData(totals) || yearProgress <= 0) {
    return undefined
  }

  const annualBusinessIncome = projectFromPaceOrZero(totals.business.invoicedIncome, yearProgress)
  const annualBusinessExpenses = projectFromPaceOrZero(totals.business.expenses, yearProgress)
  const annualEmploymentGrossSalary = totals.employment.grossSalary
  const annualTaxAlreadyWithheld = totals.employment.taxAlreadyWithheld
  const annualTaxEstimate = estimateAnnualTaxFor2026({
    annualBusinessIncome,
    annualBusinessExpenses,
    annualEmploymentGrossSalary,
    annualTaxAlreadyWithheld,
    qualifiesForSelfEmployedDeduction: getSelfEmployedDeductionFlag(settings),
  })

  return {
    annualBusinessIncome,
    annualBusinessExpenses,
    annualEmploymentGrossSalary,
    annualTaxAlreadyWithheld,
    projectedAnnualProfit: annualBusinessIncome - annualBusinessExpenses,
    projectedAnnualPreTaxIncome: annualTaxEstimate.annualCombinedPreTaxIncome,
    estimatedAnnualTax: annualTaxEstimate.estimatedAnnualTax,
    remainingTaxToSave: annualTaxEstimate.remainingTaxToSave,
    projectedAnnualNet: annualTaxEstimate.projectedAnnualNet,
    projectedMonthlyNet: annualTaxEstimate.projectedMonthlyNet,
    annualReserveTarget: getReserveTarget(annualTaxEstimate.estimatedAnnualTax, settings),
    remainingTaxReserveTarget: getRemainingTaxReserveTarget(
      annualTaxEstimate.remainingTaxToSave,
      settings,
    ),
  }
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
  requiredAnnualBeforeTaxAmount: number
  goalAnnualNet: number
  ytdInvoicedIncome: number
  ytdPaidIncome: number
  ytdExpenses: number
  ytdProfit: number
  ytdEmploymentGrossSalary: number
  ytdEmploymentNetSalaryReceived: number
  ytdTaxAlreadyWithheld: number
  projectedAnnualProfit?: number
  projectedAnnualPreTaxIncome?: number
  estimatedAnnualTax?: number
  remainingTaxToSave?: number
  projectedAnnualNet?: number
  projectedMonthlyNet?: number
  annualReserveTarget?: number
  remainingTaxReserveTarget?: number
}

export function getCurrentWeekStats(
  entries: DailyEntry[],
  settings: Settings,
  today = new Date(),
): WeekStats {
  const { start, end } = getCurrentWeekRange(today)
  const weekEntries = filterEntriesByRange(entries, start, end)
  const workedWeekEntries = weekEntries.filter((entry) => (entry.dayStatus ?? 'worked') === 'worked')
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
  const yearToDateTotals = getYearlyIncomeTotalsForMonths(entries, monthlySummaries, monthKeys)
  const hasYearData = hasYearlyIncomeData(yearToDateTotals)
  const annualReserveModel = getAnnualReserveModel(yearToDateTotals, yearProgress, settings)

  return {
    requiredAnnualBeforeTaxAmount: getRequiredAnnualBeforeTaxAmount(settings),
    goalAnnualNet: roundCurrency(getTargetNetMonth(settings) * 12),
    ytdInvoicedIncome: roundCurrency(yearToDateTotals.business.invoicedIncome),
    ytdPaidIncome: roundCurrency(yearToDateTotals.business.paidIncome),
    ytdExpenses: roundCurrency(yearToDateTotals.business.expenses),
    ytdProfit: roundCurrency(yearToDateTotals.business.profit),
    ytdEmploymentGrossSalary: roundCurrency(yearToDateTotals.employment.grossSalary),
    ytdEmploymentNetSalaryReceived: roundCurrency(yearToDateTotals.employment.netSalaryReceived),
    ytdTaxAlreadyWithheld: roundCurrency(yearToDateTotals.employment.taxAlreadyWithheld),
    projectedAnnualProfit:
      !hasYearData || annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.projectedAnnualProfit),
    projectedAnnualPreTaxIncome:
      !hasYearData || annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.projectedAnnualPreTaxIncome),
    estimatedAnnualTax:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.estimatedAnnualTax),
    remainingTaxToSave:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.remainingTaxToSave),
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
    remainingTaxReserveTarget:
      annualReserveModel === undefined
        ? undefined
        : roundCurrency(annualReserveModel.remainingTaxReserveTarget),
  }
}

export function getCurrentMonthStats(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
  settings: Settings,
  today = new Date(),
): MonthStats {
  const currentMonthTotals = getMonthTotals(entries, monthlySummaries, toMonthKey(today))
  const completedPreviousMonths = today.getMonth()
  const previousMonthFraction = completedPreviousMonths / 12
  const currentMonthFraction = (completedPreviousMonths + 1) / 12
  const previousMonthKeys = getPreviousMonthKeys(today)
  const previousMonthsTotals = getYearlyIncomeTotalsForMonths(
    entries,
    monthlySummaries,
    previousMonthKeys,
  )
  const previousMonthsReserveModel = getAnnualReserveModel(
    previousMonthsTotals,
    previousMonthFraction,
    settings,
  )
  const reservedTaxFromPreviousMonths =
    previousMonthsReserveModel === undefined
      ? 0
      : previousMonthsReserveModel.remainingTaxReserveTarget * previousMonthFraction
  const monthEndTotals = combineYearlyIncomeTotals(previousMonthsTotals, {
    business: currentMonthTotals,
    employment: getEmploymentTotalsFromSummary(monthlySummaries, toMonthKey(today)),
  })
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
          monthEndReserveModel.remainingTaxReserveTarget * currentMonthFraction -
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

export function getBackfillMonthOption(
  entries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
) {
  const missingPreviousMonths = getMissingPreviousMonthSummaryKeys(entries, monthlySummaries)

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
