'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getBackfillMonthOption, sortMonthlySummaries } from '@/lib/calculations'
import type { MonthlySummary, Settings } from '@/lib/types'

interface ConfigurationProps {
  settings: Settings
  monthlySummaries: MonthlySummary[]
  onSaveConfiguration: (settings: Settings, monthlySummaries: MonthlySummary[]) => Promise<void>
}

interface FieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  prefix?: string
  suffix?: string
  help?: string
  disabled?: boolean
}

interface ToggleFieldProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  help?: string
  disabled?: boolean
}

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function SettingField({
  label,
  value,
  onChange,
  step = 1,
  prefix,
  suffix,
  help,
  disabled = false,
}: FieldProps) {
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
          className={`w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60 ${
            prefix ? 'pl-8' : ''
          } ${suffix ? 'pr-8' : ''}`}
          disabled={disabled}
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

function ToggleField({
  label,
  checked,
  onChange,
  help,
  disabled = false,
}: ToggleFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      <button
        aria-pressed={checked}
        className={`flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3 text-left text-base transition disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'
        }`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span>{checked ? 'Yes' : 'No'}</span>
        <span className="text-sm">{checked ? 'Eligible' : 'Not eligible'}</span>
      </button>
      {help ? <span className="mt-2 block text-xs text-muted-foreground">{help}</span> : null}
    </label>
  )
}

export function Configuration({
  settings,
  monthlySummaries,
  onSaveConfiguration,
}: ConfigurationProps) {
  const [draftSettings, setDraftSettings] = useState(settings)
  const [draftMonthlySummaries, setDraftMonthlySummaries] = useState(() =>
    sortMonthlySummaries(monthlySummaries),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [isErrorMessage, setIsErrorMessage] = useState(false)

  useEffect(() => {
    setDraftSettings(settings)
  }, [settings])

  useEffect(() => {
    setDraftMonthlySummaries(sortMonthlySummaries(monthlySummaries))
  }, [monthlySummaries])

  const sortedSavedSummaries = useMemo(
    () => sortMonthlySummaries(monthlySummaries),
    [monthlySummaries],
  )
  const sortedDraftSummaries = useMemo(
    () => sortMonthlySummaries(draftMonthlySummaries),
    [draftMonthlySummaries],
  )

  const resetFormMessage = () => {
    if (!formMessage && !isErrorMessage) {
      return
    }

    setFormMessage('')
    setIsErrorMessage(false)
  }

  const updateField = (key: keyof Settings, value: Settings[keyof Settings]) => {
    resetFormMessage()
    setDraftSettings({
      ...draftSettings,
      [key]: value,
    })
  }

  const hasPendingChanges =
    JSON.stringify(draftSettings) !== JSON.stringify(settings) ||
    JSON.stringify(sortedDraftSummaries) !== JSON.stringify(sortedSavedSummaries)

  const updateSummaryField = (
    index: number,
    key: keyof MonthlySummary,
    value: string | number,
  ) => {
    resetFormMessage()

    const next = sortedDraftSummaries.map((summary, summaryIndex) => {
      if (summaryIndex !== index) {
        return summary
      }

      return {
        ...summary,
        [key]: value,
      }
    })

    setDraftMonthlySummaries(sortMonthlySummaries(next))
  }

  const addMonthSummary = () => {
    resetFormMessage()

    setDraftMonthlySummaries(
      sortMonthlySummaries([
        ...sortedDraftSummaries,
        {
          monthKey: getBackfillMonthOption(sortedDraftSummaries),
          invoicedIncome: 0,
          paidIncome: 0,
          expenses: 0,
          hours: 0,
        },
      ]),
    )
  }

  const removeMonthSummary = (index: number) => {
    resetFormMessage()
    setDraftMonthlySummaries(
      sortedDraftSummaries.filter((_, summaryIndex) => summaryIndex !== index),
    )
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!hasPendingChanges) {
      return
    }

    setIsSaving(true)
    setFormMessage('')
    setIsErrorMessage(false)

    try {
      await onSaveConfiguration(draftSettings, sortedDraftSummaries)
      setFormMessage('Saved.')
    } catch (error) {
      setIsErrorMessage(true)
      setFormMessage(error instanceof Error && error.message ? error.message : 'Save failed.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="space-y-4 pb-8" onSubmit={handleSubmit}>
      <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Configuration</h2>
        <div className="mt-4 grid gap-4">
          <SettingField
            label="Target Net Month"
            disabled={isSaving}
            value={draftSettings.targetNetMonth}
            onChange={(value) => updateField('targetNetMonth', value)}
            prefix="€"
          />
          <SettingField
            label="Hours I Want To Work Every Week"
            disabled={isSaving}
            value={draftSettings.weeklyHoursTarget}
            onChange={(value) => updateField('weeklyHoursTarget', value)}
            step={0.25}
          />
          <SettingField
            label="Default Invoice Amount"
            disabled={isSaving}
            value={draftSettings.defaultShiftIncome}
            onChange={(value) => updateField('defaultShiftIncome', value)}
            prefix="€"
            step={0.01}
          />
          <SettingField
            label="Default Shift Hours"
            disabled={isSaving}
            value={draftSettings.defaultShiftHours}
            onChange={(value) => updateField('defaultShiftHours', value)}
            step={0.25}
          />
          <SettingField
            label="Spouse Monthly Income"
            disabled={isSaving}
            value={draftSettings.spouseMonthlyIncome}
            onChange={(value) => updateField('spouseMonthlyIncome', value)}
            prefix="€"
          />
          <SettingField
            label="Reserve Buffer Percentage"
            disabled={isSaving}
            value={draftSettings.reserveBufferPercent}
            onChange={(value) => updateField('reserveBufferPercent', value)}
            suffix="%"
            step={0.5}
          />
          <ToggleField
            label="Qualifies For Self-Employed Deduction"
            checked={draftSettings.qualifiesForSelfEmployedDeduction}
            disabled={isSaving}
            onChange={(value) => updateField('qualifiesForSelfEmployedDeduction', value)}
            help="Uses the 2026 self-employed deduction of €1,200 in the tax estimate."
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
            className="rounded-full bg-muted px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={addMonthSummary}
            type="button"
          >
            Add month
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {sortedDraftSummaries.map((summary, index) => (
            <div key={`${summary.monthKey}-${index}`} className="rounded-[1.5rem] bg-muted/55 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Month</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
                    type="month"
                    value={summary.monthKey}
                    onChange={(event) => updateSummaryField(index, 'monthKey', event.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Hours</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
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
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
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
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
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
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
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
                className="mt-3 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving}
                onClick={() => removeMonthSummary(index)}
                type="button"
              >
                Remove month
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {hasPendingChanges ? 'You have unsaved changes.' : 'No pending changes.'}
          </p>
          <button
            className="rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!hasPendingChanges || isSaving}
            type="submit"
          >
            {isSaving ? 'Saving...' : hasPendingChanges ? 'Save changes' : 'Saved'}
          </button>
        </div>

        {formMessage ? (
          <p className={`mt-3 text-sm ${isErrorMessage ? 'text-rose-700' : 'text-muted-foreground'}`}>
            {formMessage}
          </p>
        ) : null}
      </section>
    </form>
  )
}
