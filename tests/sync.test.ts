import { describe, expect, it } from 'vitest'
import {
  applyReportOverlay,
  diffMonthlySummaries,
  diffReportOverlay,
  EMPTY_REPORT_OVERLAY,
  fingerprintOf,
  mergeListIntoOverlay,
  MutationIds,
  pruneReportOverlay,
  rebaseDraftSettings,
  rebaseDraftSummaries,
  runMutations,
  type EntryMutation,
  type MutationOutcome,
  type ReportOverlay,
} from '@/lib/sync'
import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'

const day = (date: string, hours: number, updatedAt?: string): DailyEntry => ({
  id: `entry-${date}`,
  date,
  dayStatus: 'worked',
  hours,
  invoicedIncome: hours * 50,
  expenses: 0,
  pricingMode: 'hourly',
  hourlyRate: 50,
  ...(updatedAt ? { updatedAt } : {}),
})

// In-memory stand-in for the database functions, with the same rules: version
// check, mutation-id replay, "exists"/"deleted" conflicts. It can also commit a
// change and then lose the response.
class FakeServer {
  rows = new Map<string, DailyEntry & { mutationId?: string }>()
  private version = 0
  loseNextResponse = false

  private nextVersion() {
    this.version += 1
    return `v${this.version}`
  }

  seed(entry: DailyEntry) {
    const stored = { ...entry, updatedAt: this.nextVersion() }
    this.rows.set(entry.date, stored)
    return stored
  }

  load() {
    return [...this.rows.values()].map(({ mutationId: _mutationId, ...entry }) => ({ ...entry }))
  }

  private respond<T>(outcome: MutationOutcome<T>) {
    if (this.loseNextResponse) {
      this.loseNextResponse = false
      throw new Error('Network error: response lost')
    }

    return outcome
  }

  perform(mutation: EntryMutation, mutationId: string): MutationOutcome<DailyEntry> {
    const existing = this.rows.get(mutation.key)

    if (mutation.kind === 'delete') {
      if (!existing) {
        return this.respond({ status: 'deleted' })
      }

      if (existing.updatedAt !== mutation.expectedUpdatedAt) {
        return this.respond({ status: 'conflict', reason: 'changed' })
      }

      this.rows.delete(mutation.key)
      return this.respond({ status: 'deleted' })
    }

    if (existing && existing.mutationId === mutationId) {
      return this.respond({ status: 'saved', value: { ...existing } })
    }

    if (mutation.expectedUpdatedAt === null) {
      if (existing) {
        return this.respond({ status: 'conflict', reason: 'exists' })
      }
    } else if (!existing) {
      return this.respond({ status: 'conflict', reason: 'deleted' })
    } else if (existing.updatedAt !== mutation.expectedUpdatedAt) {
      return this.respond({ status: 'conflict', reason: 'changed' })
    }

    const stored = { ...mutation.entry, updatedAt: this.nextVersion(), mutationId }
    this.rows.set(mutation.key, stored)
    const { mutationId: _mutationId, ...value } = stored
    return this.respond({ status: 'saved', value })
  }
}

// A device: its loaded copy, its unsaved overlay, and the app's save routine.
class Device {
  saved: DailyEntry[] = []
  overlay: ReportOverlay = EMPTY_REPORT_OVERLAY
  private ids = new MutationIds()

  constructor(private server: FakeServer) {}

  load() {
    this.saved = this.server.load()
    this.overlay = pruneReportOverlay(this.saved, this.overlay)
  }

  edit(entry: DailyEntry) {
    this.overlay = mergeListIntoOverlay(this.saved, this.overlay, [entry])
  }

  view() {
    return applyReportOverlay(this.saved, this.overlay)
  }

  async save() {
    const run = await runMutations(diffReportOverlay(this.saved, this.overlay), async (mutation) => {
      const fingerprint = fingerprintOf(mutation)
      const outcome = this.server.perform(mutation, this.ids.idFor(fingerprint))
      if (outcome.status !== 'conflict') {
        this.ids.forget(fingerprint)
      }
      return outcome
    })

    run.applied.forEach(({ mutation, outcome }) => {
      this.saved = this.saved.filter((entry) => entry.date !== mutation.key)
      if (outcome.status === 'saved') {
        this.saved = [outcome.value, ...this.saved]
      }
    })
    this.overlay = pruneReportOverlay(this.saved, this.overlay)
    return run
  }
}

