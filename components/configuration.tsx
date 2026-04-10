'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type RefObject,
  type TouchEvent,
} from 'react'
import { InfoHelp } from '@/components/info-help'
import { WarningModal } from '@/components/warning-modal'
import { defaultSettings } from '@/lib/default-state'
import type { DailyEntry, MonthlySummary, Settings } from '@/lib/types'

interface ConfigurationProps {
  backfillFocusRequest?: number
  entries: DailyEntry[]
  settingsFocusRequest?: number
  settings: Settings
  monthlySummaries: MonthlySummary[]
  onSaveConfiguration: (settings: Settings, monthlySummaries: MonthlySummary[]) => Promise<void>
}

interface FieldProps {
  helpTitle?: string
  infoBody?: string
  inputRef?: RefObject<HTMLInputElement | null>
  invalid?: boolean
  label: string
  value: number | null
  onChange: (value: number | null) => void
  step?: number
  prefix?: string
  suffix?: string
  help?: string
  disabled?: boolean
  placeholder?: string
  onSetDefault?: () => void
}

interface ToggleFieldProps {
  helpTitle?: string
  infoBody?: string
  invalid?: boolean
  label: string
  checked: boolean | null
  onChange: (checked: boolean) => void
  help?: string
  disabled?: boolean
  onSetDefault?: () => void
}

interface MonthSummaryValidationIssue {
  message: string
  title: string
}

interface PendingDeleteMonthSummary {
  index: number
  monthKey: string
}

type SummaryFieldKey = 'monthKey' | 'hours' | 'invoicedIncome'
type SettingsFieldKey =
  | 'targetNetMonth'
  | 'weeklyHoursTarget'
  | 'defaultShiftIncome'
  | 'defaultShiftHours'
  | 'reserveBufferPercent'
  | 'qualifiesForSelfEmployedDeduction'

type InvalidSettingsState = Partial<Record<SettingsFieldKey, boolean>>
type InvalidSummaryFieldsState = Record<string, Partial<Record<SummaryFieldKey, boolean>>>

function parseNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseOptionalNumber(value: string) {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function selectPrefilledZero(event: FocusEvent<HTMLInputElement>) {
  const normalizedValue = event.currentTarget.value.trim()

  if (normalizedValue === '0' || normalizedValue === '0.00') {
    event.currentTarget.select()
  }
}

function preservePrefilledZeroSelectionOnMouseUp(event: MouseEvent<HTMLInputElement>) {
  const normalizedValue = event.currentTarget.value.trim()

  if (normalizedValue === '0' || normalizedValue === '0.00') {
    event.preventDefault()
  }
}

function preservePrefilledZeroSelectionOnTouchEnd(event: TouchEvent<HTMLInputElement>) {
  const normalizedValue = event.currentTarget.value.trim()

  if (normalizedValue === '0' || normalizedValue === '0.00') {
    event.preventDefault()
  }
}

function sortMonthlySummariesNewestFirst(summaries: MonthlySummary[]) {
  return [...summaries].sort((leftSummary, rightSummary) => {
    if (!leftSummary.monthKey && !rightSummary.monthKey) {
      return 0
    }

    if (!leftSummary.monthKey) {
      return -1
    }

    if (!rightSummary.monthKey) {
      return 1
    }

    return rightSummary.monthKey.localeCompare(leftSummary.monthKey)
  })
}

function buildMonthKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

function parseMonthKeyParts(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split('-').map(Number)

  if (!Number.isInteger(yearValue) || !Number.isInteger(monthValue)) {
    return null
  }

  return {
    month: monthValue,
    year: yearValue,
  }
}

function getNextBackfillMonthOption(
  today: Date,
  summaries: MonthlySummary[],
  entryMonthKeys: Set<string>,
) {
  const existingSummaryMonthKeys = new Set(
    summaries.map((summary) => summary.monthKey).filter((monthKey) => monthKey !== ''),
  )

  for (let monthIndex = 0; monthIndex < today.getMonth(); monthIndex += 1) {
    const monthKey = buildMonthKey(today.getFullYear(), monthIndex)

    if (!existingSummaryMonthKeys.has(monthKey) && !entryMonthKeys.has(monthKey)) {
      return monthKey
    }
  }

  return ''
}

function getMissingBaseConfigurationFields(settings: Settings) {
  const missingFields: string[] = []
  const missingFieldKeys: SettingsFieldKey[] = []

  if (!(typeof settings.targetNetMonth === 'number' && settings.targetNetMonth > 0)) {
    missingFields.push('target net month')
    missingFieldKeys.push('targetNetMonth')
  }

  if (!(typeof settings.weeklyHoursTarget === 'number' && settings.weeklyHoursTarget > 0)) {
    missingFields.push('weekly hours target')
    missingFieldKeys.push('weeklyHoursTarget')
  }

  if (!(typeof settings.defaultShiftIncome === 'number' && settings.defaultShiftIncome > 0)) {
    missingFields.push('default invoice amount')
    missingFieldKeys.push('defaultShiftIncome')
  }

  if (!(typeof settings.defaultShiftHours === 'number' && settings.defaultShiftHours > 0)) {
    missingFields.push('default shift hours')
    missingFieldKeys.push('defaultShiftHours')
  }

  if (!(typeof settings.reserveBufferPercent === 'number' && settings.reserveBufferPercent >= 0)) {
    missingFields.push('reserve buffer percentage')
    missingFieldKeys.push('reserveBufferPercent')
  }

  if (typeof settings.qualifiesForSelfEmployedDeduction !== 'boolean') {
    missingFields.push('self-employed deduction setting')
    missingFieldKeys.push('qualifiesForSelfEmployedDeduction')
  }

  return {
    missingFieldKeys,
    missingFields,
  }
}

function getSummaryRowKey(summary: MonthlySummary, index: number) {
  return `${summary.monthKey || 'draft'}-${index}`
}

function getInvalidSummaryFields(
  summary: MonthlySummary,
): Partial<Record<SummaryFieldKey, boolean>> {
  const invalidFields: Partial<Record<SummaryFieldKey, boolean>> = {}

  if (!summary.monthKey) {
    invalidFields.monthKey = true
  }

  const hasAnyValue =
    summary.hours > 0 ||
    summary.invoicedIncome > 0 ||
    summary.paidIncome > 0 ||
    summary.expenses > 0

  if (!hasAnyValue) {
    invalidFields.hours = true
    invalidFields.invoicedIncome = true
    return invalidFields
  }

  const isExpenseOnlySummary =
    summary.expenses > 0 &&
    summary.hours <= 0 &&
    summary.invoicedIncome <= 0 &&
    summary.paidIncome <= 0

  if (!isExpenseOnlySummary) {
    if (!(summary.hours > 0)) {
      invalidFields.hours = true
    }

    if (!(summary.invoicedIncome > 0)) {
      invalidFields.invoicedIncome = true
    }
  }

  return invalidFields
}

function getInvalidSummaryFieldMap(
  summaries: MonthlySummary[],
): InvalidSummaryFieldsState {
  return summaries.reduce<InvalidSummaryFieldsState>((currentValue, summary, index) => {
    const invalidFields = getInvalidSummaryFields(summary)

    if (Object.keys(invalidFields).length > 0) {
      currentValue[getSummaryRowKey(summary, index)] = invalidFields
    }

    return currentValue
  }, {})
}

function getConfigurationValidationIssue({
  hasInvalidBaseConfiguration,
  hasInvalidMonthSummaries,
}: {
  hasInvalidBaseConfiguration: boolean
  hasInvalidMonthSummaries: boolean
}): MonthSummaryValidationIssue {
  if (hasInvalidBaseConfiguration && hasInvalidMonthSummaries) {
    return {
      title: 'Complete required fields',
      message:
        'Some required base configuration fields and month summary fields still need attention. Fill the highlighted fields before saving.',
    }
  }

  if (hasInvalidBaseConfiguration) {
    return {
      title: 'Complete base configuration',
      message:
        'Some required base configuration fields are still missing or invalid. Fill the highlighted fields before saving.',
    }
  }

  return {
    title: 'Complete month summary fields',
    message:
      'Some month summaries still need required fields. Worked month summaries need both hours and invoiced income. Expense-only month summaries are allowed. If a month truly has zero totals, remove it completely instead.',
  }
}

function isIncompleteDraftSummary(summary: MonthlySummary) {
  return Object.keys(getInvalidSummaryFields(summary)).length > 0
}

function isIncompleteNewSummary(summary: MonthlySummary, savedMonthKeys: Set<string>) {
  if (savedMonthKeys.has(summary.monthKey)) {
    return false
  }

  return isIncompleteDraftSummary(summary)
}

function SettingField({
  helpTitle,
  infoBody,
  inputRef,
  invalid = false,
  label,
  value,
  onChange,
  step = 1,
  prefix,
  suffix,
  help,
  disabled = false,
  placeholder,
  onSetDefault,
}: FieldProps) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span>{label}</span>
          {helpTitle && infoBody ? <InfoHelp body={infoBody} title={helpTitle} /> : null}
        </span>
        {onSetDefault ? (
          <button
            className="shrink-0 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            disabled={disabled}
            onClick={onSetDefault}
            type="button"
          >
            Use Default
          </button>
        ) : null}
      </span>
      <div className="relative">
        {prefix ? (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <input
          ref={inputRef}
          className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
            invalid ? 'border-rose-300 bg-rose-50/50 focus:border-rose-500' : 'border-border focus:border-primary'
          } ${
            prefix ? 'pl-8' : ''
          } ${suffix ? 'pr-8' : ''}`}
          disabled={disabled}
          placeholder={placeholder}
          type="number"
          step={step}
          value={value ?? ''}
          onChange={(event) => onChange(parseOptionalNumber(event.target.value))}
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
  helpTitle,
  infoBody,
  invalid = false,
  label,
  checked,
  onChange,
  help,
  disabled = false,
  onSetDefault,
}: ToggleFieldProps) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span>{label}</span>
          {helpTitle && infoBody ? <InfoHelp body={infoBody} title={helpTitle} /> : null}
        </span>
        {onSetDefault ? (
          <button
            className="shrink-0 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            disabled={disabled}
            onClick={onSetDefault}
            type="button"
          >
            Use Default
          </button>
        ) : null}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <button
          aria-pressed={checked === true}
          className={`rounded-2xl border px-4 py-3 text-left text-base transition disabled:cursor-not-allowed disabled:opacity-60 ${
            checked === true ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'
          } ${invalid && checked !== true ? 'border-rose-300 bg-rose-50/50' : 'border-border'}`}
          disabled={disabled}
          onClick={() => onChange(true)}
          type="button"
        >
          <span className="block font-medium">Yes</span>
          <span className="mt-1 block text-sm opacity-80">Eligible</span>
        </button>
        <button
          aria-pressed={checked === false}
          className={`rounded-2xl border px-4 py-3 text-left text-base transition disabled:cursor-not-allowed disabled:opacity-60 ${
            checked === false ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'
          } ${invalid && checked !== false ? 'border-rose-300 bg-rose-50/50' : 'border-border'}`}
          disabled={disabled}
          onClick={() => onChange(false)}
          type="button"
        >
          <span className="block font-medium">No</span>
          <span className="mt-1 block text-sm opacity-80">Not eligible</span>
        </button>
      </div>
      {checked === null ? (
        <span className="mt-2 block text-xs text-muted-foreground">Choose yes or no to finish setup.</span>
      ) : null}
      {help ? <span className="mt-2 block text-xs text-muted-foreground">{help}</span> : null}
    </label>
  )
}

export function Configuration({
  backfillFocusRequest = 0,
  entries,
  settingsFocusRequest = 0,
  settings,
  monthlySummaries,
  onSaveConfiguration,
}: ConfigurationProps) {
  const [draftSettings, setDraftSettings] = useState(settings)
  const [draftMonthlySummaries, setDraftMonthlySummaries] = useState(() =>
    sortMonthlySummariesNewestFirst(monthlySummaries),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [formMessage, setFormMessage] = useState('')
  const [isErrorMessage, setIsErrorMessage] = useState(false)
  const [warningModalIssue, setWarningModalIssue] = useState<MonthSummaryValidationIssue | null>(
    null,
  )
  const [invalidSettingFields, setInvalidSettingFields] = useState<InvalidSettingsState>({})
  const [invalidSummaryFields, setInvalidSummaryFields] = useState<InvalidSummaryFieldsState>({})
  const [pendingDeleteMonthSummary, setPendingDeleteMonthSummary] =
    useState<PendingDeleteMonthSummary | null>(null)
  const settingsSectionRef = useRef<HTMLElement | null>(null)
  const firstSettingsInputRef = useRef<HTMLInputElement | null>(null)
  const backfillSectionRef = useRef<HTMLElement | null>(null)
  const addMonthButtonRef = useRef<HTMLButtonElement | null>(null)
  const monthCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const monthInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [pendingMonthFocusRowKey, setPendingMonthFocusRowKey] = useState<string | null>(null)

  useEffect(() => {
    setDraftSettings(settings)
  }, [settings])

  useEffect(() => {
    setDraftMonthlySummaries(sortMonthlySummariesNewestFirst(monthlySummaries))
  }, [monthlySummaries])

  useEffect(() => {
    if (settingsFocusRequest <= 0) {
      return
    }

    settingsSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    const focusTimeoutId = window.setTimeout(() => {
      firstSettingsInputRef.current?.focus()
    }, 180)

    return () => {
      window.clearTimeout(focusTimeoutId)
    }
  }, [settingsFocusRequest])

  useEffect(() => {
    if (backfillFocusRequest <= 0) {
      return
    }

    backfillSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
    const focusTimeoutId = window.setTimeout(() => {
      addMonthButtonRef.current?.focus()
    }, 180)

    return () => {
      window.clearTimeout(focusTimeoutId)
    }
  }, [backfillFocusRequest])

  const sortedSavedSummaries = useMemo(
    () => sortMonthlySummariesNewestFirst(monthlySummaries),
    [monthlySummaries],
  )
  const sortedDraftSummaries = useMemo(
    () => sortMonthlySummariesNewestFirst(draftMonthlySummaries),
    [draftMonthlySummaries],
  )
  const savedMonthKeys = useMemo(
    () => new Set(sortedSavedSummaries.map((summary) => summary.monthKey)),
    [sortedSavedSummaries],
  )

  const entryMonthKeys = useMemo(
    () => new Set(entries.map((entry) => entry.date.slice(0, 7))),
    [entries],
  )

  const showWarningModal = (issue: MonthSummaryValidationIssue) => {
    setWarningModalIssue(issue)
  }

  const getMonthValidationIssue = ({
    includeDailyEntryConflict = true,
    indexToIgnore,
    monthKey,
  }: {
    includeDailyEntryConflict?: boolean
    indexToIgnore?: number
    monthKey: string
  }) => {
    if (!monthKey) {
      return null
    }

    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonthKey = buildMonthKey(currentYear, now.getMonth())
    const parsedMonthKey = parseMonthKeyParts(monthKey)

    if (!parsedMonthKey) {
      return {
        title: 'Choose a valid month',
        message: 'Pick a valid month before saving this summary.',
      }
    }

    if (parsedMonthKey.year < currentYear) {
      return {
        title: 'Current year only',
        message: 'You can only add months from the current year.',
      }
    }

    if (parsedMonthKey.year > currentYear || monthKey > currentMonthKey) {
      return {
        title: 'Future month not allowed',
        message: "You can't add a future month yet.",
      }
    }

    const duplicateIndex = sortedDraftSummaries.findIndex(
      (summary, summaryIndex) => summaryIndex !== indexToIgnore && summary.monthKey === monthKey,
    )

    if (duplicateIndex >= 0) {
      return {
        title: 'Month already added',
        message: 'This month was already added.',
      }
    }

    if (includeDailyEntryConflict && entryMonthKeys.has(monthKey)) {
      return {
        title: 'Detailed reports already exist',
        message:
          'This month already has detailed daily reports. Month summaries should only be used when there are no daily reports for that month.',
      }
    }

    return null
  }

  useEffect(() => {
    if (!pendingMonthFocusRowKey) {
      return
    }

    const focusTarget = monthInputRefs.current[pendingMonthFocusRowKey]
    const cardTarget = monthCardRefs.current[pendingMonthFocusRowKey]

    if (!focusTarget) {
      return
    }

    cardTarget?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
    focusTarget.focus()
    setPendingMonthFocusRowKey(null)
  }, [pendingMonthFocusRowKey, sortedDraftSummaries])

  const resetFormMessage = () => {
    if (!formMessage && !isErrorMessage) {
      return
    }

    setFormMessage('')
    setIsErrorMessage(false)
  }

  const updateField = (key: keyof Settings, value: Settings[keyof Settings]) => {
    resetFormMessage()
    if (key in invalidSettingFields) {
      setInvalidSettingFields((currentValue) => {
        const nextValue = { ...currentValue }
        delete nextValue[key as SettingsFieldKey]
        return nextValue
      })
    }
    setDraftSettings({
      ...draftSettings,
      [key]: value,
    })
  }

  const hasPendingChanges =
    JSON.stringify(draftSettings) !== JSON.stringify(settings) ||
    JSON.stringify(sortedDraftSummaries) !== JSON.stringify(sortedSavedSummaries)

  const unfinishedNewSummary = sortedDraftSummaries.find((summary) =>
    isIncompleteNewSummary(summary, savedMonthKeys),
  )

  const updateSummaryField = (
    index: number,
    key: keyof MonthlySummary,
    value: string | number,
  ) => {
    resetFormMessage()

    if (key === 'monthKey') {
      const normalizedMonthKey = typeof value === 'string' ? value : String(value)
      const validationIssue = getMonthValidationIssue({
        indexToIgnore: index,
        monthKey: normalizedMonthKey,
      })

      if (validationIssue) {
        setIsErrorMessage(true)
        setFormMessage(validationIssue.message)
        showWarningModal(validationIssue)
        return
      }
    }

    const next = sortedDraftSummaries.map((summary, summaryIndex) => {
      if (summaryIndex !== index) {
        return summary
      }

      return {
        ...summary,
        [key]: value,
      }
    })

    const nextSortedSummaries = sortMonthlySummariesNewestFirst(next)
    setDraftMonthlySummaries(nextSortedSummaries)
    setInvalidSummaryFields(getInvalidSummaryFieldMap(nextSortedSummaries))
  }

  const addMonthSummary = () => {
    resetFormMessage()

    if (unfinishedNewSummary) {
      const blockedAddIssue = {
        title: 'Finish this month first',
        message:
          'You already added a new month that still needs values. Finish that month before adding another one.',
      }
      setIsErrorMessage(true)
      setFormMessage(blockedAddIssue.message)
      showWarningModal(blockedAddIssue)
      const unfinishedIndex = sortedDraftSummaries.findIndex(
        (summary) => summary === unfinishedNewSummary,
      )
      setPendingMonthFocusRowKey(getSummaryRowKey(unfinishedNewSummary, unfinishedIndex))
      return
    }

    const nextMonthKey = getNextBackfillMonthOption(
      new Date(),
      sortedDraftSummaries,
      entryMonthKeys,
    )

    if (!nextMonthKey) {
      const noAvailableMonthIssue = {
        title: 'No month available to add',
        message:
          'All eligible months in the current year are already covered or already have detailed daily reports.',
      }
      showWarningModal(noAvailableMonthIssue)
      return
    }

    const nextSummary: MonthlySummary = {
      monthKey: nextMonthKey,
      invoicedIncome: 0,
      paidIncome: 0,
      expenses: 0,
      hours: 0,
    }

    const nextSummaries = sortMonthlySummariesNewestFirst([...sortedDraftSummaries, nextSummary])
    const nextFocusIndex = nextSummaries.findIndex((summary) => summary === nextSummary)
    const nextFocusRowKey = getSummaryRowKey(nextSummary, nextFocusIndex)

    setDraftMonthlySummaries(nextSummaries)
    setInvalidSummaryFields(getInvalidSummaryFieldMap(nextSummaries))
    setPendingMonthFocusRowKey(nextFocusRowKey)
  }

  const removeMonthSummary = (index: number) => {
    resetFormMessage()
    const nextSummaries = sortMonthlySummariesNewestFirst(
      sortedDraftSummaries.filter((_, summaryIndex) => summaryIndex !== index),
    )
    setDraftMonthlySummaries(nextSummaries)
    setInvalidSummaryFields(getInvalidSummaryFieldMap(nextSummaries))
  }

  const requestRemoveMonthSummary = (index: number) => {
    const summary = sortedDraftSummaries[index]

    if (!summary) {
      return
    }

    if (!savedMonthKeys.has(summary.monthKey)) {
      removeMonthSummary(index)
      return
    }

    setPendingDeleteMonthSummary({
      index,
      monthKey: summary.monthKey,
    })
  }

  const confirmRemoveSavedMonthSummary = () => {
    if (!pendingDeleteMonthSummary) {
      return
    }

    removeMonthSummary(pendingDeleteMonthSummary.index)
    setPendingDeleteMonthSummary(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!hasPendingChanges) {
      return
    }

    const { missingFieldKeys, missingFields } = getMissingBaseConfigurationFields(draftSettings)
    const nextInvalidSummaryFields = getInvalidSummaryFieldMap(sortedDraftSummaries)
    const incompleteSummaryRowKeys = Object.keys(nextInvalidSummaryFields)

    setInvalidSettingFields(
      missingFieldKeys.reduce<InvalidSettingsState>((currentValue, fieldKey) => {
        currentValue[fieldKey] = true
        return currentValue
      }, {}),
    )
    setInvalidSummaryFields(nextInvalidSummaryFields)

    if (missingFields.length > 0 || incompleteSummaryRowKeys.length > 0) {
      const validationIssue = getConfigurationValidationIssue({
        hasInvalidBaseConfiguration: missingFields.length > 0,
        hasInvalidMonthSummaries: incompleteSummaryRowKeys.length > 0,
      })

      setIsErrorMessage(true)
      setFormMessage(validationIssue.message)
      showWarningModal(validationIssue)

      if (missingFieldKeys.length > 0) {
        settingsSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
        window.setTimeout(() => {
          firstSettingsInputRef.current?.focus()
        }, 180)
      } else if (incompleteSummaryRowKeys.length > 0) {
        const firstInvalidSummary = sortedDraftSummaries.find((summary, index) =>
          incompleteSummaryRowKeys.includes(getSummaryRowKey(summary, index)),
        )

        if (firstInvalidSummary) {
          const firstInvalidIndex = sortedDraftSummaries.findIndex(
            (summary) => summary === firstInvalidSummary,
          )
          setPendingMonthFocusRowKey(getSummaryRowKey(firstInvalidSummary, firstInvalidIndex))
        }
      }

      return
    }

    const seenMonthKeys = new Set<string>()
    for (const [summaryIndex, summary] of sortedDraftSummaries.entries()) {
      if (!summary.monthKey) {
        setIsErrorMessage(true)
        setFormMessage('Choose a month before saving the summary.')
        return
      }

      const validationIssue = getMonthValidationIssue({
        includeDailyEntryConflict: false,
        indexToIgnore: summaryIndex,
        monthKey: summary.monthKey,
      })
      if (validationIssue) {
        setIsErrorMessage(true)
        setFormMessage(validationIssue.message)
        showWarningModal(validationIssue)
        return
      }

      if (seenMonthKeys.has(summary.monthKey)) {
        const duplicateIssue = {
          title: 'Month already added',
          message: 'This month was already added.',
        }
        setIsErrorMessage(true)
        setFormMessage(duplicateIssue.message)
        showWarningModal(duplicateIssue)
        return
      }
      seenMonthKeys.add(summary.monthKey)
    }

    const conflictingNewSummary = sortedDraftSummaries.find(
      (summary) => !savedMonthKeys.has(summary.monthKey) && entryMonthKeys.has(summary.monthKey),
    )

    if (conflictingNewSummary) {
      const conflictIssue = {
        title: 'Detailed reports already exist',
        message:
          'This month already has detailed daily reports. Month summaries should only be used when there are no daily reports for that month.',
      }
      setIsErrorMessage(true)
      setFormMessage(conflictIssue.message)
      showWarningModal(conflictIssue)
      return
    }

    setIsSaving(true)
    setFormMessage('')
    setIsErrorMessage(false)
    setInvalidSettingFields({})
    setInvalidSummaryFields({})

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
    <>
      <WarningModal
        body={warningModalIssue?.message ?? ''}
        isOpen={warningModalIssue !== null}
        onClose={() => setWarningModalIssue(null)}
        primaryActionLabel="Close"
        title={warningModalIssue?.title ?? ''}
      />
      <WarningModal
        body="This will remove historical data used in your dashboard calculations. You can add it again later, but your current forecasts and tax planning may change."
        isOpen={pendingDeleteMonthSummary !== null}
        onClose={() => setPendingDeleteMonthSummary(null)}
        onPrimaryAction={confirmRemoveSavedMonthSummary}
        onSecondaryAction={() => setPendingDeleteMonthSummary(null)}
        primaryActionLabel="Delete month"
        secondaryActionLabel="Cancel"
        title="Delete saved month summary?"
      />

      <form className="space-y-4 pb-8" onSubmit={handleSubmit}>
        <section
          ref={settingsSectionRef}
          className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm"
        >
        <h2 className="text-lg font-semibold text-foreground">Configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Base configuration is required before the dashboard can plan accurately.
        </p>
        <div className="mt-4 grid gap-4">
          <SettingField
            helpTitle="Target net month"
            infoBody="Your monthly take-home goal. The dashboard uses this to work backward into the business profit you need for yearly pace and target tracking."
            inputRef={firstSettingsInputRef}
            invalid={invalidSettingFields.targetNetMonth === true}
            label="Target Net Month"
            disabled={isSaving}
            onSetDefault={() => updateField('targetNetMonth', defaultSettings.targetNetMonth)}
            placeholder="0"
            value={draftSettings.targetNetMonth}
            onChange={(value) => updateField('targetNetMonth', value)}
            prefix="€"
          />
          <SettingField
            helpTitle="Weekly hours target"
            infoBody="Your preferred work hours for a normal week. The dashboard compares logged hours against this target in the weekly planning card."
            invalid={invalidSettingFields.weeklyHoursTarget === true}
            label="Hours I Want To Work Every Week"
            disabled={isSaving}
            onSetDefault={() => updateField('weeklyHoursTarget', defaultSettings.weeklyHoursTarget)}
            placeholder="0"
            value={draftSettings.weeklyHoursTarget}
            onChange={(value) => updateField('weeklyHoursTarget', value)}
            step={0.25}
          />
          <SettingField
            helpTitle="Default shift income"
            infoBody="This is the expected invoice amount for one standard configured shift. It is based on your default shift hours and default shift income, used as a suggested value when you log an entry, and you can override it per entry when needed."
            invalid={invalidSettingFields.defaultShiftIncome === true}
            label="Default Invoice Amount"
            disabled={isSaving}
            onSetDefault={() => updateField('defaultShiftIncome', defaultSettings.defaultShiftIncome)}
            placeholder="0"
            value={draftSettings.defaultShiftIncome}
            onChange={(value) => updateField('defaultShiftIncome', value)}
            prefix="€"
            step={0.01}
          />
          <SettingField
            invalid={invalidSettingFields.defaultShiftHours === true}
            label="Default Shift Hours"
            disabled={isSaving}
            onSetDefault={() => updateField('defaultShiftHours', defaultSettings.defaultShiftHours)}
            placeholder="0"
            value={draftSettings.defaultShiftHours}
            onChange={(value) => updateField('defaultShiftHours', value)}
            step={0.25}
          />
          <SettingField
            helpTitle="Spouse monthly income"
            infoBody="This is for a later combined household view on the dashboard. It does not change your own business tax calculation and is only for shared visibility."
            label="Spouse Monthly Income"
            disabled={isSaving}
            placeholder="0"
            value={draftSettings.spouseMonthlyIncome}
            onChange={(value) => updateField('spouseMonthlyIncome', value)}
            prefix="€"
          />
          <SettingField
            helpTitle="Reserve buffer percent"
            infoBody="This adds extra breathing room on top of the calculated tax estimate. The dashboard uses it to raise reserve targets so you can save a bit more safely."
            invalid={invalidSettingFields.reserveBufferPercent === true}
            label="Reserve Buffer Percentage"
            disabled={isSaving}
            onSetDefault={() => updateField('reserveBufferPercent', defaultSettings.reserveBufferPercent)}
            placeholder="0"
            value={draftSettings.reserveBufferPercent}
            onChange={(value) => updateField('reserveBufferPercent', value)}
            suffix="%"
            step={0.5}
          />
          <ToggleField
            helpTitle="Self-employed deduction"
            infoBody="This tells the tax calculation whether to include the self-employed deduction. The easiest practical check is your yearly hours: add all worked hours from this year's daily entries and any monthly backfill summaries. If that total is around 1,225 hours or more, you usually pass the main hours test. That is roughly 102 hours a month on average, or about 24 hours a week across the year."
            invalid={invalidSettingFields.qualifiesForSelfEmployedDeduction === true}
            label="Qualifies For Self-Employed Deduction"
            checked={draftSettings.qualifiesForSelfEmployedDeduction}
            disabled={isSaving}
            onSetDefault={() =>
              updateField(
                'qualifiesForSelfEmployedDeduction',
                defaultSettings.qualifiesForSelfEmployedDeduction,
              )
            }
            onChange={(value) => updateField('qualifiesForSelfEmployedDeduction', value)}
            help="Affects the tax estimate used across the dashboard."
          />
        </div>
        </section>

        <section
          ref={backfillSectionRef}
          className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm"
        >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Backfill month totals</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Manual shortcuts for older months only. If a month has daily entries, those remain the source of truth.
            </p>
          </div>
          <button
            ref={addMonthButtonRef}
            className="rounded-full bg-muted px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={addMonthSummary}
            type="button"
          >
            Add month
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {sortedDraftSummaries.map((summary, index) => {
            const rowKey = getSummaryRowKey(summary, index)
            const rowInvalidFields = invalidSummaryFields[rowKey] ?? {}
            const isInvalidSummaryRow = Object.keys(rowInvalidFields).length > 0

            return (
              <div
                key={`${summary.monthKey}-${index}`}
                ref={(node) => {
                  monthCardRefs.current[rowKey] = node
                }}
                className={`rounded-[1.5rem] p-4 ${
                  isInvalidSummaryRow ? 'border border-rose-300 bg-rose-50/70' : 'bg-muted/55'
                }`}
              >
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-foreground">Month</span>
                  <input
                    ref={(node) => {
                      monthInputRefs.current[rowKey] = node
                    }}
                    className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      rowInvalidFields.monthKey
                        ? 'border-rose-300 bg-rose-50/50 focus:border-rose-500'
                        : 'border-border focus:border-primary'
                    }`}
                    disabled={isSaving}
                    type="month"
                    value={summary.monthKey}
                    onChange={(event) => updateSummaryField(index, 'monthKey', event.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>Hours</span>
                    <InfoHelp
                      body="Total worked hours for that older month. This helps yearly pace and time-based planning when you do not want to enter each day separately."
                      title="Backfill hours"
                    />
                  </span>
                  <input
                    className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      rowInvalidFields.hours
                        ? 'border-rose-300 bg-rose-50/50 focus:border-rose-500'
                        : 'border-border focus:border-primary'
                    }`}
                    disabled={isSaving}
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.hours}
                    onFocus={selectPrefilledZero}
                    onMouseUp={preservePrefilledZeroSelectionOnMouseUp}
                    onTouchEnd={preservePrefilledZeroSelectionOnTouchEnd}
                    onChange={(event) =>
                      updateSummaryField(index, 'hours', parseNumber(event.target.value))
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>Invoiced income</span>
                    <InfoHelp
                      body="The total amount you billed in that month. This feeds profit and tax forecasting. If daily entries exist for the same month, those entries still win."
                      title="Backfill invoiced income"
                    />
                  </span>
                  <input
                    className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      rowInvalidFields.invoicedIncome
                        ? 'border-rose-300 bg-rose-50/50 focus:border-rose-500'
                        : 'border-border focus:border-primary'
                    }`}
                    disabled={isSaving}
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.invoicedIncome}
                    onFocus={selectPrefilledZero}
                    onMouseUp={preservePrefilledZeroSelectionOnMouseUp}
                    onTouchEnd={preservePrefilledZeroSelectionOnTouchEnd}
                    onChange={(event) =>
                      updateSummaryField(index, 'invoicedIncome', parseNumber(event.target.value))
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>Paid income</span>
                    <InfoHelp
                      body="The cash actually received in that month. Use this to keep cash-flow cards realistic for older months without entering each payment day."
                      title="Backfill paid income"
                    />
                  </span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.paidIncome}
                    onFocus={selectPrefilledZero}
                    onMouseUp={preservePrefilledZeroSelectionOnMouseUp}
                    onTouchEnd={preservePrefilledZeroSelectionOnTouchEnd}
                    onChange={(event) =>
                      updateSummaryField(index, 'paidIncome', parseNumber(event.target.value))
                    }
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>Expenses</span>
                    <InfoHelp
                      body="Total business costs for that month. Expenses reduce profit and affect yearly forecast and tax planning for historical months."
                      title="Backfill expenses"
                    />
                  </span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSaving}
                    type="number"
                    min="0"
                    step="0.01"
                    value={summary.expenses}
                    onFocus={selectPrefilledZero}
                    onMouseUp={preservePrefilledZeroSelectionOnMouseUp}
                    onTouchEnd={preservePrefilledZeroSelectionOnTouchEnd}
                    onChange={(event) =>
                      updateSummaryField(index, 'expenses', parseNumber(event.target.value))
                    }
                  />
                </label>
              </div>

              <button
                className="mt-3 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving}
                onClick={() => requestRemoveMonthSummary(index)}
                type="button"
              >
                Remove month
              </button>
              </div>
            )
          })}
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
    </>
  )
}
