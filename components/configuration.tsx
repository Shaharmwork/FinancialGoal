"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { InfoHelp } from "@/components/info-help";
import { WarningModal } from "@/components/warning-modal";
import { defaultSettings } from "@/lib/default-state";
import {
  getDutchPublicHolidayWeekdays,
  getPlanningConsistency,
} from "@/lib/calculations";
import { formatCurrency, formatHours } from "@/lib/formatters";
import {
  clearUserConfigurationDraft,
  getUserConfigurationDraft,
  updateUserConfigurationDraft,
} from "@/lib/ui-preferences";
import type { DailyEntry, MonthlySummary, Settings } from "@/lib/types";

export interface ConfigurationNavigationHandlers {
  discard: () => void;
  save: () => Promise<boolean>;
}

interface ConfigurationProps {
  backfillFocusRequest?: number;
  entries: DailyEntry[];
  settingsFocusRequest?: number;
  settings: Settings;
  monthlySummaries: MonthlySummary[];
  onSaveConfiguration: (
    settings: Settings,
    monthlySummaries: MonthlySummary[],
  ) => Promise<void>;
  onDeleteSavedMonthSummary: (monthKey: string) => Promise<void>;
  onRegisterNavigationHandlers?: (
    handlers: ConfigurationNavigationHandlers | null,
  ) => void;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  userId?: string;
}

interface FieldProps {
  helpTitle?: string;
  infoBody?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  invalid?: boolean;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  prefix?: string;
  suffix?: string;
  help?: string;
  disabled?: boolean;
  placeholder?: string;
  onSetDefault?: () => void;
}

interface ToggleFieldProps {
  helpTitle?: string;
  infoBody?: string;
  yesButtonRef?: RefObject<HTMLButtonElement | null>;
  invalid?: boolean;
  label: string;
  checked: boolean | null;
  onChange: (checked: boolean) => void;
  help?: string;
  disabled?: boolean;
  onSetDefault?: () => void;
}

interface MonthSummaryValidationIssue {
  message: string;
  title: string;
}

interface PendingDeleteMonthSummary {
  index: number;
  monthKey: string;
  summary: MonthlySummary;
}

type SummaryFieldKey =
  | "monthKey"
  | "hours"
  | "invoicedIncome"
  | "grossSalary"
  | "netSalaryReceived"
  | "taxAlreadyWithheld";
type SettingsFieldKey =
  | "targetNetMonth"
  | "weeklyHoursTarget"
  | "defaultShiftIncome"
  | "defaultShiftHours"
  | "reserveBufferPercent"
  | "qualifiesForSelfEmployedDeduction"
  | "vacationDaysPerYear";

type InvalidSettingsState = Partial<Record<SettingsFieldKey, boolean>>;
type InvalidSummaryFieldsState = Record<
  string,
  Partial<Record<SummaryFieldKey, boolean>>
>;

interface SummaryConsistencyValidationIssue extends MonthSummaryValidationIssue {
  invalidFields: Partial<Record<SummaryFieldKey, boolean>>;
  rowKey: string;
}

const BUSINESS_MONTH_VAT_EXPLANATION =
  "months, To keep your take-home projection and yearly tax estimate accurate, enter income and expenses excluding VAT.";
const BEFORE_TAX_AMOUNT_EXPLANATION =
  "Invoiced amount (excl. VAT) minus Business expenses (excl. VAT) gives that month's before-tax amount.";
const MONTH_TOTALS_PURPOSE_EXPLANATION =
  "Use this section to add older business or employment / pre-business months and avoid the need to add each working day manually. These month totals help the app calculate your yearly pace, target progress, and tax planning more accurately.";
const BUSINESS_MONTH_TOTALS_USAGE_EXPLANATION =
  "If a month already has daily entries, those entries remain the source of truth for calculations.";
const TAX_ALREADY_WITHHELD_EXPLANATION =
  "This is the tax already deducted by your employer for that month. You can usually find it on your payslip under wage tax, payroll tax, or a similar tax deduction line.";