describe('two stale sessions (client logic against version-checked saves)', () => {
  it("a stale device's save conflicts and keeps its draft; the newer save survives", async () => {
    const server = new FakeServer()
    server.seed(day('2026-10-16', 7))
    const phone = new Device(server)
    const mac = new Device(server)
    phone.load()
    mac.load()

    phone.edit({ ...phone.view()[0], hours: 8, invoicedIncome: 400 })
    mac.edit({ ...mac.view()[0], hours: 3, invoicedIncome: 150 })

    expect((await phone.save()).status).toBe('done')
    const macRun = await mac.save()

    expect(macRun.status).toBe('conflict')
    expect(server.rows.get('2026-10-16')?.hours).toBe(8)
    // "Keep editing": the Mac's change is still there, unsaved.
    expect(mac.overlay.entries['2026-10-16']?.hours).toBe(3)
  })

  it("a stale device never deletes or reverts days it didn't touch", async () => {
    const server = new FakeServer()
    server.seed(day('2026-10-14', 4))
    const mac = new Device(server)
    mac.load()

    // Meanwhile the phone adds a day and changes another.
    const phone = new Device(server)
    phone.load()
    phone.edit(day('2026-10-16', 7))
    phone.edit({ ...phone.view().find((entry) => entry.date === '2026-10-14')!, hours: 5, invoicedIncome: 250 })
    await phone.save()

    // The stale Mac edits only one unrelated day and saves.
    mac.edit(day('2026-10-20', 9))
    const macRun = await mac.save()

    expect(macRun.status).toBe('done')
    expect(server.rows.get('2026-10-16')?.hours).toBe(7) // not deleted
    expect(server.rows.get('2026-10-14')?.hours).toBe(5) // not reverted
    expect(server.rows.get('2026-10-20')?.hours).toBe(9)
  })

  it('a refresh shows the other device\'s days without discarding unsaved work', async () => {
    const server = new FakeServer()
    server.seed(day('2026-10-14', 4))
    const mac = new Device(server)
    mac.load()
    mac.edit(day('2026-10-20', 9)) // unsaved

    server.seed(day('2026-10-16', 7)) // added on the phone
    mac.load()

    expect(mac.view().map((entry) => entry.date).sort()).toEqual(['2026-10-14', '2026-10-16', '2026-10-20'])
    expect(mac.overlay.entries['2026-10-20']).toBeDefined()
  })

  it('retry after a lost response: no duplicate, no false conflict', async () => {
    const server = new FakeServer()
    const seeded = server.seed(day('2026-10-16', 7))
    const mac = new Device(server)
    mac.load()
    mac.edit({ ...seeded, hours: 8, invoicedIncome: 400 })

    server.loseNextResponse = true
    const failed = await mac.save()
    expect(failed.status).toBe('error')
    expect(server.rows.get('2026-10-16')?.hours).toBe(8) // it did commit
    expect(mac.overlay.entries['2026-10-16']).toBeDefined() // kept for retry

    const retry = await mac.save()
    expect(retry.status).toBe('done')
    expect(mac.overlay.entries['2026-10-16']).toBeUndefined()
    expect(mac.saved.find((entry) => entry.date === '2026-10-16')?.hours).toBe(8)
  })

  it('a partly failed save keeps only the unsaved days for the retry', async () => {
    const server = new FakeServer()
    const mac = new Device(server)
    mac.load()
    mac.edit(day('2026-10-01', 1))
    mac.edit(day('2026-10-02', 2))
    mac.edit(day('2026-10-03', 3))

    const original = server.perform.bind(server)
    let calls = 0
    server.perform = (mutation, mutationId) => {
      calls += 1
      if (calls === 2) {
        throw new Error('offline')
      }
      return original(mutation, mutationId)
    }

    const run = await mac.save()
    expect(run.status).toBe('error')
    expect(Object.keys(mac.overlay.entries).sort()).toEqual(['2026-10-02', '2026-10-03'])
  })

  it('deleting is explicit and version-checked', async () => {
    const server = new FakeServer()
    const seeded = server.seed(day('2026-10-16', 7))
    const mac = new Device(server)
    mac.load()
    mac.overlay = { entries: {}, deletions: { '2026-10-16': { id: seeded.id, updatedAt: seeded.updatedAt! } } }

    server.seed({ ...seeded, hours: 9 }) // changed on the phone meanwhile
    expect((await mac.save()).status).toBe('conflict')
    expect(server.rows.get('2026-10-16')?.hours).toBe(9)
  })
})

