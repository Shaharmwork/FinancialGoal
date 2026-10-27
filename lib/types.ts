export type Screen = 'dashboard' | 'daily-log' | 'configuration'
export type DayStatus = 'worked' | 'no_work' | 'vacation'
export type MonthType = 'business' | 'employment'

export interface WorkItem {
  id?: string
  dailyEntryId?: string
  projectName: string
  hours: number
  hourlyRate: number | null
  invoicedIncome: number
  lineIndex: number
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
}

export interface Settings {
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

export interface StoredAppState {
  currentScreen: Screen
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}
