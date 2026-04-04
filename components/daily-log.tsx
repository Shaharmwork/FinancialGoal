'use client'

import { useState, type FormEvent } from 'react'
import type { DailyEntry, Settings } from '@/lib/types'
import { getCurrentMonthRange, parseDateKey, toDateKey } from '@/lib/calculations'
import { formatCurrencyPrecise, formatDate, formatHeaderDate, formatHours } from '@/lib/formatters'

interface DailyLogProps {
  entries: DailyEntry[]
  settings: Settings
  onAddEntry: (entry: DailyEntry) => void
}

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getCalculatedDefaultInvoiceAmount(hours: string, settings: Settings) {
  const resolvedHours = parseNumber(hours)

  if (resolvedHours > 0 && settings.defaultShiftHours > 0) {
    return (resolvedHours / settings.defaultShiftHours) * settings.defaultShiftIncome
  }

  return settings.defaultShiftIncome
}

export function DailyLog({ entries, settings, onAddEntry }: DailyLogProps) {
  const [date, setDate] = useState(toDateKey(new Date()))
  const [hours, setHours] = useState('')
  const [invoicedIncome, setInvoicedIncome] = useState('')
  const [paidIncome, setPaidIncome] = useState('')
  const [expenses, setExpenses] = useState('')
  const [formMessage, setFormMessage] = useState('')

  const { start, end } = getCurrentMonthRange()
  const selectedDate = parseDateKey(date)
  const monthDays = Array.from({ length: end.getDate() }, (_, index) => {
    const dayDate = new Date(start.getFullYear(), start.getMonth(), index + 1)
    return {
      key: toDateKey(dayDate),
      label: dayDate.getDate().toString(),
    }
  })
  const monthEntries = entries
    .filter((entry) => entry.date >= toDateKey(start) && entry.date <= toDateKey(end))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5)
  const calculatedDefaultInvoiceAmount = getCalculatedDefaultInvoiceAmount(hours, settings)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const resolvedHours = parseNumber(hours)
    const resolvedInvoicedIncome =
      invoicedIncome.trim() === ''
        ? getCalculatedDefaultInvoiceAmount(hours, settings)
        : parseNumber(invoicedIncome)
    const resolvedPaidIncome = parseNumber(paidIncome)
    const resolvedExpenses = parseNumber(expenses)

    if (!date || resolvedHours <= 0) {
      setFormMessage('Enter a date and billed hours first.')
      return
    }

    if (resolvedInvoicedIncome <= 0) {
      setFormMessage('Enter an invoice amount before saving.')
      return
    }

    onAddEntry({
      id: `entry-${date}-${Date.now()}`,
      date,
      hours: resolvedHours,
      invoicedIncome: Number(resolvedInvoicedIncome.toFixed(2)),
      paidIncome: Number(resolvedPaidIncome.toFixed(2)),
      expenses: Number(resolvedExpenses.toFixed(2)),
    })

    setHours('')
    setInvoicedIncome('')
    setPaidIncome('')
    setExpenses('')
    setDate(toDateKey(new Date()))
    setFormMessage('Saved.')
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-[1.9rem] border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Add today&apos;s work</h2>

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-[1.55rem] bg-muted/75 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Pick a day</span>
              <span className="text-xs text-muted-foreground">{formatHeaderDate(selectedDate)}</span>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {monthDays.map((day) => {
                const isSelected = day.key === date

                return (
                  <button
                    key={day.key}
                    className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium transition ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground'
                    }`}
                    onClick={() => setDate(day.key)}
                    type="button"
                  >
                    {day.label}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Date</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Billed hours</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              type="number"
              min="0"
              step="0.25"
              placeholder={settings.defaultShiftHours.toString()}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Invoice amount</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              type="number"
              min="0"
              step="0.01"
              placeholder={calculatedDefaultInvoiceAmount.toFixed(2)}
              value={invoicedIncome}
              onChange={(event) => setInvoicedIncome(event.target.value)}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              Leave empty to calculate the default from your hours and configuration.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Paid income</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={paidIncome}
              onChange={(event) => setPaidIncome(event.target.value)}
            />
            <span className="mt-2 block text-xs text-muted-foreground">
              Use this only when money actually came in.
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Expenses</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={expenses}
              onChange={(event) => setExpenses(event.target.value)}
            />
          </label>

          <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            Default invoice amount right now is{' '}
            <span className="font-medium text-foreground">
              {formatCurrencyPrecise(calculatedDefaultInvoiceAmount)}
            </span>
            . It scales from billed hours using your configured shift income and shift hours.
          </div>

          <button
            className="w-full rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-95"
            type="submit"
          >
            Save
          </button>

          {formMessage ? <p className="text-sm text-muted-foreground">{formMessage}</p> : null}
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Latest entries
          </h2>
          <span className="text-sm text-muted-foreground">{monthEntries.length} this month</span>
        </div>

        {monthEntries.length === 0 ? (
          <div className="rounded-[1.8rem] border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            No entries yet for this month.
          </div>
        ) : (
          <div className="space-y-3">
            {monthEntries.map((entry) => {
              const entryDate = parseDateKey(entry.date)
              const profit = entry.invoicedIncome - entry.expenses

              return (
                <article
                  key={entry.id}
                  className="rounded-[1.8rem] border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{formatDate(entryDate)}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{formatHours(entry.hours)}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Invoiced: {formatCurrencyPrecise(entry.invoicedIncome)}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Paid: {formatCurrencyPrecise(entry.paidIncome)}
                      </p>
                      {entry.expenses > 0 ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expenses: {formatCurrencyPrecise(entry.expenses)}
                        </p>
                      ) : null}
                    </div>

                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Profit</p>
                      <p className="mt-2 text-lg font-semibold text-foreground">
                        {formatCurrencyPrecise(profit)}
                      </p>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
