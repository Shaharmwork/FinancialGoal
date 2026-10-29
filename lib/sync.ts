import type { DailyEntry, MonthlySummary, Settings } from './types'

// Saving model: the app only sends records the user changed, each with the version
// (updated_at) it was based on. The database applies a change only if that version
// is still current, so a stale device gets a conflict instead of overwriting.

export type ConflictReason = 'changed' | 'exists' | 'deleted'

// A saved day the user removed, with the version they saw when removing it.
export interface ReportDeletion {
  id: string
  updatedAt: string
}

// Unsaved report changes: edited days by date, and explicit deletions by date.
// Days that aren't in the overlay always come from the latest saved data.
export interface ReportOverlay {
  entries: Record<string, DailyEntry>
  deletions: Record<string, ReportDeletion>
}

export const EMPTY_REPORT_OVERLAY: ReportOverlay = { entries: {}, deletions: {} }

export function isReportOverlayEmpty(overlay: ReportOverlay) {
  return Object.keys(overlay.entries).length === 0 && Object.keys(overlay.deletions).length === 0
}

export function applyReportOverlay(saved: DailyEntry[], overlay: ReportOverlay): DailyEntry[] {
  const byDate = new Map(saved.map((entry) => [entry.date, entry]))

  Object.keys(overlay.deletions).forEach((date) => byDate.delete(date))
  Object.values(overlay.entries).forEach((entry) => byDate.set(entry.date, entry))

  return [...byDate.values()].sort((left, right) => right.date.localeCompare(left.date))
}

// Drop overlay parts that no longer differ from the saved data.
export function pruneReportOverlay(saved: DailyEntry[], overlay: ReportOverlay): ReportOverlay {
  const savedByDate = new Map(saved.map((entry) => [entry.date, entry]))
  const entries: Record<string, DailyEntry> = {}
  const deletions: Record<string, ReportDeletion> = {}

  Object.values(overlay.entries).forEach((entry) => {
    const savedEntry = savedByDate.get(entry.date)

    if (!savedEntry || !isSameEntryContent(savedEntry, entry)) {
      entries[entry.date] = entry
    }
  })

  Object.entries(overlay.deletions).forEach(([date, deletion]) => {
    if (savedByDate.has(date)) {
      deletions[date] = deletion
    }
  })

  return { entries, deletions }
}

export type MutationOutcome<T> =
  | { status: 'saved'; value: T }
  | { status: 'deleted' }
  | { status: 'conflict'; reason: ConflictReason; currentUpdatedAt?: string }

export type EntryMutation =
  | { kind: 'save'; key: string; entry: DailyEntry; expectedUpdatedAt: string | null }
  | { kind: 'delete'; key: string; id: string; expectedUpdatedAt: string }

export type SummaryMutation =
  | { kind: 'save'; key: string; summary: MonthlySummary; expectedUpdatedAt: string | null }
  | { kind: 'delete'; key: string; expectedUpdatedAt: string }

function round2(value: number | null | undefined) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : null
}

function comparableEntry(entry: DailyEntry) {
  const workItems = [...(entry.workItems ?? [])]
    .sort((left, right) => left.lineIndex - right.lineIndex)
    .map((workItem) => ({
      projectName: workItem.projectName.trim(),
      hours: round2(workItem.hours),
      hourlyRate: round2(workItem.hourlyRate),
      income: round2(workItem.invoicedIncome),
      lineIndex: workItem.lineIndex,
      pricingMode: workItem.pricingMode ?? null,
    }))

  return {
    date: entry.date,
    dayStatus: entry.dayStatus ?? 'worked',
    hours: round2(entry.hours),
    income: round2(entry.invoicedIncome),
    expenses: round2(entry.expenses),
    note: entry.note ?? '',
    source: entry.source ?? '',
    hourlyRate: workItems.length > 0 ? null : round2(entry.hourlyRate),
    pricingMode: workItems.length > 0 ? null : (entry.pricingMode ?? null),
    workItems,
  }
}

export function isSameEntryContent(left: DailyEntry, right: DailyEntry) {
  return JSON.stringify(comparableEntry(left)) === JSON.stringify(comparableEntry(right))
}

