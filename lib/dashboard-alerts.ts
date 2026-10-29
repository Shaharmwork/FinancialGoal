import {
  getEarliestMissingPreviousMonthWeekday,
  getMissingCurrentMonthReportDateKeys,
  getMissingPreviousMonthSummaryKeys,
  getSetupCompleteness,
} from './calculations'
import type { DailyEntry, MonthlySummary, Settings } from './types'

export interface DashboardAlert {
  kind: 'months' | 'history-days' | 'configuration' | 'reports'
  title: string
  subtitle: string
  tooltip: string
  monthKey?: string
  reportDateKey?: string
}

// Presentation (collapsed/open) never changes which unresolved issue comes first.
export function getDashboardAlert(
  entries: DailyEntry[], summaries: MonthlySummary[], settings: Settings,
  today = new Date(), currentMonthDismissed = false,
): DashboardAlert | null {
  const missingMonths = getMissingPreviousMonthSummaryKeys(entries, summaries, today)
  const historicalDay = getEarliestMissingPreviousMonthWeekday(entries, summaries, today)
  if (missingMonths.length) return {
    kind: 'months', title: 'Missing months', subtitle: `${today.getFullYear()} · ${missingMonths.length} to complete`,
    tooltip: `${today.getFullYear()} has ${missingMonths.length} previous month(s) without reports. Complete months opens the earliest missing month in Configuration. Report daily hours opens the earliest unreported weekday in this year's previous months.`,
    monthKey: missingMonths[0], reportDateKey: historicalDay,
  }
  if (historicalDay) return {
    kind: 'history-days', title: 'Missing past days', subtitle: `${today.getFullYear()} history incomplete`,
    tooltip: 'Some previous months have daily reports but still contain unreported weekdays. Complete the missing days before moving on to this month. Month totals cannot replace existing daily reports.',
    reportDateKey: historicalDay,
  }
  const setup = getSetupCompleteness(settings, entries, summaries, today)
  if (!setup.baseConfigurationComplete) return {
    kind: 'configuration', title: 'Missing Configuration', subtitle: 'Setup incomplete',
    tooltip: 'Your core setup is incomplete. Add your defaults, financial assumptions, and targets so projections, tax guidance, and progress tracking can work correctly.',
  }
  const currentDay = getMissingCurrentMonthReportDateKeys(entries, today, summaries)[0]
  if (currentDay && !currentMonthDismissed) return {
    kind: 'reports', title: 'Missing Days Reports', subtitle: 'This month',
    tooltip: 'Some work days in the current month have not been reported yet. Reporting them improves this month’s totals, yearly projections, tax guidance, and progress tracking.',
    reportDateKey: currentDay,
  }
  return null
}
