"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { WarningModal } from "@/components/warning-modal";
import {
  cx,
  FieldLabel,
  GhostButton,
  GoldButton,
  IconButton,
  inputClassName,
  Notice,
  NumberField,
  Panel,
  SaveBar,
  ScreenHeader,
  Segmented,
  TextButton,
  Toast,
} from "@/components/ui/kit";
import CalendarSaveIcon from "@/src/assets/web/icons/CalanderSave.png";
import CompassIcon from "@/src/assets/web/icons/Compass.png";
import InvoiceIcon from "@/src/assets/web/icons/Invoice.png";
import TaxReserveIcon from "@/src/assets/web/icons/TaxReserveIcon.png";
import { isSupportedTaxYear, SUPPORTED_TAX_YEAR } from "@/lib/tax-engine";
import {
  hasSummaryChanges,
  isSameSettingsContent,
  mergeSavedIntoDraftSummaries,
  rebaseDraftSettings,
  rebaseDraftSummaries,
  type ConflictReason,
} from "@/lib/sync";
import {
  getCurrentYearStats,
  getDutchPublicHolidayWeekdays,
  getPlanningConsistency,
} from "@/lib/calculations";
import {
  formatCurrency,
  formatCurrencyPrecise,
  formatHours,
  formatHoursPrecise,
  formatNumber,
} from "@/lib/formatters";
import {
  clearUserConfigurationDraft,
  getUserConfigurationDraft,
  updateUserConfigurationDraft,
} from "@/lib/ui-preferences";
import type {
  DailyEntry,
  MonthlySummary,
  MonthWorkLine,
  Settings,
} from "@/lib/types";

export type ConfigurationConflictTarget =
  | { kind: "settings" }
  | { kind: "month"; monthKey: string };

export type ConfigurationSaveResult =
  | { status: "saved"; settings: Settings; monthlySummaries: MonthlySummary[] }
  | { status: "conflict"; reason: ConflictReason; target: ConfigurationConflictTarget }
  | { status: "error"; message: string };

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
  // Resolves with what happened; drafts are only cleared after "saved".
  onSaveConfiguration: (
    settings: Settings,
    monthlySummaries: MonthlySummary[],
  ) => Promise<ConfigurationSaveResult>;
  // Reloads the saved data; resolves null if that failed.
  onReloadRemote: () => Promise<{
    settings: Settings;
    monthlySummaries: MonthlySummary[];
  } | null>;
  onDeleteSavedMonthSummary: (monthKey: string) => Promise<void>;
  onRegisterNavigationHandlers?: (
    handlers: ConfigurationNavigationHandlers | null,
  ) => void;
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
  onSignOut: () => void;
  isSigningOut?: boolean;
  userId?: string;
}

interface MonthSummaryValidationIssue {
  message: string;
  title: string;
}

interface PendingRemoveWorkLine {
  lineIndex: number;
  summaryIndex: number;
  workLine: MonthWorkLine;
  monthKey: string;
}

interface PendingDeleteMonthSummary {
  index: number;
  monthKey: string;
  summary: MonthlySummary;
}

type SummaryFieldKey =
  | "monthKey"
  | "workLines"
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

const BEFORE_TAX_AMOUNT_EXPLANATION =
  "The work lines' income (excl. VAT) minus business expenses (excl. VAT) gives that month's before-tax amount.";
const WORK_LINES_EXPLANATION =
  "Add one line per rate you worked at that month, e.g. one for your main client and one for handyman jobs. A line's income is hours × hourly rate. For a fixed-price job, fill in the total instead and the app shows the hourly rate it works out to.";
const TAX_ALREADY_WITHHELD_EXPLANATION =
  "This is the tax already deducted by your employer for that month. You can usually find it on your payslip under wage tax, payroll tax, or a similar tax deduction line.";
// Hours rule (urencriterium) for the self-employed and starters' deductions.
const HOURS_RULE = 1225;
const CONFIG_SCREEN_INTENT_KEY = "configuration-screen-intent";
const CONFIG_SCREEN_FOCUS_TARGET_KEY = "configuration-screen-focus-target";
const CONFIG_SCREEN_TARGET_MONTH_KEY = "configuration-screen-target-month";

