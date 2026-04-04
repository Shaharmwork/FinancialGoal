import { sortMonthlySummaries } from './calculations'
import {
  defaultStoredState,
  normalizeEntry,
  normalizeMonthlySummary,
  normalizeSettings,
} from './default-state'
import { getCurrentSession, getSupabaseClient, hasSupabaseConfig } from './supabase'
import type { DailyEntry, MonthlySummary, Settings, StoredAppState } from './types'

type RemoteAppData = Pick<StoredAppState, 'entries' | 'monthlySummaries' | 'settings'>

const SETTINGS_ROW_ID = 'default'

interface AppSettingsRow {
  target_net_month?: number
  weekly_hours_target?: number
  default_shift_income?: number
  default_shift_hours?: number
  spouse_monthly_income?: number
  reserve_buffer_percent?: number
  qualifies_for_self_employed_deduction?: boolean
  user_id?: string
}

interface DailyEntryRow {
  id: string
  date: string
  hours: number
  invoiced_income: number
  paid_income: number
  expenses: number
  source: string | null
  note: string | null
  user_id?: string | null
}

interface MonthlySummaryRow {
  month_key: string
  hours: number
  invoiced_income: number
  paid_income: number
  expenses: number
  user_id?: string | null
}

function getSeedData(localState: StoredAppState | null): RemoteAppData {
  return {
    entries: localState?.entries ?? defaultStoredState.entries,
    monthlySummaries: localState?.monthlySummaries ?? defaultStoredState.monthlySummaries,
    settings: localState?.settings ?? defaultStoredState.settings,
  }
}

async function getRequiredUserId() {
  const session = await getCurrentSession()
  const userId = session?.user?.id

  if (!userId) {
    throw new Error('No authenticated Supabase user available for remote write.')
  }

  return userId
}

function mapSettingsFromRow(row: AppSettingsRow | null): Settings {
  if (!row) {
    return defaultStoredState.settings
  }

  return normalizeSettings({
    defaultShiftHours: row.default_shift_hours,
    defaultShiftIncome: row.default_shift_income,
    qualifiesForSelfEmployedDeduction: row.qualifies_for_self_employed_deduction,
    reserveBufferPercent: row.reserve_buffer_percent,
    spouseMonthlyIncome: row.spouse_monthly_income,
    targetNetMonth: row.target_net_month,
    weeklyHoursTarget: row.weekly_hours_target,
  })
}

function mapSettingsToRow(settings: Settings, userId: string) {
  return {
    default_shift_hours: settings.defaultShiftHours,
    default_shift_income: settings.defaultShiftIncome,
    id: SETTINGS_ROW_ID,
    user_id: userId,
    qualifies_for_self_employed_deduction: settings.qualifiesForSelfEmployedDeduction,
    reserve_buffer_percent: settings.reserveBufferPercent,
    spouse_monthly_income: settings.spouseMonthlyIncome,
    target_net_month: settings.targetNetMonth,
    weekly_hours_target: settings.weeklyHoursTarget,
  }
}

function mapEntryFromRow(row: DailyEntryRow): DailyEntry | null {
  return normalizeEntry({
    date: row.date,
    expenses: row.expenses,
    hours: row.hours,
    id: row.id,
    invoicedIncome: row.invoiced_income,
    note: row.note,
    paidIncome: row.paid_income,
    source: row.source,
  })
}

function mapEntryToRow(entry: DailyEntry, userId: string) {
  return {
    date: entry.date,
    expenses: entry.expenses,
    hours: entry.hours,
    id: entry.id,
    invoiced_income: entry.invoicedIncome,
    note: entry.note ?? null,
    paid_income: entry.paidIncome,
    source: entry.source ?? null,
    user_id: userId,
  }
}

function mapMonthlySummaryFromRow(row: MonthlySummaryRow): MonthlySummary | null {
  return normalizeMonthlySummary({
    expenses: row.expenses,
    hours: row.hours,
    invoicedIncome: row.invoiced_income,
    monthKey: row.month_key,
    paidIncome: row.paid_income,
  })
}

function mapMonthlySummaryToRow(summary: MonthlySummary, userId: string) {
  return {
    expenses: summary.expenses,
    hours: summary.hours,
    invoiced_income: summary.invoicedIncome,
    month_key: summary.monthKey,
    paid_income: summary.paidIncome,
    user_id: userId,
  }
}