const CONFIG_SCREEN_INTENT_KEY = "configuration-screen-intent";
const CONFIG_SCREEN_FOCUS_TARGET_KEY = "configuration-screen-focus-target";

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: string) {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectPrefilledZero(input: HTMLInputElement) {
  const normalizedValue = input.value.trim();

  if (normalizedValue === "0" || normalizedValue === "0.00") {
    input.select();
  }
}

function selectPrefilledZeroOnFocus(event: FocusEvent<HTMLInputElement>) {
  selectPrefilledZero(event.currentTarget);
}

function selectPrefilledZeroOnClick(event: MouseEvent<HTMLInputElement>) {
  selectPrefilledZero(event.currentTarget);
}

function sortMonthlySummariesNewestFirst(summaries: MonthlySummary[]) {
  return [...summaries].sort((leftSummary, rightSummary) => {
    if (!leftSummary.monthKey && !rightSummary.monthKey) {
      return 0;
    }

    if (!leftSummary.monthKey) {
      return -1;
    }

    if (!rightSummary.monthKey) {
      return 1;
    }

    return rightSummary.monthKey.localeCompare(leftSummary.monthKey);
  });
}

function buildMonthKey(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function parseMonthKeyParts(monthKey: string) {
  const [yearValue, monthValue] = monthKey.split("-").map(Number);

  if (!Number.isInteger(yearValue) || !Number.isInteger(monthValue)) {
    return null;
  }

  return {
    month: monthValue,
    year: yearValue,
  };
}

function getNextBackfillMonthOption(
  today: Date,
  summaries: MonthlySummary[],
  entryMonthKeys: Set<string>,
) {
  const existingSummaryMonthKeys = new Set(
    summaries
      .map((summary) => summary.monthKey)
      .filter((monthKey) => monthKey !== ""),
  );

  for (let monthIndex = 0; monthIndex < today.getMonth(); monthIndex += 1) {
    const monthKey = buildMonthKey(today.getFullYear(), monthIndex);

    if (
      !existingSummaryMonthKeys.has(monthKey) &&
      !entryMonthKeys.has(monthKey)
    ) {
      return monthKey;
    }
  }

  return "";
}

function getMissingBaseConfigurationFields(settings: Settings) {
  const missingFields: string[] = [];
  const missingFieldKeys: SettingsFieldKey[] = [];

  if (
    !(
      typeof settings.targetNetMonth === "number" && settings.targetNetMonth > 0
    )
  ) {
    missingFields.push("target net month");
    missingFieldKeys.push("targetNetMonth");
  }

  if (
    !(
      typeof settings.weeklyHoursTarget === "number" &&
      settings.weeklyHoursTarget > 0
    )
  ) {
    missingFields.push("weekly hours target");
    missingFieldKeys.push("weeklyHoursTarget");
  }

  if (
    !(
      typeof settings.defaultShiftIncome === "number" &&
      settings.defaultShiftIncome > 0
    )
  ) {
    missingFields.push("default invoice amount");
    missingFieldKeys.push("defaultShiftIncome");
  }

  if (
    !(
      typeof settings.defaultShiftHours === "number" &&
      settings.defaultShiftHours > 0
    )
  ) {
    missingFields.push("default shift hours");
    missingFieldKeys.push("defaultShiftHours");
  }

  if (
    !(
      typeof settings.reserveBufferPercent === "number" &&
      settings.reserveBufferPercent >= 0
    )
  ) {
    missingFields.push("reserve buffer percentage");
    missingFieldKeys.push("reserveBufferPercent");
  }

  if (
    typeof settings.vacationDaysPerYear === "number" &&
    settings.vacationDaysPerYear < 0
  ) {
    missingFields.push("vacation days per year");
    missingFieldKeys.push("vacationDaysPerYear");
  }

  if (typeof settings.qualifiesForSelfEmployedDeduction !== "boolean") {
    missingFields.push("self-employed deduction setting");
    missingFieldKeys.push("qualifiesForSelfEmployedDeduction");
  }

  return {
    missingFieldKeys,
    missingFields,
  };
}

function getSummaryRowKey(summary: MonthlySummary, index: number) {
  return `${summary.monthKey || "draft"}-${index}`;
}

function getInvalidSummaryFields(
  summary: MonthlySummary,
): Partial<Record<SummaryFieldKey, boolean>> {
  const invalidFields: Partial<Record<SummaryFieldKey, boolean>> = {};

  if (!summary.monthKey) {
    invalidFields.monthKey = true;
  }

  if (summary.monthType === "employment") {
    if (!(typeof summary.grossSalary === "number" && summary.grossSalary > 0)) {
      invalidFields.grossSalary = true;
    }

    if (
      !(
        typeof summary.netSalaryReceived === "number" &&
        summary.netSalaryReceived >= 0
      )
    ) {
      invalidFields.netSalaryReceived = true;
    }

    if (
      !(
        typeof summary.taxAlreadyWithheld === "number" &&
        summary.taxAlreadyWithheld >= 0
      )
    ) {
      invalidFields.taxAlreadyWithheld = true;
    }

    return invalidFields;
  }

  const hours = summary.hours ?? 0;
  const invoicedIncome = summary.invoicedIncome ?? 0;
  const paidIncome = summary.paidIncome ?? 0;
  const expenses = summary.expenses ?? 0;
  const hasAnyValue =
    hours > 0 || invoicedIncome > 0 || paidIncome > 0 || expenses > 0;

  if (!hasAnyValue) {
    invalidFields.hours = true;
    invalidFields.invoicedIncome = true;
    return invalidFields;
  }

  const isExpenseOnlySummary =
    expenses > 0 && hours <= 0 && invoicedIncome <= 0 && paidIncome <= 0;

  if (!isExpenseOnlySummary) {
    if (!(hours > 0)) {
      invalidFields.hours = true;
    }

    if (!(invoicedIncome > 0)) {
      invalidFields.invoicedIncome = true;
    }
  }

  return invalidFields;
}

function getInvalidSummaryFieldMap(
  summaries: MonthlySummary[],
): InvalidSummaryFieldsState {
  return summaries.reduce<InvalidSummaryFieldsState>(
    (currentValue, summary, index) => {
      const invalidFields = getInvalidSummaryFields(summary);

      if (Object.keys(invalidFields).length > 0) {
        currentValue[getSummaryRowKey(summary, index)] = invalidFields;
      }

      return currentValue;
    },
    {},
  );
}

function getEmploymentSummaryConsistencyIssue(
  summaries: MonthlySummary[],
): SummaryConsistencyValidationIssue | null {
  for (const [index, summary] of summaries.entries()) {
    if (summary.monthType !== "employment") {
      continue;
    }

    const { grossSalary, netSalaryReceived, taxAlreadyWithheld } = summary;
    const rowKey = getSummaryRowKey(summary, index);

    if (
      typeof grossSalary === "number" &&
      typeof netSalaryReceived === "number" &&
      grossSalary < netSalaryReceived
    ) {
      return {
        invalidFields: {
          grossSalary: true,
          netSalaryReceived: true,
        },
        message:
          "Gross salary must be at least as high as net salary received.",
        rowKey,
        title: "Check employment salary values",
      };
    }

    if (
      typeof grossSalary === "number" &&
      typeof netSalaryReceived === "number" &&
      typeof taxAlreadyWithheld === "number" &&
      taxAlreadyWithheld > grossSalary - netSalaryReceived
    ) {
      return {
        invalidFields: {
          taxAlreadyWithheld: true,
        },
        message:
          "Tax already withheld cannot be higher than gross salary minus net salary received.",
        rowKey,
        title: "Check withheld tax value",
      };
    }
  }

  return null;
}

function sanitizeMonthlySummaryForSave(
  summary: MonthlySummary,
): MonthlySummary {
  if (summary.monthType === "employment") {
    return {
      ...summary,
      expenses: null,
      invoicedIncome: null,
      paidIncome: null,
    };
  }

  return {
    ...summary,
    grossSalary: null,
    netSalaryReceived: null,
    taxAlreadyWithheld: null,
  };
}

function getConfigurationValidationIssue({
  hasInvalidBaseConfiguration,
  hasInvalidMonthSummaries,
}: {
  hasInvalidBaseConfiguration: boolean;
  hasInvalidMonthSummaries: boolean;
}): MonthSummaryValidationIssue {
  if (hasInvalidBaseConfiguration && hasInvalidMonthSummaries) {
    return {
      title: "Complete required fields",
      message:
        "Some required base configuration fields and month summary fields still need attention. Fill the highlighted fields before saving.",
    };
  }

  if (hasInvalidBaseConfiguration) {
    return {
      title: "Complete base configuration",
      message:
        "Some required base configuration fields are still missing or invalid. Fill the highlighted fields before saving.",
    };
  }

  return {
    title: "Complete month summary fields",
    message:
      "Some month summaries still need required fields. Business month summaries need hours worked and invoiced amount (excl. VAT), unless they are expense-only. Employment / pre-business months need gross salary, net salary received, and tax already withheld.",
  };
}

function isIncompleteDraftSummary(summary: MonthlySummary) {
  return Object.keys(getInvalidSummaryFields(summary)).length > 0;
}

function isIncompleteNewSummary(
  summary: MonthlySummary,
  savedMonthKeys: Set<string>,
) {
  if (savedMonthKeys.has(summary.monthKey)) {
    return false;
  }

  return isIncompleteDraftSummary(summary);
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
          {helpTitle && infoBody ? (
            <InfoHelp body={infoBody} title={helpTitle} />
          ) : null}
        </span>
        {onSetDefault ? (
          <button
            className="shrink-0 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            disabled={disabled}
            onClick={onSetDefault}
            type="button"
          >
            Use default
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
            invalid
              ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
              : "border-border focus:border-primary"
          } ${prefix ? "pl-8" : ""} ${suffix ? "pr-8" : ""}`}
          disabled={disabled}
          placeholder={placeholder}
          type="number"
          step={step}
          value={value ?? ""}
          onChange={(event) =>
            onChange(parseOptionalNumber(event.target.value))
          }
        />
        {suffix ? (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
      {help ? (
        <span className="mt-2 block text-xs text-muted-foreground">{help}</span>
      ) : null}
    </label>
  );
}

function ToggleField({
  helpTitle,
  infoBody,
  yesButtonRef,
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
          {helpTitle && infoBody ? (
            <InfoHelp body={infoBody} title={helpTitle} />
          ) : null}
        </span>
        {onSetDefault ? (
          <button
            className="shrink-0 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            disabled={disabled}
            onClick={onSetDefault}
            type="button"
          >
            Use default
          </button>
        ) : null}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <button
          ref={yesButtonRef}
          aria-pressed={checked === true}
          className={`rounded-2xl border px-4 py-3 text-left text-base transition disabled:cursor-not-allowed disabled:opacity-60 ${
            checked === true
              ? "bg-primary text-primary-foreground"
              : "bg-background text-foreground"
          } ${invalid && checked !== true ? "border-rose-300 bg-rose-50/50" : "border-border"}`}
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
            checked === false
              ? "bg-primary text-primary-foreground"
              : "bg-background text-foreground"
          } ${invalid && checked !== false ? "border-rose-300 bg-rose-50/50" : "border-border"}`}
          disabled={disabled}
          onClick={() => onChange(false)}
          type="button"
        >
          <span className="block font-medium">No</span>
          <span className="mt-1 block text-sm opacity-80">Not eligible</span>
        </button>
      </div>
      {checked === null ? (
        <span className="mt-2 block text-xs text-muted-foreground">
          Choose yes or no to finish setup.
        </span>
      ) : null}
      {help ? (
        <span className="mt-2 block text-xs text-muted-foreground">{help}</span>
      ) : null}
    </label>
  );
}

export function Configuration({
  backfillFocusRequest = 0,
  entries,
  settingsFocusRequest = 0,
  settings,
  monthlySummaries,
  onSaveConfiguration,
  onDeleteSavedMonthSummary,
  onRegisterNavigationHandlers,
  onUnsavedChangesChange,
  userId,
}: ConfigurationProps) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [draftMonthlySummaries, setDraftMonthlySummaries] = useState(() =>
    sortMonthlySummariesNewestFirst(monthlySummaries),
  );
  const [hasHydratedConfigurationDraft, setHasHydratedConfigurationDraft] =
    useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [isErrorMessage, setIsErrorMessage] = useState(false);
  const [warningModalIssue, setWarningModalIssue] =
    useState<MonthSummaryValidationIssue | null>(null);
  const [invalidSettingFields, setInvalidSettingFields] =
    useState<InvalidSettingsState>({});
  const [invalidSummaryFields, setInvalidSummaryFields] =
    useState<InvalidSummaryFieldsState>({});
  const [pendingDeleteMonthSummary, setPendingDeleteMonthSummary] =
    useState<PendingDeleteMonthSummary | null>(null);
  const settingsSectionRef = useRef<HTMLElement | null>(null);
  const firstSettingsInputRef = useRef<HTMLInputElement | null>(null);
  const backfillSectionRef = useRef<HTMLElement | null>(null);
  const addMonthButtonRef = useRef<HTMLButtonElement | null>(null);
  const weeklyHoursTargetRef = useRef<HTMLInputElement | null>(null);
  const defaultShiftIncomeRef = useRef<HTMLInputElement | null>(null);
  const defaultShiftHoursRef = useRef<HTMLInputElement | null>(null);
  const reserveBufferPercentRef = useRef<HTMLInputElement | null>(null);
  const vacationDaysPerYearRef = useRef<HTMLInputElement | null>(null);
  const selfEmployedDeductionYesRef = useRef<HTMLButtonElement | null>(null);
  const consumedConfigIntentRef = useRef<string | null>(null);
  const monthCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const monthInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [pendingMonthFocusRowKey, setPendingMonthFocusRowKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    const savedDraft = userId ? getUserConfigurationDraft(userId) : null;

    if (savedDraft) {
      setDraftSettings(savedDraft.settings);
      setDraftMonthlySummaries(
        sortMonthlySummariesNewestFirst(savedDraft.monthlySummaries),
      );
      setHasHydratedConfigurationDraft(true);
      return;
    }

    setDraftSettings(settings);
    setDraftMonthlySummaries(sortMonthlySummariesNewestFirst(monthlySummaries));
    setHasHydratedConfigurationDraft(true);
  }, [monthlySummaries, settings, userId]);

  useEffect(() => {
    if (backfillFocusRequest <= 0) {
      return;
    }

    backfillSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    const focusTimeoutId = window.setTimeout(() => {
      addMonthButtonRef.current?.focus();
    }, 180);

    return () => {
      window.clearTimeout(focusTimeoutId);
    };
  }, [backfillFocusRequest]);

  const sortedSavedSummaries = useMemo(
    () => sortMonthlySummariesNewestFirst(monthlySummaries),
    [monthlySummaries],
  );
  const sortedDraftSummaries = useMemo(
    () => sortMonthlySummariesNewestFirst(draftMonthlySummaries),
    [draftMonthlySummaries],
  );
  const savedMonthKeys = useMemo(
    () => new Set(sortedSavedSummaries.map((summary) => summary.monthKey)),
    [sortedSavedSummaries],
  );

  const entryMonthKeys = useMemo(
    () => new Set(entries.map((entry) => entry.date.slice(0, 7))),
    [entries],
  );
  const planningConsistency = useMemo(
    () => getPlanningConsistency(draftSettings),
    [draftSettings],
  );
  const dutchPublicHolidayWeekdays = getDutchPublicHolidayWeekdays(
    new Date().getFullYear(),
  ).length;
  const plannedVacationDaysPerYear = draftSettings.vacationDaysPerYear ?? 0;

  const showWarningModal = (issue: MonthSummaryValidationIssue) => {
    setWarningModalIssue(issue);
  };

  const getMonthValidationIssue = useCallback(
    ({
      includeDailyEntryConflict = true,
      indexToIgnore,
      monthKey,
    }: {
      includeDailyEntryConflict?: boolean;
      indexToIgnore?: number;
      monthKey: string;
    }) => {
      if (!monthKey) {
        return null;
      }

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthKey = buildMonthKey(currentYear, now.getMonth());
      const parsedMonthKey = parseMonthKeyParts(monthKey);

      if (!parsedMonthKey) {
        return {
          title: "Choose a valid month",
          message: "Pick a valid month before saving this summary.",
        };
      }

      if (parsedMonthKey.year < currentYear) {
        return {
          title: "Current year only",
          message: "You can only add months from the current year.",
        };
      }

      if (parsedMonthKey.year > currentYear || monthKey > currentMonthKey) {
        return {
          title: "Future month not allowed",
          message: "You can't add a future month yet.",
        };
      }

      const duplicateIndex = sortedDraftSummaries.findIndex(
        (summary, summaryIndex) =>
          summaryIndex !== indexToIgnore && summary.monthKey === monthKey,
      );

      if (duplicateIndex >= 0) {
        return {
          title: "Month already added",
          message: "This month was already added.",
        };
      }

      if (includeDailyEntryConflict && entryMonthKeys.has(monthKey)) {
        return {
          title: "Detailed reports already exist",
          message:
            "This month already has detailed daily reports. It cannot be saved as an employment / pre-business month unless those daily reports are removed first.",
        };
      }

      return null;
    },
    [entryMonthKeys, sortedDraftSummaries],
  );

  useEffect(() => {
    if (!pendingMonthFocusRowKey) {
      return;
    }

    const focusTarget = monthInputRefs.current[pendingMonthFocusRowKey];
    const cardTarget = monthCardRefs.current[pendingMonthFocusRowKey];

    if (!focusTarget) {
      return;
    }

    cardTarget?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    focusTarget.focus();
    setPendingMonthFocusRowKey(null);
  }, [pendingMonthFocusRowKey, sortedDraftSummaries]);

  const resetFormMessage = () => {
    if (!formMessage && !isErrorMessage) {
      return;
    }

    setFormMessage("");
    setIsErrorMessage(false);
  };

  const focusFirstMissingConfigurationField = useCallback(() => {
    const { missingFieldKeys } =
      getMissingBaseConfigurationFields(draftSettings);

    const refMap: Partial<Record<SettingsFieldKey, HTMLElement | null>> = {
      targetNetMonth: firstSettingsInputRef.current,
      weeklyHoursTarget: weeklyHoursTargetRef.current,
      defaultShiftIncome: defaultShiftIncomeRef.current,
      defaultShiftHours: defaultShiftHoursRef.current,
      reserveBufferPercent: reserveBufferPercentRef.current,
      vacationDaysPerYear: vacationDaysPerYearRef.current,
      qualifiesForSelfEmployedDeduction: selfEmployedDeductionYesRef.current,
    };

    const firstMissingKey = missingFieldKeys[0];
    const focusTarget = firstMissingKey
      ? refMap[firstMissingKey]
      : firstSettingsInputRef.current;

    settingsSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    window.setTimeout(() => {
      focusTarget?.focus();
    }, 180);
  }, [draftSettings]);

  useEffect(() => {
    if (settingsFocusRequest <= 0) {
      return;
    }

    focusFirstMissingConfigurationField();
  }, [focusFirstMissingConfigurationField, settingsFocusRequest]);

  const updateField = (
    key: keyof Settings,
    value: Settings[keyof Settings],
  ) => {
    resetFormMessage();
    if (key in invalidSettingFields) {
      setInvalidSettingFields((currentValue) => {
        const nextValue = { ...currentValue };
        delete nextValue[key as SettingsFieldKey];
        return nextValue;
      });
    }
    setDraftSettings({
      ...draftSettings,
      [key]: value,
    });
  };

  const hasPendingChanges =
    JSON.stringify(draftSettings) !== JSON.stringify(settings) ||
    JSON.stringify(sortedDraftSummaries) !==
      JSON.stringify(sortedSavedSummaries);

  useEffect(() => {
    onUnsavedChangesChange?.(hasPendingChanges);
  }, [hasPendingChanges, onUnsavedChangesChange]);

  useEffect(() => {
    if (!userId || !hasHydratedConfigurationDraft) {
      return;
    }

    if (hasPendingChanges) {
      updateUserConfigurationDraft(userId, {
        monthlySummaries: sortedDraftSummaries,
        settings: draftSettings,
      });
      return;
    }

    clearUserConfigurationDraft(userId);
  }, [
    draftSettings,
    hasHydratedConfigurationDraft,
    hasPendingChanges,
    sortedDraftSummaries,
    userId,
  ]);

  const unfinishedNewSummary = sortedDraftSummaries.find((summary) =>
    isIncompleteNewSummary(summary, savedMonthKeys),
  );

  const refreshInvalidSummaryFieldsIfVisible = (
    summaries: MonthlySummary[],
  ) => {
    if (Object.keys(invalidSummaryFields).length === 0) {
      return;
    }

    setInvalidSummaryFields(getInvalidSummaryFieldMap(summaries));
  };

  const updateSummaryField = (
    index: number,
    key: keyof MonthlySummary,
    value: string | number | null,
  ) => {
    resetFormMessage();

    if (key === "monthKey") {
      const normalizedMonthKey =
        typeof value === "string" ? value : String(value);
      const validationIssue = getMonthValidationIssue({
        includeDailyEntryConflict: false,
        indexToIgnore: index,
        monthKey: normalizedMonthKey,
      });

      if (validationIssue) {
        setIsErrorMessage(true);
        setFormMessage(validationIssue.message);
        showWarningModal(validationIssue);
        return;
      }
    }

    const next = sortedDraftSummaries.map((summary, summaryIndex) => {
      if (summaryIndex !== index) {
        return summary;
      }

      return {
        ...summary,
        [key]: value,
      };
    });

    const nextSortedSummaries = sortMonthlySummariesNewestFirst(next);
    setDraftMonthlySummaries(nextSortedSummaries);
    refreshInvalidSummaryFieldsIfVisible(nextSortedSummaries);
  };

  const addMonthSummary = useCallback(() => {
    resetFormMessage();

    if (unfinishedNewSummary) {
      const blockedAddIssue = {
        title: "Finish this month first",
        message:
          "You already added a new month that still needs values. Finish that month before adding another one.",
      };
      setIsErrorMessage(true);
      setFormMessage(blockedAddIssue.message);
      showWarningModal(blockedAddIssue);
      const unfinishedIndex = sortedDraftSummaries.findIndex(
        (summary) => summary === unfinishedNewSummary,
      );
      setPendingMonthFocusRowKey(
        getSummaryRowKey(unfinishedNewSummary, unfinishedIndex),
      );
      return;
    }

    const nextMonthKey = getNextBackfillMonthOption(
      new Date(),
      sortedDraftSummaries,
      entryMonthKeys,
    );

    if (!nextMonthKey) {
      const noAvailableMonthIssue = {
        title: "No month available to add",
        message:
          "All eligible months in the current year are already covered or already have detailed daily reports.",
      };
      showWarningModal(noAvailableMonthIssue);
      return;
    }

    const nextSummary: MonthlySummary = {
      monthKey: nextMonthKey,
      monthType: "business",
      invoicedIncome: 0,
      paidIncome: 0,
      expenses: 0,
      hours: 0,
      grossSalary: null,
      netSalaryReceived: null,
      taxAlreadyWithheld: null,
    };

    const nextSummaries = sortMonthlySummariesNewestFirst([
      ...sortedDraftSummaries,
      nextSummary,
    ]);
    const nextFocusIndex = nextSummaries.findIndex(
      (summary) => summary === nextSummary,
    );
    const nextFocusRowKey = getSummaryRowKey(nextSummary, nextFocusIndex);

    setDraftMonthlySummaries(nextSummaries);
    refreshInvalidSummaryFieldsIfVisible(nextSummaries);
    setPendingMonthFocusRowKey(nextFocusRowKey);
  }, [
    entryMonthKeys,
    getMonthValidationIssue,
    refreshInvalidSummaryFieldsIfVisible,
    sortedDraftSummaries,
    unfinishedNewSummary,
  ]);
  useEffect(() => {
    if (!hasHydratedConfigurationDraft || typeof window === "undefined") {
      return;
    }

    const intent = window.sessionStorage.getItem(CONFIG_SCREEN_INTENT_KEY);
    const focusTarget = window.sessionStorage.getItem(
      CONFIG_SCREEN_FOCUS_TARGET_KEY,
    );

    if (!intent || consumedConfigIntentRef.current === intent) {
      return;
    }

    consumedConfigIntentRef.current = intent;
    window.sessionStorage.removeItem(CONFIG_SCREEN_INTENT_KEY);
    window.sessionStorage.removeItem(CONFIG_SCREEN_FOCUS_TARGET_KEY);

    if (
      intent === "complete-setup" &&
      focusTarget === "first-missing-or-default"
    ) {
      focusFirstMissingConfigurationField();
      return;
    }

    if (intent === "update-history" && focusTarget === "add-month") {
      backfillSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      window.setTimeout(() => {
        addMonthSummary();
      }, 180);
    }
  }, [
    addMonthSummary,
    focusFirstMissingConfigurationField,
    hasHydratedConfigurationDraft,
  ]);

  const updateSummaryMonthType = (
    index: number,
    monthType: MonthlySummary["monthType"],
  ) => {
    resetFormMessage();

    const next = sortedDraftSummaries.map((summary, summaryIndex) => {
      if (summaryIndex !== index) {
        return summary;
      }

      return {
        ...summary,
        monthType,
      };
    });

    const nextSortedSummaries = sortMonthlySummariesNewestFirst(next);
    setDraftMonthlySummaries(nextSortedSummaries);
    refreshInvalidSummaryFieldsIfVisible(nextSortedSummaries);
  };

  const removeMonthSummary = (index: number) => {
    resetFormMessage();
    const nextSummaries = sortMonthlySummariesNewestFirst(
      sortedDraftSummaries.filter((_, summaryIndex) => summaryIndex !== index),
    );
    setDraftMonthlySummaries(nextSummaries);
    refreshInvalidSummaryFieldsIfVisible(nextSummaries);
  };

  const requestRemoveMonthSummary = (index: number) => {
    const summary = sortedDraftSummaries[index];

    if (!summary) {
      return;
    }

    if (!savedMonthKeys.has(summary.monthKey)) {
      removeMonthSummary(index);
      return;
    }

    setPendingDeleteMonthSummary({
      index,
      monthKey: summary.monthKey,
      summary,
    });
  };

  const confirmRemoveSavedMonthSummary = async () => {
    if (!pendingDeleteMonthSummary) {
      return;
    }
    // Store the pending delete info locally
    const summaryToDelete = pendingDeleteMonthSummary;
    // Remove the summary from draft state
    const nextSummaries = sortMonthlySummariesNewestFirst(
      sortedDraftSummaries.filter((_, idx) => idx !== summaryToDelete.index),
    );
    setPendingDeleteMonthSummary(null);
    setDraftMonthlySummaries(nextSummaries);
    refreshInvalidSummaryFieldsIfVisible(nextSummaries);

    // If the month is not in savedMonthKeys, just update local state and return
    if (!savedMonthKeys.has(summaryToDelete.monthKey)) {
      setFormMessage("Month removed from draft.");
      setIsErrorMessage(false);
      return;
    }

    // Persist the deletion of the saved month
    setIsSaving(true);
    setFormMessage("");
    setIsErrorMessage(false);
    try {
      await onDeleteSavedMonthSummary(summaryToDelete.monthKey);
      // If userId exists, keep the remaining unsaved draft
      if (userId) {
        updateUserConfigurationDraft(userId, {
          settings: draftSettings,
          monthlySummaries: nextSummaries,
        });
      }
      setFormMessage("Month deleted.");
      setIsErrorMessage(false);
    } catch (error) {
      setIsErrorMessage(true);
      setFormMessage(
        error instanceof Error && error.message
          ? error.message
          : "Delete failed.",
      );
      // Restore the deleted summary back into draft state and re-sort
      const restored = sortMonthlySummariesNewestFirst([
        ...nextSummaries,
        summaryToDelete.summary,
      ]);
      setDraftMonthlySummaries(restored);
      refreshInvalidSummaryFieldsIfVisible(restored);
    } finally {
      setIsSaving(false);
    }
  };

  const saveConfigurationDraft = useCallback(async () => {
    if (!hasPendingChanges) {
      return true;
    }

    const { missingFieldKeys, missingFields } =
      getMissingBaseConfigurationFields(draftSettings);
    const nextInvalidSummaryFields =
      getInvalidSummaryFieldMap(sortedDraftSummaries);
    const incompleteSummaryRowKeys = Object.keys(nextInvalidSummaryFields);

    setInvalidSettingFields(
      missingFieldKeys.reduce<InvalidSettingsState>(
        (currentValue, fieldKey) => {
          currentValue[fieldKey] = true;
          return currentValue;
        },
        {},
      ),
    );
    setInvalidSummaryFields(nextInvalidSummaryFields);

    if (missingFields.length > 0 || incompleteSummaryRowKeys.length > 0) {
      const validationIssue = getConfigurationValidationIssue({
        hasInvalidBaseConfiguration: missingFields.length > 0,
        hasInvalidMonthSummaries: incompleteSummaryRowKeys.length > 0,
      });

      setIsErrorMessage(true);
      setFormMessage(validationIssue.message);
      showWarningModal(validationIssue);

      if (missingFieldKeys.length > 0) {
        settingsSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        window.setTimeout(() => {
          firstSettingsInputRef.current?.focus();
        }, 180);
      } else if (incompleteSummaryRowKeys.length > 0) {
        const firstInvalidSummary = sortedDraftSummaries.find(
          (summary, index) =>
            incompleteSummaryRowKeys.includes(getSummaryRowKey(summary, index)),
        );

        if (firstInvalidSummary) {
          const firstInvalidIndex = sortedDraftSummaries.findIndex(
            (summary) => summary === firstInvalidSummary,
          );
          setPendingMonthFocusRowKey(
            getSummaryRowKey(firstInvalidSummary, firstInvalidIndex),
          );
        }
      }

      return false;
    }

    const employmentConsistencyIssue =
      getEmploymentSummaryConsistencyIssue(sortedDraftSummaries);

    if (employmentConsistencyIssue) {
      setInvalidSummaryFields({
        [employmentConsistencyIssue.rowKey]:
          employmentConsistencyIssue.invalidFields,
      });
      setIsErrorMessage(true);
      setFormMessage(employmentConsistencyIssue.message);
      showWarningModal(employmentConsistencyIssue);
      setPendingMonthFocusRowKey(employmentConsistencyIssue.rowKey);
      return false;
    }

    const seenMonthKeys = new Set<string>();
    for (const [summaryIndex, summary] of sortedDraftSummaries.entries()) {
      if (!summary.monthKey) {
        setIsErrorMessage(true);
        setFormMessage("Choose a month before saving the summary.");
        return false;
      }

      const validationIssue = getMonthValidationIssue({
        includeDailyEntryConflict: false,
        indexToIgnore: summaryIndex,
        monthKey: summary.monthKey,
      });
      if (validationIssue) {
        setIsErrorMessage(true);
        setFormMessage(validationIssue.message);
        showWarningModal(validationIssue);
        return false;
      }

      if (seenMonthKeys.has(summary.monthKey)) {
        const duplicateIssue = {
          title: "Month already added",
          message: "This month was already added.",
        };
        setIsErrorMessage(true);
        setFormMessage(duplicateIssue.message);
        showWarningModal(duplicateIssue);
        return false;
      }
      seenMonthKeys.add(summary.monthKey);
    }

    const conflictingNewSummary = sortedDraftSummaries.find(
      (summary) =>
        summary.monthType === "employment" &&
        entryMonthKeys.has(summary.monthKey),
    );

    if (conflictingNewSummary) {
      const conflictIssue = {
        title: "Detailed reports already exist",
        message:
          "This month already has detailed daily reports. Remove those daily reports before saving it as an employment / pre-business month.",
      };
      setIsErrorMessage(true);
      setFormMessage(conflictIssue.message);
      showWarningModal(conflictIssue);
      return false;
    }

    setIsSaving(true);
    setFormMessage("");
    setIsErrorMessage(false);
    setInvalidSettingFields({});
    setInvalidSummaryFields({});

    try {
      const summariesToSave = sortedDraftSummaries.map(
        sanitizeMonthlySummaryForSave,
      );
      await onSaveConfiguration(draftSettings, summariesToSave);
      if (userId) {
        clearUserConfigurationDraft(userId);
      }
      setFormMessage("Saved.");
      return true;
    } catch (error) {
      setIsErrorMessage(true);
      setFormMessage(
        error instanceof Error && error.message
          ? error.message
          : "Save failed.",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    draftSettings,
    entryMonthKeys,
    getMonthValidationIssue,
    hasPendingChanges,
    onSaveConfiguration,
    sortedDraftSummaries,
    userId,
  ]);

  const discardConfigurationDraft = useCallback(() => {
    setDraftSettings(settings);
    setDraftMonthlySummaries(sortMonthlySummariesNewestFirst(monthlySummaries));
    setFormMessage("");
    setIsErrorMessage(false);
    setInvalidSettingFields({});
    setInvalidSummaryFields({});
    setWarningModalIssue(null);

    if (userId) {
      clearUserConfigurationDraft(userId);
    }
  }, [monthlySummaries, settings, userId]);

  useEffect(() => {
    onRegisterNavigationHandlers?.({
      discard: discardConfigurationDraft,
      save: saveConfigurationDraft,
    });

    return () => {
      onRegisterNavigationHandlers?.(null);
    };
  }, [
    discardConfigurationDraft,
    onRegisterNavigationHandlers,
    saveConfigurationDraft,
  ]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await saveConfigurationDraft();
  };

  return (
    <>
      <WarningModal
        body={warningModalIssue?.message ?? ""}
        isOpen={warningModalIssue !== null}
        onClose={() => setWarningModalIssue(null)}
        primaryActionLabel="Close"
        title={warningModalIssue?.title ?? ""}
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
          <h2 className="text-lg font-semibold text-foreground">
            Configuration
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fill the required fields to unlock accurate planning.
          </p>
          <div className="mt-4 grid gap-4">
            <SettingField
              helpTitle="Target net month"
              infoBody="Your monthly take-home goal. The dashboard uses this to work backward into the before-tax target you need for yearly pace and target tracking."
              inputRef={firstSettingsInputRef}
              invalid={invalidSettingFields.targetNetMonth === true}
              label="Target Net Month"
              disabled={isSaving}
              onSetDefault={() =>
                updateField("targetNetMonth", defaultSettings.targetNetMonth)
              }
              placeholder="0"
              value={draftSettings.targetNetMonth}
              onChange={(value) => updateField("targetNetMonth", value)}
              prefix="€"
            />
            <SettingField
              helpTitle="Weekly hours target"
              infoBody="Your preferred work hours for a normal week. The dashboard compares logged hours against this target in the weekly planning card."
              inputRef={weeklyHoursTargetRef}
              invalid={invalidSettingFields.weeklyHoursTarget === true}
              label="Hours I Want To Work Every Week"
              disabled={isSaving}
              onSetDefault={() =>
                updateField(
                  "weeklyHoursTarget",
                  defaultSettings.weeklyHoursTarget,
                )
              }
              placeholder="0"
              value={draftSettings.weeklyHoursTarget}
              onChange={(value) => updateField("weeklyHoursTarget", value)}
              step={0.25}
            />
            <SettingField
              helpTitle="Default shift income"
              infoBody="This is the expected invoice amount for one standard configured shift. It is based on your default shift hours and default shift income, used as a suggested value when you log an entry, and you can override it per entry when needed."
              inputRef={defaultShiftIncomeRef}
              invalid={invalidSettingFields.defaultShiftIncome === true}
              label="Default Invoice Amount"
              disabled={isSaving}
              onSetDefault={() =>
                updateField(
                  "defaultShiftIncome",
                  defaultSettings.defaultShiftIncome,
                )
              }
              placeholder="0"
              value={draftSettings.defaultShiftIncome}
              onChange={(value) => updateField("defaultShiftIncome", value)}
              prefix="€"
              step={0.01}
            />
            <SettingField
              inputRef={defaultShiftHoursRef}
              invalid={invalidSettingFields.defaultShiftHours === true}
              label="Default Shift Hours"
              disabled={isSaving}
              onSetDefault={() =>
                updateField(
                  "defaultShiftHours",
                  defaultSettings.defaultShiftHours,
                )
              }
              placeholder="0"
              value={draftSettings.defaultShiftHours}
              onChange={(value) => updateField("defaultShiftHours", value)}
              step={0.25}
            />
            <SettingField
              helpTitle="Vacation days per year"
              infoBody="Vacation days reduce the realistic work hours capacity used in the planning helper. This is only a planning assumption, not a separate tax rule."
              inputRef={vacationDaysPerYearRef}
              invalid={invalidSettingFields.vacationDaysPerYear === true}
              label="Vacation days per year"
              disabled={isSaving}
              onSetDefault={() =>
                updateField("vacationDaysPerYear", dutchPublicHolidayWeekdays)
              }
              placeholder="0"
              value={draftSettings.vacationDaysPerYear}
              onChange={(value) => updateField("vacationDaysPerYear", value)}
              help={`NL ${new Date().getFullYear()} baseline: ${dutchPublicHolidayWeekdays} weekday public holidays. You may use that as your default, or adjust to your own plans.`}
            />
            <SettingField
              helpTitle="Spouse monthly income"
              infoBody="This is for a later combined household view on the dashboard. It does not change your own business tax calculation and is only for shared visibility."
              label="Spouse Monthly Income"
              disabled={isSaving}
              placeholder="0"
              value={draftSettings.spouseMonthlyIncome}
              onChange={(value) => updateField("spouseMonthlyIncome", value)}
              prefix="€"
            />
            <SettingField
              helpTitle="Reserve buffer percent"
              infoBody="This adds extra breathing room on top of the calculated tax estimate. The dashboard uses it to raise reserve targets so you can save a bit more safely."
              inputRef={reserveBufferPercentRef}
              invalid={invalidSettingFields.reserveBufferPercent === true}
              label="Reserve Buffer Percentage"
              disabled={isSaving}
              onSetDefault={() =>
                updateField(
                  "reserveBufferPercent",
                  defaultSettings.reserveBufferPercent,
                )
              }
              placeholder="0"
              value={draftSettings.reserveBufferPercent}
              onChange={(value) => updateField("reserveBufferPercent", value)}
              suffix="%"
              step={0.5}
            />
            <ToggleField
              helpTitle="Self-employed deduction"
              infoBody="This tells the tax calculation whether to include the self-employed deduction. The easiest practical check is your yearly hours: add all worked hours from this year's daily entries and any monthly backfill summaries. If that total is around 1,225 hours or more, you usually pass the main hours test. That is roughly 102 hours a month on average, or about 24 hours a week across the year."
              yesButtonRef={selfEmployedDeductionYesRef}
              invalid={
                invalidSettingFields.qualifiesForSelfEmployedDeduction === true
              }
              label="Qualifies For Self-Employed Deduction"
              checked={draftSettings.qualifiesForSelfEmployedDeduction}
              disabled={isSaving}
              onChange={(value) =>
                updateField("qualifiesForSelfEmployedDeduction", value)
              }
              help="Affects the tax estimate used across the dashboard."
            />
            {planningConsistency ? (
              <div className="rounded-[1.35rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                <p className="font-semibold">Planning check</p>
                <p className="mt-2">
                  Your goal is{" "}
                  <span className="font-semibold">
                    {formatCurrency(draftSettings.targetNetMonth ?? 0)}
                  </span>
                  /mo, or{" "}
                  <span className="font-semibold">
                    {formatCurrency(planningConsistency.targetAnnualNet)}
                  </span>
                  /yr after tax.
                </p>
                <p className="mt-2">
                  Your current hours/rate setup points to about{" "}
                  <span className="font-semibold">
                    {formatCurrency(planningConsistency.projectedAnnualNet)}
                  </span>
                  /yr after estimated tax.
                </p>
                <p className="mt-2 text-xs text-rose-900/80">
                  So keep in mind that it is{" "}
                  <span className="font-semibold">
                    {formatCurrency(Math.abs(planningConsistency.difference))}
                  </span>{" "}
                  {planningConsistency.difference < 0 ? "below" : "above"} your
                  yearly net goal, based on{" "}
                  <span className="font-semibold">
                    {formatHours(planningConsistency.plannedYearlyHours)}
                  </span>{" "}
                  planned hours/yr and{" "}
                  <span className="font-semibold">
                    {plannedVacationDaysPerYear}
                  </span>{" "}
                  vacation days.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section
          ref={backfillSectionRef}
          className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  Backfill month totals
                </h2>
                <InfoHelp
                  body={
                    <>
                      <p>{MONTH_TOTALS_PURPOSE_EXPLANATION}</p>
                      <p className="font-semibold text-rose-700 underline">
                        Note!
                      </p>
                      <p>
                        * If a month already has{" "}
                        <span className="font-semibold">daily entries</span>,
                        those entries remain the source of truth for
                        calculations.
                      </p>
                      <p>
                        * For <span className="font-semibold">Business</span>{" "}
                        {BUSINESS_MONTH_VAT_EXPLANATION}
                      </p>
                    </>
                  }
                  title="Backfill Month totals"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Add older months to improve yearly progress and tax accuracy.
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
              const rowKey = getSummaryRowKey(summary, index);
              const rowInvalidFields = invalidSummaryFields[rowKey] ?? {};
              const isInvalidSummaryRow =
                Object.keys(rowInvalidFields).length > 0;

              return (
                <div
                  key={`${summary.monthKey}-${index}`}
                  ref={(node) => {
                    monthCardRefs.current[rowKey] = node;
                  }}
                  className={`rounded-[1.5rem] p-4 ${
                    isInvalidSummaryRow
                      ? "border border-rose-300 bg-rose-50/70"
                      : "bg-muted/55"
                  }`}
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-foreground">
                        Month
                      </span>
                      <input
                        ref={(node) => {
                          monthInputRefs.current[rowKey] = node;
                        }}
                        className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          rowInvalidFields.monthKey
                            ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
                            : "border-border focus:border-primary"
                        }`}
                        disabled={isSaving}
                        type="month"
                        value={summary.monthKey}
                        onChange={(event) =>
                          updateSummaryField(
                            index,
                            "monthKey",
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <div className="block">
                      <span className="mb-2 block text-sm font-medium text-foreground">
                        Month type
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          aria-pressed={summary.monthType === "business"}
                          className={`rounded-2xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            summary.monthType === "business"
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-foreground"
                          }`}
                          disabled={isSaving}
                          onClick={() =>
                            updateSummaryMonthType(index, "business")
                          }
                          type="button"
                        >
                          Business
                        </button>
                        <button
                          aria-pressed={summary.monthType === "employment"}
                          className={`rounded-2xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            summary.monthType === "employment"
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-foreground"
                          }`}
                          disabled={isSaving}
                          onClick={() =>
                            updateSummaryMonthType(index, "employment")
                          }
                          type="button"
                        >
                          Employment / pre-business month
                        </button>
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                        <span>Hours worked</span>
                        <InfoHelp
                          body={
                            summary.monthType === "employment"
                              ? "Optional hours worked for that employment / pre-business month."
                              : "Total hours worked in that older business month. This helps the dashboard track yearly pace and compare your actual work time against your weekly and yearly planning, without needing daily entries for that month."
                          }
                          title="Backfill hours worked"
                        />
                      </span>
                      <input
                        className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          rowInvalidFields.hours
                            ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
                            : "border-border focus:border-primary"
                        }`}
                        disabled={isSaving}
                        type="number"
                        min="0"
                        step="0.01"
                        value={summary.hours ?? ""}
                        onClick={selectPrefilledZeroOnClick}
                        onFocus={selectPrefilledZeroOnFocus}
                        onChange={(event) =>
                          updateSummaryField(
                            index,
                            "hours",
                            summary.monthType === "employment"
                              ? parseOptionalNumber(event.target.value)
                              : parseNumber(event.target.value),
                          )
                        }
                      />
                    </label>

                    {summary.monthType === "employment" ? (
                      <>
                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Gross salary</span>
                            <InfoHelp
                              body="Total salary for that month before tax and other deductions."
                              title="Gross salary"
                            />
                          </span>
                          <input
                            className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              rowInvalidFields.grossSalary
                                ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
                                : "border-border focus:border-primary"
                            }`}
                            disabled={isSaving}
                            type="number"
                            min="0"
                            step="0.01"
                            value={summary.grossSalary ?? ""}
                            onChange={(event) =>
                              updateSummaryField(
                                index,
                                "grossSalary",
                                parseOptionalNumber(event.target.value),
                              )
                            }
                          />
                        </label>

                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Net salary received</span>
                            <InfoHelp
                              body="What actually paid into your bank account."
                              title="Net salary received"
                            />
                          </span>
                          <input
                            className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              rowInvalidFields.netSalaryReceived
                                ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
                                : "border-border focus:border-primary"
                            }`}
                            disabled={isSaving}
                            type="number"
                            min="0"
                            step="0.01"
                            value={summary.netSalaryReceived ?? ""}
                            onChange={(event) =>
                              updateSummaryField(
                                index,
                                "netSalaryReceived",
                                parseOptionalNumber(event.target.value),
                              )
                            }
                          />
                        </label>

                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Tax already withheld</span>
                            <InfoHelp
                              body={TAX_ALREADY_WITHHELD_EXPLANATION}
                              title="Tax already withheld"
                            />
                          </span>
                          <input
                            className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              rowInvalidFields.taxAlreadyWithheld
                                ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
                                : "border-border focus:border-primary"
                            }`}
                            disabled={isSaving}
                            type="number"
                            min="0"
                            step="0.01"
                            value={summary.taxAlreadyWithheld ?? ""}
                            onChange={(event) =>
                              updateSummaryField(
                                index,
                                "taxAlreadyWithheld",
                                parseOptionalNumber(event.target.value),
                              )
                            }
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Invoiced amount (excl. VAT)</span>
                            <InfoHelp
                              body={`The total amount you billed in that older business month, excluding VAT. This is used for yearly progress, take-home projection, and tax planning. ${BEFORE_TAX_AMOUNT_EXPLANATION} If daily entries exist for the same month, those entries still win.`}
                              title="Backfill invoiced amount"
                            />
                          </span>
                          <input
                            className={`w-full rounded-2xl border bg-background px-4 py-3 text-base outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              rowInvalidFields.invoicedIncome
                                ? "border-rose-300 bg-rose-50/50 focus:border-rose-500"
                                : "border-border focus:border-primary"
                            }`}
                            disabled={isSaving}
                            type="number"
                            min="0"
                            step="0.01"
                            value={summary.invoicedIncome ?? ""}
                            onClick={selectPrefilledZeroOnClick}
                            onFocus={selectPrefilledZeroOnFocus}
                            onChange={(event) =>
                              updateSummaryField(
                                index,
                                "invoicedIncome",
                                parseOptionalNumber(event.target.value),
                              )
                            }
                          />
                        </label>

                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Paid amount received (excl. VAT)</span>
                            <InfoHelp
                              body={`The total amount you actually received in that older business month, excluding VAT. This helps the dashboard reflect cash received separately from what was invoiced.`}
                              title="Backfill paid amount received"
                            />
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isSaving}
                            type="number"
                            min="0"
                            step="0.01"
                            value={summary.paidIncome ?? ""}
                            onClick={selectPrefilledZeroOnClick}
                            onFocus={selectPrefilledZeroOnFocus}
                            onChange={(event) =>
                              updateSummaryField(
                                index,
                                "paidIncome",
                                parseOptionalNumber(event.target.value),
                              )
                            }
                          />
                        </label>

                        <label className="block">
                          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Business expenses (excl. VAT)</span>
                            <InfoHelp
                              body={`Total business expenses for that older business month, excluding VAT. These expenses reduce that month's before-tax amount and help the dashboard estimate your take-home projection and tax more accurately. ${BEFORE_TAX_AMOUNT_EXPLANATION}`}
                              title="Backfill business expenses"
                            />
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={isSaving}
                            type="number"
                            min="0"
                            step="0.01"
                            value={summary.expenses ?? ""}
                            onClick={selectPrefilledZeroOnClick}
                            onFocus={selectPrefilledZeroOnFocus}
                            onChange={(event) =>
                              updateSummaryField(
                                index,
                                "expenses",
                                parseOptionalNumber(event.target.value),
                              )
                            }
                          />
                        </label>
                      </>
                    )}
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
              );
            })}
          </div>
        </section>

        <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {hasPendingChanges
                ? "You have unsaved changes."
                : "No pending changes."}
            </p>
            <button
              className="rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!hasPendingChanges || isSaving}
              type="submit"
            >
              {isSaving
                ? "Saving..."
                : hasPendingChanges
                  ? "Save changes"
                  : "Saved"}
            </button>
          </div>

          {formMessage ? (
            <p
              className={`mt-3 text-sm ${isErrorMessage ? "text-rose-700" : "text-muted-foreground"}`}
            >
              {formMessage}
            </p>
          ) : null}
        </section>
      </form>
    </>
  );
}