function parseOptionalNumber(value: string) {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function roundCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createEmptyWorkLine(settings: Settings): MonthWorkLine {
  const defaultShiftIncome = settings.defaultShiftIncome ?? 0;
  const defaultShiftHours = settings.defaultShiftHours ?? 0;

  return {
    label: "",
    hours: null,
    hourlyRate:
      defaultShiftIncome > 0 && defaultShiftHours > 0
        ? roundCents(defaultShiftIncome / defaultShiftHours)
        : null,
    totalIncome: null,
  };
}

// A prefilled rate alone doesn't make a line count; it needs hours, a total or a label.
function isWorkLineBlank(workLine: MonthWorkLine) {
  return (
    workLine.label.trim() === "" &&
    !((workLine.hours ?? 0) > 0) &&
    !((workLine.totalIncome ?? 0) > 0)
  );
}

function getWorkLineIncome(workLine: MonthWorkLine) {
  if ((workLine.totalIncome ?? 0) > 0) {
    return workLine.totalIncome ?? 0;
  }

  const hours = workLine.hours ?? 0;
  const hourlyRate = workLine.hourlyRate ?? 0;
  return hours > 0 && hourlyRate > 0 ? hours * hourlyRate : 0;
}

// Months saved before work lines existed only have month totals, so they are shown
// as one line with that total. The rate isn't guessed from hours.
function getSummaryWorkLines(summary: MonthlySummary): MonthWorkLine[] {
  if (summary.workLines && summary.workLines.length > 0) {
    return summary.workLines;
  }

  const hours = summary.hours ?? 0;
  const income = summary.invoicedIncome ?? 0;

  if (hours <= 0 && income <= 0) {
    return [];
  }

  return [
    {
      label: "",
      hours: hours > 0 ? hours : null,
      hourlyRate: null,
      totalIncome: income > 0 ? income : null,
    },
  ];
}

function getWorkLineTotals(workLines: MonthWorkLine[]) {
  return workLines.reduce(
    (totals, workLine) => {
      if (isWorkLineBlank(workLine)) {
        return totals;
      }

      return {
        hours: totals.hours + (workLine.hours ?? 0),
        income: totals.income + getWorkLineIncome(workLine),
      };
    },
    { hours: 0, income: 0 },
  );
}

function formatMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  if (!year || !month) {
    return "this month";
  }

  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function getRemoveWorkLineMessage(workLine: MonthWorkLine, monthKey: string) {
  const lineName = workLine.label.trim()
    ? `the "${workLine.label.trim()}" line`
    : "this line";
  const income = getWorkLineIncome(workLine);
  const details = [
    (workLine.hours ?? 0) > 0 ? formatHours(workLine.hours ?? 0) : null,
    income > 0 ? formatCurrencyPrecise(income) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `This removes ${lineName}${details ? ` (${details})` : ""} from ${formatMonthKey(monthKey)}. The month's hours and income go down by that amount when you save, which changes your yearly pace and tax estimate.`;
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

  const workLines = getSummaryWorkLines(summary).filter(
    (workLine) => !isWorkLineBlank(workLine),
  );
  const expenses = summary.expenses ?? 0;

  // Expense-only months are allowed; otherwise every line needs hours and income.
  if (workLines.length === 0) {
    if (!(expenses > 0)) {
      invalidFields.workLines = true;
    }

    return invalidFields;
  }

  if (
    workLines.some(
      (workLine) =>
        !((workLine.hours ?? 0) > 0) || !(getWorkLineIncome(workLine) > 0),
    )
  ) {
    invalidFields.workLines = true;
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
      workLines: undefined,
    };
  }

  const workLines = getSummaryWorkLines(summary)
    .filter((workLine) => !isWorkLineBlank(workLine))
    .map((workLine) => ({
      ...workLine,
      label: workLine.label.trim(),
    }));
  const totals = getWorkLineTotals(workLines);

  return {
    ...summary,
    hours: roundCents(totals.hours),
    invoicedIncome: roundCents(totals.income),
    workLines: workLines.length > 0 ? workLines : undefined,
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
      "Some month summaries still need required fields. Business month summaries need at least one work line with hours and an hourly rate or total, unless they are expense-only. Employment / pre-business months need gross salary, net salary received, and tax already withheld.",
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

export function Configuration({
  backfillFocusRequest = 0,
  entries,
  settingsFocusRequest = 0,
  settings,
  monthlySummaries,
  onSaveConfiguration,
  onReloadRemote,
  onDeleteSavedMonthSummary,
  onRegisterNavigationHandlers,
  onUnsavedChangesChange,
  onSignOut,
  isSigningOut = false,
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
  const [pendingRemoveWorkLine, setPendingRemoveWorkLine] =
    useState<PendingRemoveWorkLine | null>(null);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);
  // Saved months start collapsed; new or invalid months are always open.
  const [expandedMonthKeys, setExpandedMonthKeys] = useState<Set<string>>(
    () => new Set(),
  );
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
  const previousSavedRef = useRef<{
    monthlySummaries: MonthlySummary[];
    settings: Settings;
  } | null>(null);
  const hasHydratedDraftRef = useRef(false);
  const [configConflict, setConfigConflict] = useState<{
    reason: ConflictReason;
    target: ConfigurationConflictTarget;
  } | null>(null);

  useEffect(() => {
    const previousSaved = previousSavedRef.current;
    previousSavedRef.current = { monthlySummaries, settings };

    if (!hasHydratedDraftRef.current) {
      hasHydratedDraftRef.current = true;
      const storedDraft = userId ? getUserConfigurationDraft(userId) : null;

      setDraftSettings(
        storedDraft
          ? rebaseDraftSettings(undefined, settings, storedDraft.settings)
          : settings,
      );
      setDraftMonthlySummaries(
        sortMonthlySummariesNewestFirst(
          storedDraft
            ? mergeSavedIntoDraftSummaries(monthlySummaries, storedDraft.monthlySummaries)
            : monthlySummaries,
        ),
      );
      setHasHydratedConfigurationDraft(true);
      return;
    }

    // Saved data changed (a save, or a refresh): untouched parts of the draft move
    // to the new versions; edits keep their base version so stale saves conflict.
    setDraftSettings((currentDraft) =>
      rebaseDraftSettings(previousSaved?.settings, settings, currentDraft),
    );
    setDraftMonthlySummaries((currentDraft) =>
      sortMonthlySummariesNewestFirst(
        rebaseDraftSummaries(previousSaved?.monthlySummaries ?? [], monthlySummaries, currentDraft),
      ),
    );
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
            "This month already has detailed daily reports. Month backfills are only for months without detailed daily entries.",
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
    const focusedMonthKey = pendingMonthFocusRowKey.slice(
      0,
      pendingMonthFocusRowKey.lastIndexOf("-"),
    );
    setExpandedMonthKeys((currentValue) => new Set(currentValue).add(focusedMonthKey));
    setPendingMonthFocusRowKey(null);
  }, [pendingMonthFocusRowKey, sortedDraftSummaries]);

  useEffect(() => {
    if (!formMessage || isErrorMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => setFormMessage(""), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [formMessage, isErrorMessage]);

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
    !isSameSettingsContent(draftSettings, settings) ||
    hasSummaryChanges(sortedSavedSummaries, sortedDraftSummaries);

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

  // Month hours and income always follow the work lines, so calculations keep
  // reading the same month totals as before.
  const updateSummaryWorkLines = (
    index: number,
    getNextWorkLines: (workLines: MonthWorkLine[]) => MonthWorkLine[],
  ) => {
    resetFormMessage();

    const next = sortedDraftSummaries.map((summary, summaryIndex) => {
      if (summaryIndex !== index) {
        return summary;
      }

      const workLines = getNextWorkLines(getSummaryWorkLines(summary));
      const totals = getWorkLineTotals(workLines);

      return {
        ...summary,
        hours: roundCents(totals.hours),
        invoicedIncome: roundCents(totals.income),
        workLines,
      };
    });

    const nextSortedSummaries = sortMonthlySummariesNewestFirst(next);
    setDraftMonthlySummaries(nextSortedSummaries);
    refreshInvalidSummaryFieldsIfVisible(nextSortedSummaries);
  };

  const updateWorkLineField = <Key extends keyof MonthWorkLine>(
    summaryIndex: number,
    lineIndex: number,
    key: Key,
    value: MonthWorkLine[Key],
  ) => {
    updateSummaryWorkLines(summaryIndex, (workLines) =>
      workLines.map((workLine, index) =>
        index === lineIndex ? { ...workLine, [key]: value } : workLine,
      ),
    );
  };

  const addWorkLine = (summaryIndex: number) => {
    updateSummaryWorkLines(summaryIndex, (workLines) => [
      ...workLines,
      createEmptyWorkLine(draftSettings),
    ]);
  };

  const removeWorkLine = (summaryIndex: number, lineIndex: number) => {
    updateSummaryWorkLines(summaryIndex, (workLines) =>
      workLines.filter((_, index) => index !== lineIndex),
    );
  };

  // Lines with values change the month's income, so ask first; empty lines go right away.
  const requestRemoveWorkLine = (
    summaryIndex: number,
    lineIndex: number,
    workLine: MonthWorkLine,
  ) => {
    if (isWorkLineBlank(workLine)) {
      removeWorkLine(summaryIndex, lineIndex);
      return;
    }

    setPendingRemoveWorkLine({
      lineIndex,
      monthKey: sortedDraftSummaries[summaryIndex]?.monthKey ?? "",
      summaryIndex,
      workLine,
    });
  };

  const confirmRemoveWorkLine = () => {
    if (!pendingRemoveWorkLine) {
      return;
    }

    removeWorkLine(
      pendingRemoveWorkLine.summaryIndex,
      pendingRemoveWorkLine.lineIndex,
    );
    setPendingRemoveWorkLine(null);
  };

  const addMonthSummary = useCallback((targetMonthKey?: string) => {
    resetFormMessage();
    const normalizedTargetMonthKey =
      typeof targetMonthKey === "string" ? targetMonthKey : "";

    if (normalizedTargetMonthKey) {
      const existingTargetIndex = sortedDraftSummaries.findIndex(
        (summary) => summary.monthKey === normalizedTargetMonthKey,
      );

      if (existingTargetIndex >= 0) {
        setPendingMonthFocusRowKey(
          getSummaryRowKey(
            sortedDraftSummaries[existingTargetIndex],
            existingTargetIndex,
          ),
        );
        return;
      }
    }

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

    const nextMonthKey =
      normalizedTargetMonthKey ||
      getNextBackfillMonthOption(new Date(), sortedDraftSummaries, entryMonthKeys);

    if (!nextMonthKey) {
      const noAvailableMonthIssue = {
        title: "No month available to add",
        message:
          "All eligible months in the current year are already covered or already have detailed daily reports.",
      };
      showWarningModal(noAvailableMonthIssue);
      return;
    }

    if (normalizedTargetMonthKey) {
      const validationIssue = getMonthValidationIssue({
        monthKey: normalizedTargetMonthKey,
      });

      if (validationIssue) {
        setIsErrorMessage(true);
        setFormMessage(validationIssue.message);
        showWarningModal(validationIssue);
        return;
      }
    }

    const nextSummary: MonthlySummary = {
      monthKey: nextMonthKey,
      monthType: "business",
      invoicedIncome: 0,
      workLines: [createEmptyWorkLine(draftSettings)],
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
    draftSettings,
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
    const targetMonthKey = window.sessionStorage.getItem(
      CONFIG_SCREEN_TARGET_MONTH_KEY,
    );

    if (!intent || consumedConfigIntentRef.current === intent) {
      return;
    }

    consumedConfigIntentRef.current = intent;
    window.sessionStorage.removeItem(CONFIG_SCREEN_INTENT_KEY);
    window.sessionStorage.removeItem(CONFIG_SCREEN_FOCUS_TARGET_KEY);
    window.sessionStorage.removeItem(CONFIG_SCREEN_TARGET_MONTH_KEY);

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
        addMonthSummary(targetMonthKey ?? undefined);
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

  // Sends the draft; drafts are replaced by the saved data only after a confirmed save.
  const performSave = useCallback(
    async (nextSettings: Settings, nextSummaries: MonthlySummary[]) => {
      const result = await onSaveConfiguration(
        nextSettings,
        nextSummaries.map(sanitizeMonthlySummaryForSave),
      );

      if (result.status === "saved") {
        setDraftSettings(result.settings);
        setDraftMonthlySummaries(sortMonthlySummariesNewestFirst(result.monthlySummaries));

        if (userId) {
          clearUserConfigurationDraft(userId);
        }

        setIsErrorMessage(false);
        setFormMessage("Changes saved.");
        return true;
      }

      if (result.status === "conflict") {
        setConfigConflict({ reason: result.reason, target: result.target });
        return false;
      }

      setIsErrorMessage(true);
      setFormMessage(result.message);
      return false;
    },
    [onSaveConfiguration, userId],
  );

  const resolveConflictWithOtherVersion = async () => {
    const conflict = configConflict;
    setConfigConflict(null);

    if (!conflict) {
      return;
    }

    const latest = await onReloadRemote();

    if (!latest) {
      return;
    }

    if (conflict.target.kind === "settings") {
      setDraftSettings(latest.settings);
    } else {
      const { monthKey } = conflict.target;
      const remoteSummary = latest.monthlySummaries.find(
        (summary) => summary.monthKey === monthKey,
      );
      setDraftMonthlySummaries((currentDraft) =>
        sortMonthlySummariesNewestFirst([
          ...currentDraft.filter((summary) => summary.monthKey !== monthKey),
          ...(remoteSummary ? [remoteSummary] : []),
        ]),
      );
    }

    setIsErrorMessage(false);
    setFormMessage("Loaded the latest version.");
  };

  // Explicit choice: replace the other device's version with this draft.
  const resolveConflictByOverwriting = async () => {
    const conflict = configConflict;
    setConfigConflict(null);

    if (!conflict) {
      return;
    }

    const latest = await onReloadRemote();

    if (!latest) {
      return;
    }

    let nextSettings = draftSettings;
    let nextSummaries = sortedDraftSummaries;

    if (conflict.target.kind === "settings") {
      nextSettings = { ...draftSettings, updatedAt: latest.settings.updatedAt };
    } else {
      const { monthKey } = conflict.target;
      const remoteSummary = latest.monthlySummaries.find(
        (summary) => summary.monthKey === monthKey,
      );
      nextSummaries = sortedDraftSummaries.map((summary) =>
        summary.monthKey === monthKey
          ? { ...summary, updatedAt: remoteSummary?.updatedAt }
          : summary,
      );
    }

    setDraftSettings(nextSettings);
    setDraftMonthlySummaries(nextSummaries);
    setIsSaving(true);

    try {
      await performSave(nextSettings, nextSummaries);
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
      return await performSave(draftSettings, sortedDraftSummaries);
    } finally {
      setIsSaving(false);
    }
  }, [
    performSave,
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

  const configuredHourlyRate =
    (draftSettings.defaultShiftIncome ?? 0) > 0 && (draftSettings.defaultShiftHours ?? 0) > 0
      ? (draftSettings.defaultShiftIncome ?? 0) / (draftSettings.defaultShiftHours ?? 1)
      : 0;
  const yearHours = getCurrentYearStats(entries, monthlySummaries, draftSettings).ytdHours;
  const hoursRuleProgress = Math.min(100, (yearHours / HOURS_RULE) * 100);
  const isToastError = isErrorMessage && warningModalIssue === null;

  const isMonthExpanded = (summary: MonthlySummary, rowKey: string, isInvalid: boolean) =>
    isInvalid ||
    !savedMonthKeys.has(summary.monthKey) ||
    expandedMonthKeys.has(summary.monthKey) ||
    pendingMonthFocusRowKey === rowKey;

  const toggleMonthExpanded = (monthKey: string) => {
    setExpandedMonthKeys((currentValue) => {
      const nextValue = new Set(currentValue);

      if (nextValue.has(monthKey)) {
        nextValue.delete(monthKey);
      } else {
        nextValue.add(monthKey);
      }

      return nextValue;
    });
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
        body="This removes the month from your history right away. Your forecasts and tax planning will change. You can add it again later."
        isOpen={pendingDeleteMonthSummary !== null}
        onClose={() => setPendingDeleteMonthSummary(null)}
        onPrimaryAction={confirmRemoveSavedMonthSummary}
        onSecondaryAction={() => setPendingDeleteMonthSummary(null)}
        primaryActionLabel="Delete month"
        secondaryActionLabel="Cancel"
        title={
          pendingDeleteMonthSummary
            ? `Delete ${formatMonthKey(pendingDeleteMonthSummary.monthKey)}?`
            : "Delete month?"
        }
      />
      <WarningModal
        body={
          pendingRemoveWorkLine
            ? getRemoveWorkLineMessage(
                pendingRemoveWorkLine.workLine,
                pendingRemoveWorkLine.monthKey,
              )
            : ""
        }
        isOpen={pendingRemoveWorkLine !== null}
        onClose={() => setPendingRemoveWorkLine(null)}
        onPrimaryAction={confirmRemoveWorkLine}
        onSecondaryAction={() => setPendingRemoveWorkLine(null)}
        primaryActionLabel="Remove line"
        secondaryActionLabel="Cancel"
        title="Remove this work line?"
      />
      <WarningModal
        body={
          configConflict
            ? `${
                configConflict.target.kind === "settings"
                  ? "Your goal, rate or tax settings"
                  : formatMonthKey(configConflict.target.monthKey)
              } ${
                configConflict.reason === "exists"
                  ? "was also added on another device"
                  : configConflict.reason === "deleted"
                    ? "was deleted on another device"
                    : "was changed on another device"
              } after you opened it, so your change wasn't saved.\n\nYour changes are still here. Keep editing to leave them unsaved, use the other device's version, or overwrite it with yours. Overwriting replaces what the other device saved.`
            : ""
        }
        extraActions={[
          {
            label: "Use other version",
            onClick: () => void resolveConflictWithOtherVersion(),
          },
          {
            label: "Overwrite with mine",
            onClick: () => void resolveConflictByOverwriting(),
            tone: "danger",
          },
        ]}
        isOpen={configConflict !== null}
        onClose={() => setConfigConflict(null)}
        primaryActionLabel="Keep editing"
        title="Changed on another device"
      />
      <WarningModal
        body="All configuration changes you haven't saved yet will be lost."
        isOpen={isDiscardConfirmOpen}
        onClose={() => setIsDiscardConfirmOpen(false)}
        onPrimaryAction={() => {
          discardConfigurationDraft();
          setIsDiscardConfirmOpen(false);
        }}
        onSecondaryAction={() => setIsDiscardConfirmOpen(false)}
        primaryActionLabel="Discard changes"
        secondaryActionLabel="Keep editing"
        title="Discard unsaved changes?"
      />
      <Toast
        message={formMessage && (isToastError || !isErrorMessage) ? formMessage : ""}
        onDismiss={resetFormMessage}
        tone={isErrorMessage ? "error" : "success"}
      />

      <form className="space-y-4" onSubmit={handleSubmit}>
        <ScreenHeader
          eyebrow="Configuration"
          title="Your plan"
          subtitle="Goals, rates, tax and past months."
          action={
            <GhostButton disabled={isSigningOut} onClick={onSignOut} size="sm">
              {isSigningOut ? "Signing out…" : "Sign out"}
            </GhostButton>
          }
        />

        <Panel
          icon={CompassIcon}
          panelRef={settingsSectionRef}
          subtitle="What you want to take home, and how much you plan to work."
          title="Income goal"
        >
          <div className="space-y-4">
            <NumberField
              disabled={isSaving}
              info={{
                title: "Take-home goal",
                body: "Your monthly take-home goal after tax. The dashboard works backward from it to the before-tax amount you need.",
              }}
              inputRef={firstSettingsInputRef}
              invalid={invalidSettingFields.targetNetMonth === true}
              label="Take-home per month"
              onChange={(value) => updateField("targetNetMonth", value)}
              placeholder="0"
              prefix="€"
              step={50}
              value={draftSettings.targetNetMonth}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                disabled={isSaving}
                info={{
                  title: "Weekly hours",
                  body: "Your planned work hours in a normal week. The dashboard compares your logged hours with it.",
                }}
                inputRef={weeklyHoursTargetRef}
                invalid={invalidSettingFields.weeklyHoursTarget === true}
                label="Hours / week"
                onChange={(value) => updateField("weeklyHoursTarget", value)}
                placeholder="0"
                step={0.5}
                suffix="h"
                value={draftSettings.weeklyHoursTarget}
              />
              <NumberField
                disabled={isSaving}
                info={{
                  title: "Vacation days",
                  body: `Days off you plan this year. They lower the hours you can realistically work in the planning check. NL ${new Date().getFullYear()} has ${dutchPublicHolidayWeekdays} public holidays on weekdays.`,
                }}
                inputRef={vacationDaysPerYearRef}
                invalid={invalidSettingFields.vacationDaysPerYear === true}
                label="Vacation days"
                onChange={(value) => updateField("vacationDaysPerYear", value)}
                placeholder="0"
                step={1}
                value={draftSettings.vacationDaysPerYear}
              />
            </div>

            {planningConsistency ? (
              <Notice
                title={
                  planningConsistency.difference < 0
                    ? `Your plan: ${formatCurrency(Math.abs(planningConsistency.difference))} short of your goal`
                    : `Your plan: ${formatCurrency(planningConsistency.difference)} above your goal`
                }
                tone={planningConsistency.difference < 0 ? "warn" : "info"}
              >
                Working {formatHours(planningConsistency.plannedYearlyHours)} this year (
                {plannedVacationDaysPerYear} vacation days) at your default rate gives about{" "}
                {formatCurrency(planningConsistency.projectedAnnualNet)} after tax, against a goal of{" "}
                {formatCurrency(planningConsistency.targetAnnualNet)}.
              </Notice>
            ) : null}
          </div>
        </Panel>

        <Panel
          icon={InvoiceIcon}
          subtitle="Used as the default when you report a day or add a month."
          title="Default rate"
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              disabled={isSaving}
              info={{
                title: "Shift income",
                body: "What you invoice for one standard shift, excluding VAT. Together with the shift hours it sets your default hourly rate.",
              }}
              inputRef={defaultShiftIncomeRef}
              invalid={invalidSettingFields.defaultShiftIncome === true}
              label="Per shift"
              onChange={(value) => updateField("defaultShiftIncome", value)}
              placeholder="0"
              prefix="€"
              step={0.01}
              value={draftSettings.defaultShiftIncome}
            />
            <NumberField
              disabled={isSaving}
              inputRef={defaultShiftHoursRef}
              invalid={invalidSettingFields.defaultShiftHours === true}
              label="Shift length"
              onChange={(value) => updateField("defaultShiftHours", value)}
              placeholder="0"
              step={0.25}
              suffix="h"
              value={draftSettings.defaultShiftHours}
            />
          </div>
          <p className="mt-3 text-sm text-[#a88c71]">
            {configuredHourlyRate > 0 ? (
              <>
                Default rate:{" "}
                <span className="dashboard-gold-value font-semibold">
                  {formatCurrencyPrecise(configuredHourlyRate)} per hour
                </span>
              </>
            ) : (
              "Fill in both to get a default hourly rate."
            )}
          </p>
        </Panel>

        <Panel
          icon={TaxReserveIcon}
          subtitle="How the tax estimate and your reserve are calculated."
          title="Tax"
        >
          <div className="space-y-5">
            {!isSupportedTaxYear(new Date().getFullYear()) ? (
              <Notice title={`No tax rules for ${new Date().getFullYear()} yet`} tone="warn">
                The app only has the {SUPPORTED_TAX_YEAR} tax rules, so it shows no tax
                estimates for this year. Your hours, income and past months still work.
              </Notice>
            ) : null}
            <NumberField
              disabled={isSaving}
              help="Extra margin on top of the estimated tax, so you set aside a little more."
              inputRef={reserveBufferPercentRef}
              invalid={invalidSettingFields.reserveBufferPercent === true}
              label="Reserve buffer"
              onChange={(value) => updateField("reserveBufferPercent", value)}
              placeholder="0"
              step={0.5}
              suffix="%"
              value={draftSettings.reserveBufferPercent}
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold uppercase tracking-[0.12em] text-[#c9a57f]">
                  Hours this year
                </span>
                <span
                  className={
                    yearHours >= HOURS_RULE ? "font-semibold text-[#aaf0be]" : "font-semibold text-[#ffcf6e]"
                  }
                >
                  {formatHours(yearHours)} of {formatNumber(HOURS_RULE)}h
                  {yearHours >= HOURS_RULE ? " ✓" : ""}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#0f0b08] ring-1 ring-[#8a603d]/40">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#c27a3a,#f2b860,#ffe9a8)]"
                  style={{ width: `${hoursRuleProgress}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#a88c71]">
                Both deductions need the 1,225-hours rule: all hours spent on the business,
                including unbilled work like admin and finding clients. This counts your logged
                hours only.
              </p>
            </div>

            <div>
              <FieldLabel
                info={{
                  title: "Self-employed deduction",
                  body: "A €1,200 deduction (zelfstandigenaftrek) for entrepreneurs who meet the 1,225-hours rule in the year.",
                }}
              >
                Self-employed deduction
              </FieldLabel>
              <Segmented<"yes" | "no">
                disabled={isSaving}
                firstButtonRef={selfEmployedDeductionYesRef}
                invalid={invalidSettingFields.qualifiesForSelfEmployedDeduction === true}
                label="Self-employed deduction"
                onChange={(value) => updateField("qualifiesForSelfEmployedDeduction", value === "yes")}
                options={[
                  { value: "yes", label: "I qualify" },
                  { value: "no", label: "I don't" },
                ]}
                value={
                  draftSettings.qualifiesForSelfEmployedDeduction === null
                    ? null
                    : draftSettings.qualifiesForSelfEmployedDeduction
                      ? "yes"
                      : "no"
                }
              />
            </div>

            <div>
              <FieldLabel
                info={{
                  title: "Starters' deduction",
                  body: "An extra €2,123 (startersaftrek) on top of the self-employed deduction. You usually qualify if you meet the 1,225-hours rule this year, you weren't self-employed in at least one of the previous 5 years, and you claimed the self-employed deduction no more than twice in those 5 years. It can be used up to 3 times.",
                }}
              >
                Starters&apos; deduction
              </FieldLabel>
              <Segmented<"yes" | "no">
                disabled={isSaving || draftSettings.qualifiesForSelfEmployedDeduction !== true}
                label="Starters' deduction"
                onChange={(value) => updateField("qualifiesForStartersDeduction", value === "yes")}
                options={[
                  { value: "yes", label: "I qualify" },
                  { value: "no", label: "I don't" },
                ]}
                value={draftSettings.qualifiesForStartersDeduction ? "yes" : "no"}
              />
              {draftSettings.qualifiesForSelfEmployedDeduction !== true ? (
                <p className="mt-1.5 text-xs text-[#a88c71]">
                  Only applies when you qualify for the self-employed deduction.
                </p>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel
          icon={CalendarSaveIcon}
          panelRef={backfillSectionRef}
          subtitle="Whole months you didn't report day by day."
          title="Past months"
          titleAction={
            <GoldButton
              buttonRef={addMonthButtonRef}
              disabled={isSaving}
              onClick={() => addMonthSummary()}
              size="sm"
            >
              + Month
            </GoldButton>
          }
        >
          {sortedDraftSummaries.length === 0 ? (
            <p className="py-3 text-center text-sm text-[#a88c71]">
              No month totals yet. Add months you worked before you started reporting daily.
            </p>
          ) : (
            <div className="space-y-2.5">
              {sortedDraftSummaries.map((summary, index) => {
                const rowKey = getSummaryRowKey(summary, index);
                const rowInvalidFields = invalidSummaryFields[rowKey] ?? {};
                const isInvalidSummaryRow = Object.keys(rowInvalidFields).length > 0;
                const isExpanded = isMonthExpanded(summary, rowKey, isInvalidSummaryRow);
                const isEmployment = summary.monthType === "employment";
                const summaryWorkLines = getSummaryWorkLines(summary);
                const summaryWorkLineTotals = getWorkLineTotals(summaryWorkLines);
                const isSavedMonth = savedMonthKeys.has(summary.monthKey);

                return (
                  <div
                    key={`${summary.monthKey}-${index}`}
                    ref={(node) => {
                      monthCardRefs.current[rowKey] = node;
                    }}
                    className={cx(
                      "@container rounded-[16px] border transition",
                      isInvalidSummaryRow
                        ? "border-[#ff6b5b]/60 bg-[#240c09]/60"
                        : isExpanded
                          ? "border-[#e7b277]/45 bg-[#140f0b]"
                          : "border-[#8a603d]/35 bg-[#120d0a]/80",
                    )}
                  >
                    <button
                      aria-expanded={isExpanded}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                      disabled={!isSavedMonth || isInvalidSummaryRow}
                      onClick={() => toggleMonthExpanded(summary.monthKey)}
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-[#f3e4cf]">
                          {summary.monthKey ? formatMonthKey(summary.monthKey) : "New month"}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[#a88c71]">
                          {isEmployment
                            ? `Employment · ${formatCurrency(summary.grossSalary ?? 0)} gross`
                            : `${formatHours(summaryWorkLineTotals.hours)} · ${formatCurrency(summaryWorkLineTotals.income)}${
                                (summary.expenses ?? 0) > 0
                                  ? ` · ${formatCurrency(summary.expenses ?? 0)} expenses`
                                  : ""
                              }`}
                          {!isSavedMonth ? " · not saved" : ""}
                        </span>
                      </span>
                      {isSavedMonth && !isInvalidSummaryRow ? (
                        <span
                          aria-hidden="true"
                          className={cx(
                            "text-lg leading-none text-[#c9a57f] transition",
                            isExpanded && "rotate-90",
                          )}
                        >
                          ›
                        </span>
                      ) : null}
                    </button>

                    {isExpanded ? (
                      <div className="space-y-4 border-t border-[#8a603d]/30 px-3.5 pb-4 pt-3.5">
                        <div className="grid gap-3 @md:grid-cols-2">
                          <label className="block min-w-0">
                            <FieldLabel>Month</FieldLabel>
                            <input
                              ref={(node) => {
                                monthInputRefs.current[rowKey] = node;
                              }}
                              className={inputClassName(rowInvalidFields.monthKey === true)}
                              disabled={isSaving || isSavedMonth}
                              title={
                                isSavedMonth
                                  ? "To move a saved month, delete it and add the other month."
                                  : undefined
                              }
                              type="month"
                              value={summary.monthKey}
                              onChange={(event) =>
                                updateSummaryField(index, "monthKey", event.target.value)
                              }
                            />
                          </label>
                          <div className="min-w-0">
                            <FieldLabel>Type</FieldLabel>
                            <Segmented<MonthlySummary["monthType"]>
                              disabled={isSaving}
                              label="Month type"
                              onChange={(value) => updateSummaryMonthType(index, value)}
                              options={[
                                { value: "business", label: "Business" },
                                { value: "employment", label: "Employed" },
                              ]}
                              value={summary.monthType}
                            />
                          </div>
                        </div>

                        {isEmployment ? (
                          <div className="space-y-3">
                            <p className="text-xs leading-5 text-[#a88c71]">
                              A month before your business, or a month on salary. Copy the
                              amounts from your payslip.
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              <NumberField
                                disabled={isSaving}
                                invalid={rowInvalidFields.grossSalary === true}
                                label="Gross salary"
                                onChange={(value) => updateSummaryField(index, "grossSalary", value)}
                                prefix="€"
                                step={0.01}
                                value={summary.grossSalary}
                              />
                              <NumberField
                                disabled={isSaving}
                                invalid={rowInvalidFields.netSalaryReceived === true}
                                label="Net salary"
                                onChange={(value) => updateSummaryField(index, "netSalaryReceived", value)}
                                prefix="€"
                                step={0.01}
                                value={summary.netSalaryReceived}
                              />
                              <NumberField
                                disabled={isSaving}
                                info={{ title: "Tax already withheld", body: TAX_ALREADY_WITHHELD_EXPLANATION }}
                                invalid={rowInvalidFields.taxAlreadyWithheld === true}
                                label="Tax withheld"
                                onChange={(value) => updateSummaryField(index, "taxAlreadyWithheld", value)}
                                prefix="€"
                                step={0.01}
                                value={summary.taxAlreadyWithheld}
                              />
                              <NumberField
                                disabled={isSaving}
                                label="Hours · optional"
                                onChange={(value) => updateSummaryField(index, "hours", value)}
                                step={0.25}
                                suffix="h"
                                value={summary.hours}
                              />
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className={cx(
                                "space-y-2.5 rounded-[14px] border p-3",
                                rowInvalidFields.workLines
                                  ? "border-[#ff6b5b]/60 bg-[#240c09]/50"
                                  : "border-[#8a603d]/30 bg-[#0f0b08]/60",
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <FieldLabel
                                  info={{
                                    title: "Work lines",
                                    body: `${WORK_LINES_EXPLANATION} ${BEFORE_TAX_AMOUNT_EXPLANATION}`,
                                  }}
                                >
                                  Work
                                </FieldLabel>
                                <TextButton disabled={isSaving} onClick={() => addWorkLine(index)}>
                                  + Line
                                </TextButton>
                              </div>

                              {summaryWorkLines.length === 0 ? (
                                <p className="text-xs text-[#a88c71]">
                                  No work yet. Add a line with your hours and rate, or leave it empty
                                  for an expense-only month.
                                </p>
                              ) : (
                                summaryWorkLines.map((workLine, lineIndex) => {
                                  const lineHours = workLine.hours ?? 0;
                                  const lineTotal = workLine.totalIncome ?? 0;
                                  const isUsingLineTotal = lineTotal > 0;
                                  const lineIncome = getWorkLineIncome(workLine);

                                  return (
                                    <div
                                      key={lineIndex}
                                      className="space-y-2.5 rounded-[12px] border border-[#8a603d]/25 bg-[#120d0a] p-2.5"
                                    >
                                      <div className="flex items-end gap-2">
                                        <label className="block min-w-0 flex-1">
                                          <FieldLabel>Label · optional</FieldLabel>
                                          <input
                                            className={inputClassName(false, "py-2.5")}
                                            disabled={isSaving}
                                            placeholder="e.g. Handyman"
                                            type="text"
                                            value={workLine.label}
                                            onChange={(event) =>
                                              updateWorkLineField(index, lineIndex, "label", event.target.value)
                                            }
                                          />
                                        </label>
                                        <IconButton
                                          className="mb-0.5"
                                          disabled={isSaving}
                                          label="Remove line"
                                          onClick={() => requestRemoveWorkLine(index, lineIndex, workLine)}
                                        >
                                          ×
                                        </IconButton>
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <label className="block min-w-0">
                                          <FieldLabel>Hours</FieldLabel>
                                          <input
                                            className={inputClassName(false, "px-3 py-2.5")}
                                            disabled={isSaving}
                                            inputMode="decimal"
                                            min="0"
                                            step="0.01"
                                            type="number"
                                            value={workLine.hours ?? ""}
                                            onChange={(event) =>
                                              updateWorkLineField(
                                                index,
                                                lineIndex,
                                                "hours",
                                                parseOptionalNumber(event.target.value),
                                              )
                                            }
                                          />
                                        </label>
                                        <label className={cx("block min-w-0 transition", isUsingLineTotal && "opacity-50")}>
                                          <FieldLabel>Rate €/h</FieldLabel>
                                          <input
                                            className={inputClassName(false, "px-3 py-2.5")}
                                            disabled={isSaving}
                                            inputMode="decimal"
                                            min="0"
                                            step="0.01"
                                            type="number"
                                            value={workLine.hourlyRate ?? ""}
                                            onChange={(event) =>
                                              updateWorkLineField(
                                                index,
                                                lineIndex,
                                                "hourlyRate",
                                                parseOptionalNumber(event.target.value),
                                              )
                                            }
                                          />
                                        </label>
                                        <label className="block min-w-0">
                                          <FieldLabel>Total €</FieldLabel>
                                          <input
                                            className={inputClassName(false, "px-3 py-2.5")}
                                            disabled={isSaving}
                                            inputMode="decimal"
                                            min="0"
                                            placeholder="optional"
                                            step="0.01"
                                            type="number"
                                            value={workLine.totalIncome ?? ""}
                                            onChange={(event) =>
                                              updateWorkLineField(
                                                index,
                                                lineIndex,
                                                "totalIncome",
                                                parseOptionalNumber(event.target.value),
                                              )
                                            }
                                          />
                                        </label>
                                      </div>
                                      <p className="text-xs leading-5 text-[#a88c71]">
                                        {isUsingLineTotal ? (
                                          lineHours > 0 ? (
                                            <>
                                              Works out to{" "}
                                              <span className="font-semibold text-[#f3e4cf]">
                                                {formatCurrencyPrecise(lineTotal / lineHours)}
                                              </span>{" "}
                                              per hour. The total counts; the rate is ignored.
                                            </>
                                          ) : (
                                            "Add the hours to see the hourly rate this total works out to."
                                          )
                                        ) : lineIncome > 0 ? (
                                          <>
                                            {formatHoursPrecise(lineHours)} ×{" "}
                                            {formatCurrencyPrecise(workLine.hourlyRate ?? 0)} ={" "}
                                            <span className="font-semibold text-[#f3e4cf]">
                                              {formatCurrencyPrecise(lineIncome)}
                                            </span>
                                          </>
                                        ) : (
                                          "Hours and a rate, or a total for a fixed-price job."
                                        )}
                                      </p>
                                    </div>
                                  );
                                })
                              )}

                              {summaryWorkLines.length > 0 ? (
                                <p className="flex justify-between border-t border-[#8a603d]/25 pt-2 text-xs text-[#a88c71]">
                                  <span>Month total</span>
                                  <span className="font-semibold text-[#f3e4cf]">
                                    {formatHours(summaryWorkLineTotals.hours)} ·{" "}
                                    {formatCurrencyPrecise(summaryWorkLineTotals.income)}
                                  </span>
                                </p>
                              ) : null}
                            </div>

                            <NumberField
                              disabled={isSaving}
                              info={{
                                title: "Business expenses",
                                body: `Total business expenses that month, excluding VAT. ${BEFORE_TAX_AMOUNT_EXPLANATION}`,
                              }}
                              label="Expenses (excl. VAT)"
                              onChange={(value) => updateSummaryField(index, "expenses", value)}
                              prefix="€"
                              step={0.01}
                              value={summary.expenses}
                            />
                          </>
                        )}

                        <div className="flex justify-end">
                          <TextButton
                            className="text-[#ff9c8e] hover:text-[#ffd9d2]"
                            disabled={isSaving}
                            onClick={() => requestRemoveMonthSummary(index)}
                          >
                            Delete month
                          </TextButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs leading-5 text-[#8f7559]">
            Amounts exclude VAT. If a month also has daily reports, the daily reports are used
            instead of the month total.
          </p>
        </Panel>

      </form>

      <SaveBar
        isSaving={isSaving}
        onDiscard={() => setIsDiscardConfirmOpen(true)}
        onSave={() => {
          void saveConfigurationDraft();
        }}
        saveLabel="Save changes"
        visible={hasPendingChanges || isSaving}
      />
    </>
  );
}
