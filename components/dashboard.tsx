'use client'

import { InfoHelp } from '@/components/info-help'
import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'
import {
  getSetupCompleteness,
  getCurrentMonthStats,
  getCurrentWeekStats,
  getCurrentYearStats,
  isCurrentMonthIncomplete,
} from '@/lib/calculations'
import { formatCurrency, formatDate, formatHours, formatNumber } from '@/lib/formatters'

interface DashboardProps {
  displayName?: string
  entries: DailyEntry[]
  isCurrentMonthReminderDismissed: boolean
  monthlySummaries: MonthlySummary[]
  onOpenConfigurationSetup: () => void
  onAddPreviousMonths: () => void
  onDismissCurrentMonthReminder: () => void
  onFillMissingDays: () => void
  settings: Settings
}

export function Dashboard({
  displayName,
  entries,
  isCurrentMonthReminderDismissed,
  monthlySummaries,
  onOpenConfigurationSetup,
  onAddPreviousMonths,
  onDismissCurrentMonthReminder,
  onFillMissingDays,
  settings,
}: DashboardProps) {
  const now = new Date()
  const week = getCurrentWeekStats(entries, settings)
  const invoicedThisWeek = getCurrentWeekInvoicedIncome(entries, now)
  const month = getCurrentMonthStats(entries, monthlySummaries, settings)
  const year = getCurrentYearStats(entries, monthlySummaries, settings)
  const projectedTakeHome = year.projectedAnnualNet
  const yearlyNetGoal = settings.targetNetMonth ? settings.targetNetMonth * 12 : 0
  const beforeTaxTarget = year.goalAnnualBusinessProfit
  const greeting = getGreeting(now, displayName)
  const hasBusinessHistory = entries.length > 0 || monthlySummaries.length > 0
  const setupCompleteness = getSetupCompleteness(settings, monthlySummaries, now)
  const shouldShowCurrentMonthReminder =
    isCurrentMonthIncomplete(entries, now) && !isCurrentMonthReminderDismissed
  const baseConfigurationStatus = !setupCompleteness.baseConfigurationComplete
    ? 'Missing'
    : setupCompleteness.isUsingStarterBaseSettings
      ? 'Review recommended'
      : 'Ready'
  const shouldShowSetupCard =
    baseConfigurationStatus !== 'Ready' || !setupCompleteness.previousMonthsComplete
  const projectedProfit = year.projectedAnnualPreTaxIncome
  const gapToGoal =
    projectedTakeHome === undefined
      ? undefined
      : Math.max(0, yearlyNetGoal - projectedTakeHome)
  const amountAhead =
    projectedTakeHome === undefined
      ? undefined
      : Math.max(0, projectedTakeHome - yearlyNetGoal)
  const goalProgress =
    projectedTakeHome === undefined || yearlyNetGoal <= 0
      ? undefined
      : Math.min(100, (projectedTakeHome / yearlyNetGoal) * 100)
  const monthsRemaining = Math.max(1, 12 - now.getMonth())
  const neededMonthlyAverage =
    gapToGoal === undefined || gapToGoal <= 0 ? 0 : gapToGoal / monthsRemaining
  const status = getTargetStatus(projectedTakeHome, yearlyNetGoal)
  const effortLabel = getEffortLabel(neededMonthlyAverage, projectedProfit)

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-[1.9rem] border border-border bg-card/88 px-4 py-4 shadow-sm backdrop-blur">
        <p className="text-sm font-medium text-muted-foreground">{greeting}</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-foreground">Ready for today?</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {formatDate(now)}
          </span>
        </div>
      </section>

      {shouldShowSetupCard ? (
        <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Setup
          </p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">
            Set up your dashboard
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Work through the items below to make the dashboard more accurate and easier to trust.
          </p>
          <div className="mt-4 space-y-3">
            <SetupChecklistItem
              label="Base configuration"
              onClick={onOpenConfigurationSetup}
              status={baseConfigurationStatus}
              subtitle="Set your targets and default shift values."
            />
            <SetupChecklistItem
              label="Previous months"
              onClick={onAddPreviousMonths}
              status={setupCompleteness.previousMonthsComplete ? 'Ready' : 'Missing'}
              subtitle="Backfill each earlier month in this year with a manual summary."
            />
          </div>
        </section>
      ) : null}

      {shouldShowCurrentMonthReminder ? (
        <section className="rounded-[1.8rem] border border-sky-200 bg-sky-50/80 p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800/80">
            Reminder
          </p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">This month has already started</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add the days you already worked this month so your monthly forecast is more accurate.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
              onClick={onFillMissingDays}
              type="button"
            >
              Fill this month so far
            </button>
            <button
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-foreground transition hover:bg-sky-100"
              onClick={onDismissCurrentMonthReminder}
              type="button"
            >
              Skip for now
            </button>
          </div>
        </section>
      ) : null}

      <section className="relative overflow-hidden rounded-[2rem] border border-border bg-[linear-gradient(135deg,rgba(136,201,255,0.92),rgba(181,242,213,0.9))] p-5 shadow-sm">
        <div className="absolute right-[-1.5rem] top-[-1.5rem] h-24 w-24 rounded-full bg-white/30 blur-2xl" />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/60">This week</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Hours left</h2>
          <p className="mt-3 text-5xl font-semibold tracking-tight text-foreground">
            {formatHours(week.hoursLeft)}
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-white/72 px-3 py-2 font-medium text-foreground">
              Worked {formatHours(week.actualHours)}
            </span>
            <span className="rounded-full bg-white/72 px-3 py-2 font-medium text-foreground">
              Goal {formatHours(week.goalHours)}
            </span>
            <span className="rounded-full bg-white/72 px-3 py-2 font-medium text-foreground">
              Invoiced this week {formatCurrency(invoicedThisWeek)}
            </span>
          </div>
          {!hasBusinessHistory ? (
            <p className="mt-4 max-w-xs text-sm text-foreground/75">
              {setupCompleteness.baseConfigurationComplete
                ? 'Your weekly target is ready. Add your first report to start tracking real hours.'
                : 'Set your base configuration first, then add your first report to start tracking real hours.'}
            </p>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <article className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span>Tax planning</span>
          </div>
          {hasBusinessHistory ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="max-w-[11rem] text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span>Tax reserved so far</span>
                    <InfoHelp
                      body="This is the running reserve target built from earlier completed months. It gives this month’s tax planning card a head start before the current month estimate is added."
                      title="Reserved tax from previous months"
                    />
                  </span>
                </span>
                <span className="font-semibold text-foreground">
                  {month.reservedTaxFromPreviousMonths === undefined
                    ? '—'
                    : formatCurrency(month.reservedTaxFromPreviousMonths)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="max-w-[11rem] text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span>Tax to save this month</span>
                    <InfoHelp
                      body="This estimates what to reserve from the current month so your year-to-date tax buffer stays on pace, including your reserve buffer percentage."
                      title="Tax to save this month"
                    />
                  </span>
                </span>
                <span className="font-semibold text-foreground">
                  {month.forecastCalculatedTaxToSaveThisMonth === undefined
                    ? '—'
                    : formatCurrency(month.forecastCalculatedTaxToSaveThisMonth)}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Tax guidance starts after you log real income or backfill a month.
            </p>
          )}
        </article>

        <article className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
          <div className="text-sm font-semibold text-foreground">Paid amount received this month</div>
          <p className="mt-1 text-xs text-muted-foreground">Amounts shown exclude VAT.</p>
          <p className="mt-3 text-2xl font-semibold text-foreground">
            {hasBusinessHistory ? formatCurrency(month.paidIncome) : '—'}
          </p>
          {hasBusinessHistory ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Invoiced amount (excl. VAT)</span>
                <span className="font-semibold text-foreground">{formatCurrency(month.invoicedIncome)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Not yet paid (excl. VAT)</span>
                <span className="font-semibold text-foreground">{formatCurrency(month.cashOutstanding)}</span>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Paid and unpaid business amounts will appear after your first report.
            </p>
          )}
        </article>
      </section>

      <section className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Projected yearly take-home income</h2>
              <InfoHelp
                body="This is your projected yearly income after estimated tax. It compares your projected take-home income against your net yearly goal. The smaller supporting figure shows your projected yearly result before income tax."
                title="Projected yearly take-home income"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              After estimated tax, based on your current yearly projection.
            </p>
          </div>
          <div className="text-right">
            <div className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
              Net goal {formatCurrency(yearlyNetGoal)}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Before-tax target {formatCurrency(beforeTaxTarget)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold text-foreground">
              {projectedTakeHome === undefined ? '—' : formatCurrency(projectedTakeHome)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {projectedTakeHome === undefined
                ? 'Projection starts after your first real entries.'
                : gapToGoal && gapToGoal > 0
                  ? `Need about ${formatCurrency(neededMonthlyAverage)} more take-home income per month for the next ${monthsRemaining} months.`
                  : `About ${formatCurrency(amountAhead ?? 0)} ahead. Keep the pace steady.`}
            </p>
          </div>
          <div className="min-w-24 rounded-[1.35rem] bg-muted px-3 py-3 text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Progress</div>
            <div className="mt-2 text-xl font-semibold text-foreground">
              {goalProgress === undefined ? '—' : `${formatNumber(goalProgress)}%`}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Net goal</div>
            <div className="mt-2 font-semibold text-foreground">
              {formatCurrency(yearlyNetGoal)}
            </div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Before tax</div>
            <div className="mt-2 font-semibold text-foreground">
              {projectedProfit === undefined ? '—' : formatCurrency(projectedProfit)}
            </div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Need / mo</div>
            <div className="mt-2 font-semibold text-foreground">
              {projectedTakeHome === undefined ? '—' : formatCurrency(neededMonthlyAverage)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Projection vs goal</h2>
            <InfoHelp
              body="This compares your projected yearly take-home income against your yearly net goal. Status, progress, and monthly pace update as your projected yearly net income changes."
              title="Projection vs goal"
            />
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${status.tone}`}>
            {status.label}
          </span>
        </div>

        <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[linear-gradient(135deg,rgba(255,216,107,0.95),rgba(255,143,122,0.88))]"
            style={{ width: `${goalProgress ?? 0}%` }}
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Status</div>
            <div className="mt-2 font-semibold text-foreground">{status.label}</div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Months left</div>
            <div className="mt-2 font-semibold text-foreground">{monthsRemaining}</div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Effort</div>
            <div className="mt-2 font-semibold text-foreground">{effortLabel}</div>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          {projectedTakeHome === undefined
            ? 'Add a few real entries to start the target helper.'
            : gapToGoal && gapToGoal > 0
              ? `You need about ${formatCurrency(neededMonthlyAverage)} more take-home income per month to reach your net goal.`
              : `At this pace you are around ${formatCurrency(amountAhead ?? 0)} ahead of your net goal.`}
        </p>
      </section>
    </div>
  )
}

function SetupChecklistItem({
  label,
  onClick,
  status,
  subtitle,
}: {
  label: string
  onClick: () => void
  status: 'Ready' | 'Missing' | 'Review recommended'
  subtitle: string
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-[1.3rem] border border-border bg-background px-4 py-3 text-left shadow-sm transition hover:border-foreground/20 hover:bg-muted/35"
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <span className="flex items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            status === 'Ready'
              ? 'bg-emerald-100 text-emerald-700'
              : status === 'Review recommended'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-rose-100 text-rose-700'
          }`}
        >
          {status}
        </span>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
          <span aria-hidden="true" className="text-lg leading-none">
            ›
          </span>
        </span>
      </span>
    </button>
  )
}

function getCurrentWeekInvoicedIncome(entries: DailyEntry[], now: Date) {
  const weekStart = new Date(now)
  const day = weekStart.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  weekStart.setDate(weekStart.getDate() + diffToMonday)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  return entries.reduce((total, entry) => {
    const entryDate = new Date(`${entry.date}T00:00:00`)

    if (entryDate >= weekStart && entryDate < weekEnd) {
      return total + entry.invoicedIncome
    }

    return total
  }, 0)
}

function getGreeting(now: Date, displayName?: string) {
  const hour = now.getHours()
  const suffix = displayName?.trim() ? `, ${displayName.trim()}` : ''

  if (hour < 12) {
    return `Good morning${suffix}`
  }

  if (hour < 18) {
    return `Good afternoon${suffix}`
  }

  return `Good evening${suffix}`
}

function getTargetStatus(projectedProfit: number | undefined, goal: number) {
  if (projectedProfit === undefined) {
    return {
      label: 'Waiting',
      tone: 'bg-muted text-muted-foreground',
    }
  }

  const ratio = goal > 0 ? projectedProfit / goal : 0

  if (ratio >= 1) {
    return {
      label: 'On track',
      tone: 'bg-emerald-100 text-emerald-700',
    }
  }

  if (ratio >= 0.9) {
    return {
      label: 'Close',
      tone: 'bg-amber-100 text-amber-700',
    }
  }

  return {
    label: 'Behind',
    tone: 'bg-rose-100 text-rose-700',
  }
}

function getEffortLabel(neededMonthlyAverage: number, projectedProfit: number | undefined) {
  if (projectedProfit === undefined) {
    return 'Waiting'
  }

  if (neededMonthlyAverage <= 0) {
    return 'Maintain'
  }

  if (neededMonthlyAverage <= 2000) {
    return 'Reachable'
  }

  if (neededMonthlyAverage <= 3500) {
    return 'Needs focus'
  }

  return 'Heavy lift'
}

function getRecommendation({
  amountAhead,
  gapToGoal,
  monthsRemaining,
  neededMonthlyAverage,
  projectedProfit,
  goal,
}: {
  amountAhead: number | undefined
  gapToGoal: number | undefined
  monthsRemaining: number
  neededMonthlyAverage: number
  projectedProfit: number | undefined
  goal: number
}) {
  if (projectedProfit === undefined) {
    return 'Projection starts after your first real entries.'
  }

  if (projectedProfit >= goal) {
    return `About ${formatCurrency(amountAhead ?? 0)} ahead. Keep the pace steady.`
  }

  return `Need about ${formatCurrency(neededMonthlyAverage)} more before-tax income per month for the next ${monthsRemaining} months.`
}
