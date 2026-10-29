export type Screen = 'dashboard' | 'daily-log' | 'configuration'
export type DayStatus = 'worked' | 'no_work' | 'vacation'
export type MonthType = 'business' | 'employment'
// How a day's or work line's income was entered. null = saved before the mode was
// stored (legacy): the saved amount is kept as-is and never re-derived.
export type PricingMode = 'hourly' | 'fixed'

export interface WorkItem {
  id?: string
  dailyEntryId?: string
  projectName: string
  hours: number
  hourlyRate: number | null
  invoicedIncome: number
  lineIndex: number
  pricingMode?: PricingMode | null
}

export interface DailyEntry {
  id: string
  date: string
  dayStatus?: DayStatus
  hours: number
  invoicedIncome: number
  expenses: number
  note?: string
  source?: string
  workItems?: WorkItem[]
  // Single-rate days only; work items carry their own.
  hourlyRate?: number | null
  pricingMode?: PricingMode | null
  // Version this copy is based on (the row's updated_at); absent for unsaved days.
  updatedAt?: string
}

// One line of work in a backfilled business month. Income is hours x rate,
// unless totalIncome is set (fixed-price jobs), which then wins.
export interface MonthWorkLine {
  label: string
  hours: number | null
  hourlyRate: number | null
  totalIncome: number | null
}

export interface MonthlySummary {
  monthKey: string
  monthType: MonthType
  hours: number | null
  invoicedIncome: number | null
  workLines?: MonthWorkLine[]
  expenses: number | null
  grossSalary: number | null
  netSalaryReceived: number | null
  taxAlreadyWithheld: number | null
  // Version this copy is based on (the row's updated_at); absent for unsaved months.
  updatedAt?: string
}

export interface YearSettings {
  dutchHolidaysEnabled?: boolean
  holidayDaysAdded?: number
  targetNetMonth: number | null
  spouseMonthlyIncome: number
  defaultShiftIncome: number | null
  defaultShiftHours: number | null
  weeklyHoursTarget: number | null
  reserveBufferPercent: number | null
  qualifiesForSelfEmployedDeduction: boolean | null
  qualifiesForStartersDeduction: boolean | null
  vacationDaysPerYear: number | null
}

export interface Settings extends YearSettings {
  year?: number
  yearlySettings?: Record<string, YearSettings>
  // One version guards the whole configuration document across devices.
  updatedAt?: string
}

export interface StoredAppState {
  currentScreen: Screen
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}
