import { getEntryHours, getEntryInvoicedIncome, sortMonthlySummaries } from './calculations'
import {
  normalizeEntry,
  normalizeMonthlySummary,
  normalizeWorkItem,
  normalizeSettings,
  starterStoredState,
} from './default-state'
import { getCurrentSession, getSupabaseClient, hasSupabaseConfig } from './supabase'
import type { ConflictReason, MutationOutcome } from './sync'
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
  qualifies_for_starters_deduction?: boolean | null
  vacation_days_per_year?: number | null
  updated_at?: string | null
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
  hourly_rate?: number | null
  pricing_mode?: string | null
  invoiced_income: number
  expenses: number
  source: string | null
  note: string | null
  updated_at?: string | null
  user_id?: string | null
}

interface DailyEntryWorkItemRow {
  id: string
  daily_entry_id: string
  project_name: string | null
  hours: number
  hourly_rate: number | null
  invoiced_income: number
  line_index: number
  pricing_mode?: string | null
}

interface MonthlySummaryRow {
  month_key: string
  month_type?: string | null
  hours: number | null
  invoiced_income: number | null
  work_lines?: unknown
  expenses: number | null
  gross_salary?: number | null
  net_salary_received?: number | null
  tax_already_withheld?: number | null
  updated_at?: string | null
  user_id?: string | null
}

interface RpcResult {
  status: 'saved' | 'deleted' | 'conflict'
  reason?: ConflictReason
  current_updated_at?: string
  entry?: DailyEntryRow
  work_items?: DailyEntryWorkItemRow[]
  summary?: MonthlySummaryRow
  settings?: AppSettingsRow
}

// The save functions come from supabase/migrations/20261028_safe_saving.sql.
export class DatabaseUpdateRequiredError extends Error {
  constructor() {
    super('The database needs an update before changes can be saved. Nothing was changed.')
    this.name = 'DatabaseUpdateRequiredError'
  }
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
    throw new Error('You are signed out. Sign in again to save.')
  }

  return userId
}

function getRequiredClient() {
  const supabase = getSupabaseClient()

  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  return supabase
}

function mapSettingsFromRow(row: AppSettingsRow | null): Settings {
  if (!row) {
    return starterStoredState.settings
  }

  return normalizeSettings({
    defaultShiftHours: row.default_shift_hours,
    defaultShiftIncome: row.default_shift_income,
    qualifiesForSelfEmployedDeduction: row.qualifies_for_self_employed_deduction,
    qualifiesForStartersDeduction: row.qualifies_for_starters_deduction,
    reserveBufferPercent: row.reserve_buffer_percent,
    spouseMonthlyIncome: row.spouse_monthly_income,
    targetNetMonth: row.target_net_month,
    updatedAt: row.updated_at ?? undefined,
    vacationDaysPerYear: row.vacation_days_per_year,
    weeklyHoursTarget: row.weekly_hours_target,
  })
}

function mapSettingsToPayload(settings: Settings) {
  return {
    default_shift_hours: settings.defaultShiftHours,
    default_shift_income: settings.defaultShiftIncome,
    qualifies_for_self_employed_deduction: settings.qualifiesForSelfEmployedDeduction,
    qualifies_for_starters_deduction: settings.qualifiesForStartersDeduction,
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
    pricingMode: row.pricing_mode,
    projectName: row.project_name ?? '',
  })
}

