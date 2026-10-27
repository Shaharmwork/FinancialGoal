import { describe, expect, it } from 'vitest'
import { getDailyDraftSaveState, getEntryDraft } from '@/lib/report-drafts'
import type { DailyEntry, Settings, WorkItem } from '@/lib/types'

const settings: Settings = {
  targetNetMonth: 4500,
  spouseMonthlyIncome: 0,
  defaultShiftIncome: 400,
  defaultShiftHours: 8,
  weeklyHoursTarget: 30,
  reserveBufferPercent: 5,
  qualifiesForSelfEmployedDeduction: true,
  qualifiesForStartersDeduction: true,
  vacationDaysPerYear: null,
}

function dayWithItem(item: Partial<WorkItem>): DailyEntry {
  const workItem: WorkItem = {
    id: 'item-1',
    projectName: 'Digital',
    hours: 2,
    hourlyRate: 50,
    invoicedIncome: 100,
    lineIndex: 0,
    ...item,
  }
  return {
    id: 'd1',
    date: '2026-10-01',
    dayStatus: 'worked',
    hours: workItem.hours,
    invoicedIncome: workItem.invoicedIncome,
    expenses: 0,
    workItems: [workItem],
    updatedAt: '2026-10-01T10:00:00.000000+00:00',
  }
}

function editHours<T extends { hours: string }>(draft: T, hours: string): T {
  return { ...draft, hours }
}

describe('saved work lines', () => {
  it('reported bug: 2h x €50 saved, reopened, changed to 3h gives €150', () => {
    const draft = getEntryDraft(dayWithItem({ pricingMode: 'hourly' }))
    expect(draft.workItems?.[0]).toMatchObject({ hourlyRate: '50', invoicedIncome: '' })

    const edited = { ...draft, workItems: [editHours(draft.workItems![0], '3')] }
    const saved = getDailyDraftSaveState(edited, settings)

    expect(saved.values.workItems?.[0]).toMatchObject({
      hours: 3,
      invoicedIncome: 150,
      pricingMode: 'hourly',
      hourlyRate: 50,
    })
  })

  it('a fixed-price line stays fixed, even when the total divides evenly', () => {
    const draft = getEntryDraft(
      dayWithItem({ hours: 8, hourlyRate: null, invoicedIncome: 400, pricingMode: 'fixed' }),
    )
    expect(draft.workItems?.[0]).toMatchObject({ invoicedIncome: '400', hourlyRate: '' })

    const edited = { ...draft, workItems: [editHours(draft.workItems![0], '9')] }
    expect(getDailyDraftSaveState(edited, settings).values.workItems?.[0]).toMatchObject({
      hours: 9,
      invoicedIncome: 400,
      pricingMode: 'fixed',
      hourlyRate: null,
    })
  })

  it('a legacy line (mode unknown) keeps its saved total instead of being re-derived', () => {
    const draft = getEntryDraft(dayWithItem({ pricingMode: null }))
    expect(draft.workItems?.[0].invoicedIncome).toBe('100')

    const edited = { ...draft, workItems: [editHours(draft.workItems![0], '3')] }
    expect(getDailyDraftSaveState(edited, settings).values.workItems?.[0]).toMatchObject({
      invoicedIncome: 100,
      pricingMode: 'fixed',
    })
  })

  it('clearing the total of a legacy line switches it to hours x rate', () => {
    const draft = getEntryDraft(dayWithItem({ pricingMode: null }))
    const edited = {
      ...draft,
      workItems: [{ ...draft.workItems![0], hours: '3', invoicedIncome: '' }],
    }
    expect(getDailyDraftSaveState(edited, settings).values.workItems?.[0]).toMatchObject({
      invoicedIncome: 150,
      pricingMode: 'hourly',
    })
  })
})

describe('single-rate days', () => {
  const day = (overrides: Partial<DailyEntry>): DailyEntry => ({
    id: 'd1',
    date: '2026-10-01',
    dayStatus: 'worked',
    hours: 8,
    invoicedIncome: 400,
    expenses: 0,
    ...overrides,
  })

  it('an hourly day recalculates when the hours change', () => {
    const draft = getEntryDraft(day({ pricingMode: 'hourly', hourlyRate: 50 }))
    expect(draft).toMatchObject({ hourlyRate: '50', totalIncome: '' })
    expect(getDailyDraftSaveState(editHours(draft, '9'), settings).values).toMatchObject({
      invoicedIncome: 450,
      pricingMode: 'hourly',
      hourlyRate: 50,
    })
  })

  it('a fixed-price day keeps its total, even though 400 / 8 divides evenly', () => {
    const draft = getEntryDraft(day({ pricingMode: 'fixed', hourlyRate: null }))
    expect(draft).toMatchObject({ hourlyRate: '', totalIncome: '400' })
    expect(getDailyDraftSaveState(editHours(draft, '9'), settings).values).toMatchObject({
      invoicedIncome: 400,
      pricingMode: 'fixed',
      hourlyRate: null,
    })
  })

  it('a legacy day is shown as its saved total, not guessed to be hourly', () => {
    const draft = getEntryDraft(day({ pricingMode: null, hourlyRate: null }))
    expect(draft).toMatchObject({ hourlyRate: '', totalIncome: '400' })
  })

  it('a blank rate uses the default rate and is stored as hourly', () => {
    const draft = { expenses: '', hours: '6', hourlyRate: '', totalIncome: '' }
    expect(getDailyDraftSaveState(draft, settings).values).toMatchObject({
      invoicedIncome: 300,
      pricingMode: 'hourly',
      hourlyRate: 50,
    })
  })

  it('an expense-only day has no pricing mode', () => {
    const draft = { expenses: '12.50', hours: '', hourlyRate: '', totalIncome: '' }
    const state = getDailyDraftSaveState(draft, settings)
    expect(state.kind).toBe('expense_only')
    expect(state.values).toMatchObject({ pricingMode: null, hourlyRate: null })
  })
})
