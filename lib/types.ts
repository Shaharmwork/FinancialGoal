export type Screen = 'dashboard' | 'daily-log' | 'configuration'
export type DayStatus = 'worked' | 'no_work' | 'vacation'
export type MonthType = 'business' | 'employment'

export interface DailyEntry {
  id: string
  date: string
  dayStatus?: DayStatus
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
  note?: string
  source?: string
}

export interface MonthlySummary {
  monthKey: string
  monthType: MonthType
  hours: number | null
  invoicedIncome: number | null
  paidIncome: number | null
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
  vacationDaysPerYear: number | null
}

export interface StoredAppState {
  currentScreen: Screen
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}
