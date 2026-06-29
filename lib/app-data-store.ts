import { getEntryHours, getEntryInvoicedIncome, sortMonthlySummaries } from './calculations'
import {
  normalizeEntry,
  normalizeMonthlySummary,
  normalizeWorkItem,
  normalizeSettings,
  starterStoredState,
} from './default-state'
import { getCurrentSession, getSupabaseClient, hasSupabaseConfig } from './supabase'
import type { DailyEntry, MonthlySummary, Settings, WorkItem } from './types'

interface RemoteAppData {
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}

export interface LoadedRemoteAppData extends RemoteAppData {
  displayName?: string
  isNewUser: boolean
}

interface AppSettingsRow {
  target_net_month?: number | null
  weekly_hours_target?: number | null
  default_shift_income?: number | null
  default_shift_hours?: number | null
  spouse_monthly_income?: number | null
  reserve_buffer_percent?: number | null
  qualifies_for_self_employed_deduction?: boolean | null
  vacation_days_per_year?: number | null
  user_id?: string
}

interface ProfileRow {
  display_name?: string | null
}

interface DailyEntryRow {
  id: string
  date: string
  day_status?: string | null
  hours: number
  invoiced_income: number
  paid_income: number
  expenses: number
  source: string | null
  note: string | null
  user_id?: string | null
}

interface DailyEntryWorkItemRow {
  id: string
  daily_entry_id: string
  project_name: string | null
  hours: number
  hourly_rate: number | null
  invoiced_income: number
  created_at?: string
  line_index: number
}

interface MonthlySummaryRow {
  month_key: string
  month_type?: string | null
  hours: number | null
  invoiced_income: number | null
  paid_income: number | null
  expenses: number | null
  gross_salary?: number | null
  net_salary_received?: number | null
  tax_already_withheld?: number | null
  user_id?: string | null
}

function getStarterData(): RemoteAppData {
  return {
    entries: starterStoredState.entries,
    monthlySummaries: starterStoredState.monthlySummaries,
    settings: starterStoredState.settings,
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
    return starterStoredState.settings
  }

  return normalizeSettings({
    defaultShiftHours: row.default_shift_hours,
    defaultShiftIncome: row.default_shift_income,
    qualifiesForSelfEmployedDeduction: row.qualifies_for_self_employed_deduction,
    reserveBufferPercent: row.reserve_buffer_percent,
    spouseMonthlyIncome: row.spouse_monthly_income,
    targetNetMonth: row.target_net_month,
    vacationDaysPerYear: row.vacation_days_per_year,
    weeklyHoursTarget: row.weekly_hours_target,
  })
}

function mapSettingsToRow(settings: Settings, userId: string) {
  return {
    default_shift_hours: settings.defaultShiftHours,
    default_shift_income: settings.defaultShiftIncome,
    user_id: userId,
    qualifies_for_self_employed_deduction: settings.qualifiesForSelfEmployedDeduction,
    reserve_buffer_percent: settings.reserveBufferPercent,
    spouse_monthly_income: settings.spouseMonthlyIncome,
    target_net_month: settings.targetNetMonth,
    vacation_days_per_year: settings.vacationDaysPerYear,
    weekly_hours_target: settings.weeklyHoursTarget,
  }
}

function hasAnyUserData({
  hasSettingsRow,
  entries,
  monthlySummaries,
}: {
  hasSettingsRow: boolean
  entries: DailyEntry[]
  monthlySummaries: MonthlySummary[]
}) {
  return hasSettingsRow || entries.length > 0 || monthlySummaries.length > 0
}


function mapWorkItemFromRow(row: DailyEntryWorkItemRow): WorkItem | null {
  return normalizeWorkItem({
    dailyEntryId: row.daily_entry_id,
    hourlyRate: row.hourly_rate,
    hours: row.hours,
    id: row.id,
    invoicedIncome: row.invoiced_income,
    lineIndex: row.line_index,
    projectName: row.project_name ?? '',
  })
}