// Mutations for the unsaved report changes: edited days that differ from the saved
// version, and explicit deletions. Days not in the overlay are never touched.
export function diffReportOverlay(saved: DailyEntry[], overlay: ReportOverlay): EntryMutation[] {
  const savedByDate = new Map(saved.map((entry) => [entry.date, entry]))
  const mutations: EntryMutation[] = []

  Object.values(overlay.entries).forEach((entry) => {
    const savedEntry = savedByDate.get(entry.date)

    if (savedEntry && isSameEntryContent(savedEntry, entry)) {
      return
    }

    mutations.push({
      kind: 'save',
      key: entry.date,
      entry,
      expectedUpdatedAt: entry.updatedAt ?? null,
    })
  })

  Object.entries(overlay.deletions).forEach(([date, deletion]) => {
    if (savedByDate.has(date)) {
      mutations.push({
        kind: 'delete',
        key: date,
        id: deletion.id,
        expectedUpdatedAt: deletion.updatedAt,
      })
    }
  })

  return mutations.sort((left, right) => left.key.localeCompare(right.key))
}

// Merge a full list of days (as the Report screen builds it when saving) into the
// overlay: any day that differs from the saved data becomes an overlay entry.
export function mergeListIntoOverlay(
  saved: DailyEntry[],
  overlay: ReportOverlay,
  list: DailyEntry[],
): ReportOverlay {
  const savedByDate = new Map(saved.map((entry) => [entry.date, entry]))
  const entries = { ...overlay.entries }
  const deletions = { ...overlay.deletions }

  list.forEach((entry) => {
    const savedEntry = savedByDate.get(entry.date)
    const deletion = deletions[entry.date]

    if (deletion) {
      // Re-adding a day that was marked for deletion: update that saved row instead.
      delete deletions[entry.date]
      entries[entry.date] = { ...entry, id: deletion.id, updatedAt: deletion.updatedAt }
      return
    }

    if (!savedEntry || !isSameEntryContent(savedEntry, entry)) {
      entries[entry.date] = entry
    }
  })

  return pruneReportOverlay(saved, { entries, deletions })
}

function comparableSummary(summary: MonthlySummary) {
  return JSON.stringify({
    monthKey: summary.monthKey,
    monthType: summary.monthType,
    hours: round2(summary.hours),
    invoicedIncome: round2(summary.invoicedIncome),
    expenses: round2(summary.expenses),
    grossSalary: round2(summary.grossSalary),
    netSalaryReceived: round2(summary.netSalaryReceived),
    taxAlreadyWithheld: round2(summary.taxAlreadyWithheld),
    workLines: summary.workLines ?? [],
  })
}

export function isSameSummaryContent(left: MonthlySummary, right: MonthlySummary) {
  return comparableSummary(left) === comparableSummary(right)
}

export function diffMonthlySummaries(
  saved: MonthlySummary[],
  draft: MonthlySummary[],
): SummaryMutation[] {
  const savedByMonth = new Map(saved.map((summary) => [summary.monthKey, summary]))
  const mutations: SummaryMutation[] = []

  for (const summary of draft) {
    const savedSummary = savedByMonth.get(summary.monthKey)

    if (savedSummary && isSameSummaryContent(savedSummary, summary)) {
      continue
    }

    const isSameRow = savedSummary !== undefined && summary.updatedAt !== undefined
    mutations.push({
      kind: 'save',
      key: summary.monthKey,
      summary,
      expectedUpdatedAt: isSameRow ? (summary.updatedAt ?? null) : null,
    })
  }

  // Months missing from the draft are never deleted here: a draft can be older than
  // a month added on another device. Deleting a month is always an explicit action.
  return mutations
}

export function rebaseDraftSummaries(
  previousSaved: MonthlySummary[],
  nextSaved: MonthlySummary[],
  draft: MonthlySummary[],
): MonthlySummary[] {
  const previousByMonth = new Map(previousSaved.map((summary) => [summary.monthKey, summary]))
  const nextByMonth = new Map(nextSaved.map((summary) => [summary.monthKey, summary]))
  const draftByMonth = new Map(draft.map((summary) => [summary.monthKey, summary]))
  const months = new Set([...previousByMonth.keys(), ...nextByMonth.keys(), ...draftByMonth.keys()])
  const result: MonthlySummary[] = []

  for (const month of months) {
    const previous = previousByMonth.get(month)
    const next = nextByMonth.get(month)
    const draftSummary = draftByMonth.get(month)
    const isUntouched =
      previous && draftSummary
        ? draftSummary.updatedAt === previous.updatedAt &&
          isSameSummaryContent(previous, draftSummary)
        : !previous && !draftSummary

    if (isUntouched) {
      if (next) {
        result.push(next)
      }
      continue
    }

    if (draftSummary) {
      result.push(draftSummary)
    }
  }

  return result
}