function mapEntryFromRow(row: DailyEntryRow, workItems: WorkItem[] = []): DailyEntry | null {
  const isWorkedEntry = (row.day_status ?? 'worked') === 'worked'
  const nextEntry = normalizeEntry({
    date: row.date,
    dayStatus: row.day_status,
    expenses: row.expenses,
    hourlyRate: row.hourly_rate,
    hours: row.hours,
    id: row.id,
    invoicedIncome: row.invoiced_income,
    note: row.note,
    pricingMode: row.pricing_mode,
    source: row.source,
    updatedAt: row.updated_at ?? undefined,
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

function mapEntryToPayload(entry: DailyEntry) {
  const isWorkedEntry = (entry.dayStatus ?? 'worked') === 'worked'
  const hasWorkItems = isWorkedEntry && (entry.workItems?.length ?? 0) > 0

  return {
    entry: {
      id: entry.id,
      date: entry.date,
      day_status: entry.dayStatus ?? 'worked',
      hours: isWorkedEntry ? getEntryHours(entry) : 0,
      invoiced_income: isWorkedEntry ? getEntryInvoicedIncome(entry) : 0,
      hourly_rate: isWorkedEntry && !hasWorkItems ? (entry.hourlyRate ?? null) : null,
      pricing_mode: isWorkedEntry && !hasWorkItems ? (entry.pricingMode ?? null) : null,
      expenses: entry.expenses,
      note: entry.note ?? null,
      source: entry.source ?? null,
    },
    workItems: hasWorkItems
      ? [...(entry.workItems ?? [])]
          .sort((left, right) => left.lineIndex - right.lineIndex)
          .map((workItem, index) => ({
            project_name: workItem.projectName.trim() === '' ? null : workItem.projectName.trim(),
            hours: workItem.hours,
            hourly_rate: workItem.hourlyRate,
            invoiced_income: workItem.invoicedIncome,
            line_index: workItem.lineIndex ?? index,
            pricing_mode: workItem.pricingMode ?? null,
          }))
      : [],
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
    taxAlreadyWithheld: row.tax_already_withheld,
    updatedAt: row.updated_at ?? undefined,
    workLines: row.work_lines,
  })
}

function mapMonthlySummaryToPayload(summary: MonthlySummary) {
  return {
    expenses: summary.expenses,
    gross_salary: summary.grossSalary,
    hours: summary.hours,
    invoiced_income: summary.invoicedIncome,
    month_key: summary.monthKey,
    month_type: summary.monthType,
    net_salary_received: summary.netSalaryReceived,
    tax_already_withheld: summary.taxAlreadyWithheld,
    work_lines: summary.workLines && summary.workLines.length > 0 ? summary.workLines : null,
  }
}

async function callSaveFunction(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  await getRequiredUserId()
  const { data, error } = await getRequiredClient().rpc(name, args)

  if (error) {
    // PGRST202: the function doesn't exist yet (migration not applied).
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new DatabaseUpdateRequiredError()
    }

    throw new Error(error.message || 'Saving failed.')
  }

  if (!data || typeof data !== 'object' || !('status' in data)) {
    throw new Error('Unexpected response from the database.')
  }

  return data as RpcResult
}

function toConflict<T>(result: RpcResult): MutationOutcome<T> {
  return {
    status: 'conflict',
    reason: result.reason ?? 'changed',
    currentUpdatedAt: result.current_updated_at,
  }
}

export async function saveDailyEntryRemote(
  entry: DailyEntry,
  expectedUpdatedAt: string | null,
  mutationId: string,
): Promise<MutationOutcome<DailyEntry>> {
  const payload = mapEntryToPayload(entry)
  const result = await callSaveFunction('save_daily_entry', {
    p_entry: payload.entry,
    p_expected_updated_at: expectedUpdatedAt,
    p_mutation_id: mutationId,
    p_work_items: payload.workItems,
  })

  if (result.status !== 'saved' || !result.entry) {
    return toConflict(result)
  }

  const workItems = (result.work_items ?? [])
    .map(mapWorkItemFromRow)
    .filter((workItem): workItem is WorkItem => workItem !== null)
  const savedEntry = mapEntryFromRow(result.entry, workItems)

  if (!savedEntry) {
    throw new Error('Unexpected response from the database.')
  }

  return { status: 'saved', value: savedEntry }
}

export async function deleteDailyEntryRemote(
  id: string,
  expectedUpdatedAt: string,
): Promise<MutationOutcome<never>> {
  const result = await callSaveFunction('delete_daily_entry', {
    p_expected_updated_at: expectedUpdatedAt,
    p_id: id,
  })

  return result.status === 'deleted' ? { status: 'deleted' } : toConflict(result)
}

export async function saveMonthlySummaryRemote(
  summary: MonthlySummary,
  expectedUpdatedAt: string | null,
  mutationId: string,
): Promise<MutationOutcome<MonthlySummary>> {
  const result = await callSaveFunction('save_monthly_summary', {
    p_expected_updated_at: expectedUpdatedAt,
    p_mutation_id: mutationId,
    p_summary: mapMonthlySummaryToPayload(summary),
  })

  const savedSummary =
    result.status === 'saved' && result.summary ? mapMonthlySummaryFromRow(result.summary) : null

  return savedSummary ? { status: 'saved', value: savedSummary } : toConflict(result)
}

export async function deleteMonthlySummaryRemote(
  monthKey: string,
  expectedUpdatedAt: string,
): Promise<MutationOutcome<never>> {
  const result = await callSaveFunction('delete_monthly_summary', {
    p_expected_updated_at: expectedUpdatedAt,
    p_month_key: monthKey,
  })

  return result.status === 'deleted' ? { status: 'deleted' } : toConflict(result)
}

export async function saveSettingsRemote(
  settings: Settings,
  expectedUpdatedAt: string | null,
  mutationId: string,
): Promise<MutationOutcome<Settings>> {
  const result = await callSaveFunction('save_settings', {
    p_expected_updated_at: expectedUpdatedAt,
    p_mutation_id: mutationId,
    p_settings: mapSettingsToPayload(settings),
  })

  return result.status === 'saved' && result.settings
    ? { status: 'saved', value: mapSettingsFromRow(result.settings) }
    : toConflict(result)
}

export async function loadRemoteAppData(): Promise<LoadedRemoteAppData> {
  if (!hasSupabaseConfig()) {
    return {
      ...getStarterData(),
      displayName: undefined,
      isNewUser: false,
    }
  }

  const supabase = getRequiredClient()
  const userId = await getRequiredUserId()

  const [settingsResult, entriesResult, monthlySummariesResult, profileResult] = await Promise.all([
    supabase.from('app_settings').select('*').eq('user_id', userId).maybeSingle(),
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