function mapEntryFromRow(row: DailyEntryRow, workItems: WorkItem[] = []): DailyEntry | null {
  const isWorkedEntry = (row.day_status ?? 'worked') === 'worked'
  const nextEntry = normalizeEntry({
    date: row.date,
    dayStatus: row.day_status,
    expenses: row.expenses,
    hours: row.hours,
    id: row.id,
    invoicedIncome: row.invoiced_income,
    note: row.note,
    paidIncome: row.paid_income,
    source: row.source,
    workItems: isWorkedEntry ? workItems : [],
  })

  if (!nextEntry || !isWorkedEntry || workItems.length === 0) {
    return nextEntry
  }

  return {
    ...nextEntry,
    hours: getEntryHours(nextEntry),
    invoicedIncome: getEntryInvoicedIncome(nextEntry),
  }
}

function mapEntryToRow(entry: DailyEntry, userId: string) {
  const isWorkedEntry = (entry.dayStatus ?? 'worked') === 'worked'

  return {
    date: entry.date,
    day_status: entry.dayStatus ?? 'worked',
    expenses: entry.expenses,
    hours: isWorkedEntry ? getEntryHours(entry) : 0,
    id: entry.id,
    invoiced_income: isWorkedEntry ? getEntryInvoicedIncome(entry) : 0,
    note: entry.note ?? null,
    paid_income: isWorkedEntry ? entry.paidIncome : 0,
    source: entry.source ?? null,
    user_id: userId,
  }
}

function getWorkItemsToSave(entry: DailyEntry) {
  if ((entry.dayStatus ?? 'worked') !== 'worked' || !entry.workItems || entry.workItems.length === 0) {
    return []
  }

  return entry.workItems
    .map((workItem, index) => ({
      ...workItem,
      lineIndex: workItem.lineIndex ?? index,
    }))
    .sort((left, right) => left.lineIndex - right.lineIndex)
}

function mapWorkItemToRow(workItem: WorkItem, entryId: string) {
  return {
    daily_entry_id: entryId,
    project_name: workItem.projectName.trim() === '' ? null : workItem.projectName.trim(),
    hours: workItem.hours,
    hourly_rate: workItem.hourlyRate,
    invoiced_income: workItem.invoicedIncome,
    line_index: workItem.lineIndex,
  }
}

function mapMonthlySummaryFromRow(row: MonthlySummaryRow): MonthlySummary | null {
  return normalizeMonthlySummary({
    expenses: row.expenses,
    grossSalary: row.gross_salary,
    hours: row.hours,
    invoicedIncome: row.invoiced_income,
    monthType: row.month_type,
    monthKey: row.month_key,
    netSalaryReceived: row.net_salary_received,
    paidIncome: row.paid_income,
    taxAlreadyWithheld: row.tax_already_withheld,
  })
}

function mapMonthlySummaryToRow(summary: MonthlySummary, userId: string) {
  return {
    expenses: summary.expenses,
    gross_salary: summary.grossSalary,
    hours: summary.hours,
    invoiced_income: summary.invoicedIncome,
    month_key: summary.monthKey,
    month_type: summary.monthType,
    net_salary_received: summary.netSalaryReceived,
    paid_income: summary.paidIncome,
    tax_already_withheld: summary.taxAlreadyWithheld,
    user_id: userId,
  }
}

