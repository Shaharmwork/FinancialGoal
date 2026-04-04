'use client'

import { formatCurrency, formatHours, formatNumber } from '@/lib/formatters'

type MetricFormat = 'currency' | 'hours' | 'number'

interface MetricCardProps {
  label: string
  goal?: number
  actual?: number
  projection?: number
  format?: MetricFormat
  hint?: string
}

function formatValue(value: number | undefined, format: MetricFormat) {
  if (value === undefined) {
    return '—'
  }

  if (format === 'currency') {
    return formatCurrency(value)
  }

  if (format === 'hours') {
    return formatHours(value)
  }

  return formatNumber(value)
}

export function MetricCard({
  label,
  goal,
  actual,
  projection,
  format = 'currency',
  hint,
}: MetricCardProps) {
  return (
    <article className="rounded-3xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-2xl bg-muted px-3 py-3">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Goal</dt>
          <dd className="mt-2 font-semibold text-foreground">{formatValue(goal, format)}</dd>
        </div>
        <div className="rounded-2xl bg-muted px-3 py-3">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Actual</dt>
          <dd className="mt-2 font-semibold text-foreground">{formatValue(actual, format)}</dd>
        </div>
        <div className="rounded-2xl bg-primary/10 px-3 py-3">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-primary">Projection</dt>
          <dd className="mt-2 font-semibold text-foreground">{formatValue(projection, format)}</dd>
        </div>
      </dl>
    </article>
  )
}