// Untouched settings follow the latest saved version; edited settings keep their base.
export function rebaseDraftSettings(
  previousSaved: Settings | undefined,
  nextSaved: Settings,
  draft: Settings,
): Settings {
  if (
    previousSaved &&
    draft.updatedAt === previousSaved.updatedAt &&
    isSameSettingsContent(previousSaved, draft)
  ) {
    return nextSaved
  }

  return isSameSettingsContent(nextSaved, draft) ? nextSaved : draft
}

// For a draft restored from storage (base unknown): add saved months the draft
// doesn't have, and take the saved copy of months the draft didn't change.
export function mergeSavedIntoDraftSummaries(
  saved: MonthlySummary[],
  draft: MonthlySummary[],
): MonthlySummary[] {
  const draftByMonth = new Map(draft.map((summary) => [summary.monthKey, summary]))
  const result = draft.map((summary) => {
    const savedSummary = saved.find((item) => item.monthKey === summary.monthKey)
    return savedSummary && isSameSummaryContent(savedSummary, summary) ? savedSummary : summary
  })

  saved.forEach((summary) => {
    if (!draftByMonth.has(summary.monthKey)) {
      result.push(summary)
    }
  })

  return result
}

export function hasSummaryChanges(saved: MonthlySummary[], draft: MonthlySummary[]) {
  if (saved.length !== draft.length) {
    return true
  }

  const savedByMonth = new Map(saved.map((summary) => [summary.monthKey, summary]))
  return draft.some((summary) => {
    const savedSummary = savedByMonth.get(summary.monthKey)
    return !savedSummary || !isSameSummaryContent(savedSummary, summary)
  })
}

function comparableSettings(settings: Settings) {
  // Only the selected year's editable fields are a draft. Other-year snapshots
  // and object key order must not make an unchanged plan look edited.
  const { updatedAt: _updatedAt, yearlySettings: _years, ...rest } = settings
  return JSON.stringify(Object.entries(rest).filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)))
}

export function isSameSettingsContent(left: Settings, right: Settings) {
  return comparableSettings(left) === comparableSettings(right)
}

export interface MutationRun<M, T> {
  status: 'done' | 'conflict' | 'error'
  applied: Array<{ mutation: M; outcome: MutationOutcome<T> }>
  conflict?: { mutation: M; reason: ConflictReason; currentUpdatedAt?: string }
  error?: unknown
}

// Runs mutations one at a time, stopping at the first conflict or failure.
// Mutations that already succeeded are reported so the caller can keep them.
export async function runMutations<M extends { key: string }, T>(
  mutations: M[],
  perform: (mutation: M) => Promise<MutationOutcome<T>>,
): Promise<MutationRun<M, T>> {
  const applied: MutationRun<M, T>['applied'] = []

  for (const mutation of mutations) {
    let outcome: MutationOutcome<T>

    try {
      outcome = await perform(mutation)
    } catch (error) {
      return { status: 'error', applied, error }
    }

    if (outcome.status === 'conflict') {
      return {
        status: 'conflict',
        applied,
        conflict: { mutation, reason: outcome.reason, currentUpdatedAt: outcome.currentUpdatedAt },
      }
    }

    applied.push({ mutation, outcome })
  }

  return { status: 'done', applied }
}

function createUuid() {
  const cryptoApi = globalThis.crypto

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID()
  }

  // randomUUID needs a secure context; getRandomValues also works over plain http (LAN dev).
  const bytes = new Uint8Array(16)
  cryptoApi.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Retrying the exact same change reuses its mutation id, so a save that committed
// but lost its response is recognised by the database instead of being applied twice
// or reported as a conflict. A different change gets a new id.
export class MutationIds {
  private ids = new Map<string, string>()

  idFor(fingerprint: string) {
    let id = this.ids.get(fingerprint)

    if (!id) {
      id = createUuid()
      this.ids.set(fingerprint, id)
    }

    return id
  }

  forget(fingerprint: string) {
    this.ids.delete(fingerprint)
  }
}

export function fingerprintOf(value: unknown) {
  return JSON.stringify(value)
}
