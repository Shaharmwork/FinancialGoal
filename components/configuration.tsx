'use client'

import { getBackfillMonthOption, sortMonthlySummaries } from '@/lib/calculations'
import type { MonthlySummary, Settings } from '@/lib/types'

interface ConfigurationProps {
  settings: Settings
  monthlySummaries: MonthlySummary[]
  onUpdateSettings: (settings: Settings) => void
  onUpdateMonthlySummaries: (monthlySummaries: MonthlySummary[]) => void
}

interface FieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  prefix?: string
  suffix?: string
  help?: string
}

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function SettingField({ label, value, onChange, step = 1, prefix, suffix, help }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      <div className="relative">
        {prefix ? (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <input
          className={`w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary ${
            prefix ? 'pl-8' : ''
          } ${suffix ? 'pr-8' : ''}`}
          type="number"
          step={step}
          value={value}
          onChange={(event) => onChange(parseNumber(event.target.value))}
        />
        {suffix ? (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      {help ? <span className="mt-2 block text-xs text-muted-foreground">{help}</span> : null}
    </label>
  )
}

export function Configuration({
  settings,
  monthlySummaries,
  onUpdateSettings,
  onUpdateMonthlySummaries,
}: ConfigurationProps) {
  const updateField = (key: keyof Settings, value: number) => {
    onUpdateSettings({
      ...settings,
      [key]: value,
    })
  }

  const sortedSummaries = sortMonthlySummaries(monthlySummaries)

  const updateSummaryField = (
    index: number,
    key: keyof MonthlySummary,
    value: string | number,
  ) => {
    const next = sortedSummaries.map((summary, summaryIndex) => {
      if (summaryIndex !== index) {
        return summary
      }

      return {
        ...summary,
        [key]: value,
      }
    })

    onUpdateMonthlySummaries(sortMonthlySummaries(next))
  }

  const addMonthSummary = () => {
    onUpdateMonthlySummaries(
      sortMonthlySummaries([
        ...sortedSummaries,
        {
          monthKey: getBackfillMonthOption(sortedSummaries),
          invoicedIncome: 0,
          paidIncome: 0,
          expenses: 0,
          hours: 0,
        },
      ]),
    )
  }

  const removeMonthSummary = (index: number) => {
    onUpdateMonthlySummaries(sortedSummaries.filter((_, summaryIndex) => summaryIndex !== index))
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Configuration</h2>
        <div className="mt-4 grid gap-4">
          <SettingField
            label="Target Net Month"
            value={settings.monthlyNetGoal}
            onChange={(value) => updateField('monthlyNetGoal', value)}
            prefix="€"
          />
          <SettingField
            label="Hours I Want To Work Every Week"
            value={settings.weeklyHoursGoal}
            onChange={(value) => updateField('weeklyHoursGoal', value)}
            step={0.25}
          />
          <SettingField
            label="Default Invoice Amount"
            value={settings.defaultShiftIncome}
            onChange={(value) => updateField('defaultShiftIncome', value)}
            prefix="€"
            step={0.01}
          />
          <SettingField
            label="Default Shift Hours"
            value={settings.defaultShiftHours}
            onChange={(value) => updateField('defaultShiftHours', value)}
            step={0.25}
          />
          <SettingField
            label="Spouse Monthly Income"
            value={settings.spouseMonthlyIncome}
            onChange={(value) => updateField('spouseMonthlyIncome', value)}
            prefix="€"
          />
          <SettingField
            label="Reserve Buffer Percentage"
            value={settings.reserveBufferPercent}
            onChange={(value) => updateField('reserveBufferPercent', value)}
            suffix="%"
            step={0.5}
          />
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Backfill month totals</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Use these for older months without daily entries.
            </p>
          </div>
          <button
            className="rounded-full bg-muted px-3 py-2 text-sm font-medium text-foreground"
            onClick={addMonthSummary}
            type="button"
          >
            Add month
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {sortedSummaries.map((summary, index) => (
            <div key={`${summary.monthKey}-${index}`} className="rounded-[1.5rem] bg-muted/55 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Month</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
                    type="month"
                    value={summary.monthKey}
                    onChange={(event) => updateSummaryField(index, 'monthKey', event.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Hours</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.hours}
                    onChange={(event) =>
                      updateSummaryField(index, 'hours', parseNumber(event.target.value))
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Invoiced income</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.invoicedIncome}
                    onChange={(event) =>
                      updateSummaryField(index, 'invoicedIncome', parseNumber(event.target.value))
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Paid income</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.paidIncome}
                    onChange={(event) =>
                      updateSummaryField(index, 'paidIncome', parseNumber(event.target.value))
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Expenses</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.expenses}
                    onChange={(event) =>
                      updateSummaryField(index, 'expenses', parseNumber(event.target.value))
                    }
                  />
                </label>
              </div>

              <button
                className="mt-3 text-sm font-medium text-muted-foreground"
                onClick={() => removeMonthSummary(index)}
                type="button"
              >
                Remove month
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