async function replaceDailyEntries(entries: DailyEntry[]) {
  const supabase = getSupabaseClient()
  if (!supabase) {
    return
  }
  const userId = await getRequiredUserId()
  const normalizedEntries = entries.map((entry) => {
    const isWorkedEntry = (entry.dayStatus ?? 'worked') === 'worked'

    if (!isWorkedEntry) {
      return {
        ...entry,
        hours: 0,
        invoicedIncome: 0,
        paidIncome: 0,
        expenses: entry.expenses,
        workItems: undefined,
      }
    }

    if (!entry.workItems || entry.workItems.length === 0) {
      return entry
    }

    return {
      ...entry,
      hours: getEntryHours(entry),
      invoicedIncome: getEntryInvoicedIncome(entry),
    }
  })

  const existingResult = await supabase.from('daily_entries').select('id')
  if (existingResult.error) {
    throw existingResult.error
  }

  if (normalizedEntries.length > 0) {
    const upsertResult = await supabase
      .from('daily_entries')
      .upsert(normalizedEntries.map((entry) => mapEntryToRow(entry, userId)), { onConflict: 'id' })

    if (upsertResult.error) {
      throw upsertResult.error
    }
  }

  const nextIds = new Set(normalizedEntries.map((entry) => entry.id))
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

  const entryIdsToReplace = normalizedEntries.map((entry) => entry.id)
  if (entryIdsToReplace.length > 0) {
    const deleteWorkItemsResult = await supabase
      .from('daily_entry_work_items')
      .delete()
      .in('daily_entry_id', entryIdsToReplace)

    if (deleteWorkItemsResult.error) {
      throw deleteWorkItemsResult.error
    }
  }

  const workItemRows = normalizedEntries.flatMap((entry) =>
    getWorkItemsToSave(entry).map((workItem) => mapWorkItemToRow(workItem, entry.id)),
  )

  if (workItemRows.length > 0) {
    const insertWorkItemsResult = await supabase
      .from('daily_entry_work_items')
      .insert(workItemRows)

    if (insertWorkItemsResult.error) {
      throw insertWorkItemsResult.error
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
        onConflict: 'user_id,month_key',
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

  const result = await supabase
    .from('app_settings')
    .upsert(mapSettingsToRow(settings, userId), { onConflict: 'user_id' })

  if (result.error) {
    throw result.error
  }
}

export async function loadRemoteAppData(): Promise<LoadedRemoteAppData> {
  if (!hasSupabaseConfig()) {
    return {
      ...getStarterData(),
      displayName: undefined,
      isNewUser: false,
    }
  }

  const supabase = getSupabaseClient()
  if (!supabase) {
    return {
      ...getStarterData(),
      displayName: undefined,
      isNewUser: false,
    }
  }

  const userId = await getRequiredUserId()

  const [settingsResult, entriesResult, monthlySummariesResult, profileResult] = await Promise.all([
    supabase
      .from('app_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('daily_entries').select('*').order('date', { ascending: false }),
    supabase.from('monthly_summaries').select('*').order('month_key', { ascending: true }),
    supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
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

  if (profileResult.error) {
    throw profileResult.error
  }

  const entryIds =
    entriesResult.data
      ?.map((row) => (row as DailyEntryRow).id)
      .filter((id): id is string => typeof id === 'string') ?? []
  const workItemsResult =
    entryIds.length > 0
      ? await supabase
          .from('daily_entry_work_items')
          .select('*')
          .in('daily_entry_id', entryIds)
          .order('daily_entry_id', { ascending: true })
          .order('line_index', { ascending: true })
      : null

  if (workItemsResult?.error) {
    throw workItemsResult.error
  }

  const workItemsByEntryId = new Map<string, WorkItem[]>()
  workItemsResult?.data?.forEach((row) => {
    const workItem = mapWorkItemFromRow(row as DailyEntryWorkItemRow)

    if (!workItem?.dailyEntryId) {
      return
    }

    const currentItems = workItemsByEntryId.get(workItem.dailyEntryId) ?? []
    currentItems.push(workItem)
    workItemsByEntryId.set(workItem.dailyEntryId, currentItems)
  })

  const remoteEntries =
    entriesResult.data
      ?.map((row) => {
        const entryRow = row as DailyEntryRow
        return mapEntryFromRow(entryRow, workItemsByEntryId.get(entryRow.id) ?? [])
      })
      .filter((entry): entry is DailyEntry => entry !== null) ?? []

  const remoteMonthlySummaries = sortMonthlySummaries(
    monthlySummariesResult.data
      ?.map((row) => mapMonthlySummaryFromRow(row as MonthlySummaryRow))
      .filter((summary): summary is MonthlySummary => summary !== null) ?? [],
  )

  const hasSettingsRow = settingsResult.data !== null
  const hasUserData = hasAnyUserData({
    hasSettingsRow,
    entries: remoteEntries,
    monthlySummaries: remoteMonthlySummaries,
  })
  const displayName =
    typeof (profileResult.data as ProfileRow | null)?.display_name === 'string'
      ? ((profileResult.data as ProfileRow | null)?.display_name ?? undefined)
      : undefined

  if (!hasUserData) {
    return {
      ...getStarterData(),
      displayName,
      isNewUser: true,
    }
  }

  return {
    displayName,
    entries: remoteEntries,
    monthlySummaries: remoteMonthlySummaries,
    settings: mapSettingsFromRow(settingsResult.data as AppSettingsRow | null),
    isNewUser: false,
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