async function replaceDailyEntries(entries: DailyEntry[]) {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return
  }
  const userId = await getRequiredUserId()

  const existingResult = await supabase.from('daily_entries').select('id')
  if (existingResult.error) {
    throw existingResult.error
  }

  if (entries.length > 0) {
    const upsertResult = await supabase
      .from('daily_entries')
      .upsert(entries.map((entry) => mapEntryToRow(entry, userId)), { onConflict: 'id' })

    if (upsertResult.error) {
      throw upsertResult.error
    }
  }

  const nextIds = new Set(entries.map((entry) => entry.id))
  const idsToDelete =
    existingResult.data
      ?.map((row) => row.id)
      .filter((id): id is string => typeof id === 'string' && !nextIds.has(id)) ?? []

  if (idsToDelete.length > 0) {
    const deleteResult = await supabase.from('daily_entries').delete().in('id', idsToDelete)

    if (deleteResult.error) {
      throw deleteResult.error
    }
  }
}

async function replaceMonthlySummaries(monthlySummaries: MonthlySummary[]) {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return
  }
  const userId = await getRequiredUserId()

  const existingResult = await supabase.from('monthly_summaries').select('month_key')
  if (existingResult.error) {
    throw existingResult.error
  }

  if (monthlySummaries.length > 0) {
    const upsertResult = await supabase
      .from('monthly_summaries')
      .upsert(monthlySummaries.map((summary) => mapMonthlySummaryToRow(summary, userId)), {
        onConflict: 'month_key',
      })

    if (upsertResult.error) {
      throw upsertResult.error
    }
  }

  const nextMonthKeys = new Set(monthlySummaries.map((summary) => summary.monthKey))
  const monthKeysToDelete =
    existingResult.data
      ?.map((row) => row.month_key)
      .filter(
        (monthKey): monthKey is string =>
          typeof monthKey === 'string' && !nextMonthKeys.has(monthKey),
      ) ?? []

  if (monthKeysToDelete.length > 0) {
    const deleteResult = await supabase
      .from('monthly_summaries')
      .delete()
      .in('month_key', monthKeysToDelete)

    if (deleteResult.error) {
      throw deleteResult.error
    }
  }
}

async function saveSettingsInternal(settings: Settings) {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return
  }
  const userId = await getRequiredUserId()

  const result = await supabase.from('app_settings').upsert(mapSettingsToRow(settings, userId), {
    onConflict: 'id',
  })

  if (result.error) {
    throw result.error
  }
}

async function seedRemoteData(seedData: RemoteAppData) {
  await saveSettingsInternal(seedData.settings)
  await replaceDailyEntries(seedData.entries)
  await replaceMonthlySummaries(seedData.monthlySummaries)
}

export async function loadRemoteAppData(localState: StoredAppState | null): Promise<RemoteAppData> {
  if (!hasSupabaseConfig()) {
    return getSeedData(localState)
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    return getSeedData(localState)
  }

  const [settingsResult, entriesResult, monthlySummariesResult] = await Promise.all([
    supabase.from('app_settings').select('*').eq('id', SETTINGS_ROW_ID).maybeSingle(),
    supabase.from('daily_entries').select('*').order('date', { ascending: false }),
    supabase.from('monthly_summaries').select('*').order('month_key', { ascending: true }),
  ])

  if (settingsResult.error) {
    throw settingsResult.error
  }

  if (entriesResult.error) {
    throw entriesResult.error
  }

  if (monthlySummariesResult.error) {
    throw monthlySummariesResult.error
  }

  const remoteEntries =
    entriesResult.data
      ?.map((row) => mapEntryFromRow(row as DailyEntryRow))
      .filter((entry): entry is DailyEntry => entry !== null) ?? []

  const remoteMonthlySummaries = sortMonthlySummaries(
    monthlySummariesResult.data
      ?.map((row) => mapMonthlySummaryFromRow(row as MonthlySummaryRow))
      .filter((summary): summary is MonthlySummary => summary !== null) ?? [],
  )

  const hasRemoteData =
    settingsResult.data !== null || remoteEntries.length > 0 || remoteMonthlySummaries.length > 0

  if (!hasRemoteData) {
    const seedData = getSeedData(localState)
    await seedRemoteData(seedData)
    return seedData
  }

  return {
    entries: remoteEntries,
    monthlySummaries: remoteMonthlySummaries,
    settings: mapSettingsFromRow(settingsResult.data as AppSettingsRow | null),
  }
}

export async function saveSettingsToSupabase(settings: Settings) {
  if (!hasSupabaseConfig()) {
    return
  }

  await saveSettingsInternal(settings)
}

export async function saveDailyEntriesToSupabase(entries: DailyEntry[]) {
  if (!hasSupabaseConfig()) {
    return
  }

  await replaceDailyEntries(entries)
}

export async function saveMonthlySummariesToSupabase(monthlySummaries: MonthlySummary[]) {
  if (!hasSupabaseConfig()) {
    return
  }

  await replaceMonthlySummaries(monthlySummaries)
}
