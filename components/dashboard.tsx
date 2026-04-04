'use client'

import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'
import { getCurrentMonthStats, getCurrentWeekStats, getCurrentYearStats } from '@/lib/calculations'
import { formatCurrency, formatDate, formatHours, formatNumber } from '@/lib/formatters'

interface DashboardProps {
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}

export function Dashboard({ entries, monthlySummaries, settings }: DashboardProps) {
  const week = getCurrentWeekStats(entries, settings)
  const month = getCurrentMonthStats(entries, monthlySummaries, settings)
  const year = getCurrentYearStats(entries, monthlySummaries, settings)
  const now = new Date()
  const greeting = getGreeting(now)
  const projectedProfit = year.projectedProfit
  const gapToGoal =
    projectedProfit === undefined ? undefined : Math.max(0, year.goalProfit - projectedProfit)
  const amountAhead =
    projectedProfit === undefined ? undefined : Math.max(0, projectedProfit - year.goalProfit)
  const goalProgress =
    projectedProfit === undefined || year.goalProfit <= 0
      ? undefined
      : Math.min(100, (projectedProfit / year.goalProfit) * 100)
  const monthsRemaining = Math.max(1, 12 - now.getMonth())
  const neededMonthlyAverage =
    gapToGoal === undefined || gapToGoal <= 0 ? 0 : gapToGoal / monthsRemaining
  const status = getTargetStatus(projectedProfit, year.goalProfit)
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
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <article className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
          <div className="text-sm font-semibold text-foreground">Move to tax piggy</div>
          <p className="mt-3 text-2xl font-semibold text-foreground">
            {month.reserveProjection === undefined ? '—' : formatCurrency(month.reserveProjection)}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Based on invoiced profit pace, estimated tax, and buffer.
          </p>
        </article>

        <article className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
          <div className="text-sm font-semibold text-foreground">Cash received</div>
          <p className="mt-3 text-2xl font-semibold text-foreground">
            {formatCurrency(month.paidIncome)}
          </p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Invoiced</span>
              <span className="font-semibold text-foreground">{formatCurrency(month.invoicedIncome)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Still open</span>
              <span className="font-semibold text-foreground">{formatCurrency(month.cashOutstanding)}</span>
            </div>
          </div>
        </article>
      </section>

      <section className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Projected yearly profit</h2>
            <p className="mt-1 text-xs text-muted-foreground">Uses invoiced income, not paid cash.</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Goal {formatCurrency(year.goalProfit)}
          </span>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold text-foreground">
              {projectedProfit === undefined ? '—' : formatCurrency(projectedProfit)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {getRecommendation({
                amountAhead,
                gapToGoal,
                monthsRemaining,
                neededMonthlyAverage,
                projectedProfit,
                goal: year.goalProfit,
              })}
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
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Goal</div>
            <div className="mt-2 font-semibold text-foreground">{formatCurrency(year.goalProfit)}</div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Gap</div>
            <div className="mt-2 font-semibold text-foreground">
              {gapToGoal === undefined ? '—' : formatCurrency(gapToGoal)}
            </div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Need / mo</div>
            <div className="mt-2 font-semibold text-foreground">
              {projectedProfit === undefined ? '—' : formatCurrency(neededMonthlyAverage)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Projection vs goal</h2>
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
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Gap</div>
            <div className="mt-2 font-semibold text-foreground">
              {gapToGoal === undefined ? '—' : formatCurrency(gapToGoal)}
            </div>
          </div>
          <div className="rounded-[1.35rem] bg-muted/75 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Effort</div>
            <div className="mt-2 font-semibold text-foreground">{effortLabel}</div>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          {projectedProfit === undefined
            ? 'Add a few real entries to start the target helper.'
            : gapToGoal && gapToGoal > 0
              ? `To close the gap, aim for about ${formatCurrency(neededMonthlyAverage)} more profit per month.`
              : `At this pace you are around ${formatCurrency(amountAhead ?? 0)} ahead of target.`}
        </p>
      </section>
    </div>
  )
}

function getGreeting(now: Date) {
  const hour = now.getHours()

  if (hour < 12) {
    return 'Good morning'
  }

  if (hour < 18) {
    return 'Good afternoon'
  }

  return 'Good evening'
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

  return `Need about ${formatCurrency(neededMonthlyAverage)} profit per month for the next ${monthsRemaining} months.`
}
