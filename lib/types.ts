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
  monthlyNetGoal: number
  spouseMonthlyIncome: number
  defaultShiftIncome: number
  defaultShiftHours: number
  weeklyHoursGoal: number
  reserveBufferPercent: number
  incomeTaxPercent: number
  additionalTaxPercent: number
}

export interface StoredAppState {
  currentScreen: Screen
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}
