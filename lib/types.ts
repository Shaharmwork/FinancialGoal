export type Screen = 'dashboard' | 'daily-log' | 'configuration'
export type DayStatus = 'worked' | 'no_work'

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
  hours: number
  invoicedIncome: number
  paidIncome: number
  expenses: number
}

export interface Settings {
  targetNetMonth: number | null
  spouseMonthlyIncome: number
  defaultShiftIncome: number | null
  defaultShiftHours: number | null
  weeklyHoursTarget: number | null
  reserveBufferPercent: number | null
  qualifiesForSelfEmployedDeduction: boolean | null
}

export interface StoredAppState {
  currentScreen: Screen
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}