describe('overlay helpers', () => {
  it('only sends changed days', () => {
    const saved = [day('2026-10-14', 4, 'v1'), day('2026-10-15', 5, 'v2')]
    const overlay = mergeListIntoOverlay(saved, EMPTY_REPORT_OVERLAY, [
      day('2026-10-14', 4, 'v1'), // unchanged
      day('2026-10-15', 6, 'v2'), // changed
    ])
    expect(diffReportOverlay(saved, overlay)).toEqual([
      expect.objectContaining({ kind: 'save', key: '2026-10-15', expectedUpdatedAt: 'v2' }),
    ])
  })

  it('re-adding a day marked for deletion updates the saved row', () => {
    const saved = [day('2026-10-14', 4, 'v1')]
    const overlay = mergeListIntoOverlay(
      saved,
      { entries: {}, deletions: { '2026-10-14': { id: 'entry-2026-10-14', updatedAt: 'v1' } } },
      [{ ...day('2026-10-14', 6), id: 'new-id' }],
    )
    expect(overlay.deletions).toEqual({})
    expect(overlay.entries['2026-10-14']).toMatchObject({ id: 'entry-2026-10-14', updatedAt: 'v1' })
  })

  it('MutationIds reuses an id only for the identical change', () => {
    const ids = new MutationIds()
    expect(ids.idFor('a')).toBe(ids.idFor('a'))
    expect(ids.idFor('a')).not.toBe(ids.idFor('b'))
  })
})

describe('configuration drafts', () => {
  const month = (monthKey: string, hours: number, updatedAt?: string): MonthlySummary => ({
    monthKey,
    monthType: 'business',
    hours,
    invoicedIncome: hours * 43.75,
    expenses: 0,
    grossSalary: null,
    netSalaryReceived: null,
    taxAlreadyWithheld: null,
    ...(updatedAt ? { updatedAt } : {}),
  })

  it('never deletes months missing from a draft', () => {
    const saved = [month('2026-08', 160, 'v1'), month('2026-09', 203, 'v2')]
    const staleDraft = [month('2026-08', 150, 'v1')] // made before September was added
    expect(diffMonthlySummaries(saved, staleDraft)).toEqual([
      expect.objectContaining({ kind: 'save', key: '2026-08' }),
    ])
  })

  it('rebases untouched months and keeps edited ones with their base version', () => {
    const previous = [month('2026-08', 160, 'v1'), month('2026-09', 203, 'v2')]
    const next = [month('2026-08', 170, 'v3'), month('2026-09', 210, 'v4')]
    const draft = [month('2026-08', 160, 'v1'), month('2026-09', 100, 'v2')] // Sept edited
    const rebased = rebaseDraftSummaries(previous, next, draft)

    expect(rebased.find((item) => item.monthKey === '2026-08')).toMatchObject({ hours: 170, updatedAt: 'v3' })
    expect(rebased.find((item) => item.monthKey === '2026-09')).toMatchObject({ hours: 100, updatedAt: 'v2' })
  })

  it('rebases untouched settings, keeps edited settings', () => {
    const base = { targetNetMonth: 4500, updatedAt: 'v1' } as Settings
    const next = { targetNetMonth: 4600, updatedAt: 'v2' } as Settings
    expect(rebaseDraftSettings(base, next, base)).toBe(next)
    const edited = { targetNetMonth: 5000, updatedAt: 'v1' } as Settings
    expect(rebaseDraftSettings(base, next, edited)).toBe(edited)
  })
})
