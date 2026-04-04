export type Screen = 'dashboard' | 'daily-log' | 'configuration'

export interface DailyEntry {
  id: string
  date: string
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
  targetNetMonth: number
  spouseMonthlyIncome: number
  defaultShiftIncome: number
  defaultShiftHours: number
  weeklyHoursTarget: number
  reserveBufferPercent: number
  qualifiesForSelfEmployedDeduction: boolean
}

export interface StoredAppState {
  currentScreen: Screen
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}
