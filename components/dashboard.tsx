"use client";

import { useEffect, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import CleanDash from "@/src/assets/backgrounds/CleanDash.png";
import BriefcaseIcon from "@/src/assets/icons/BreifcaseIcon.png";
import CalendarSaveIcon from "@/src/assets/icons/CalanderSave.png";
import CenterHighlightButton from "@/src/assets/icons/CenterHighlightButton.png";
import SandClockIcon from "@/src/assets/icons/SandClock.png";
import CoinsBeforeTaxIcon from "@/src/assets/icons/CoinsBeforeTaxIcon.png";
import ConfigurationIcon from "@/src/assets/icons/ConfigurationIcon.png";
import GapIcon from "@/src/assets/icons/GapIcon.png";
import CompassIcon from "@/src/assets/icons/Compass.png";
import InvoiceIcon from "@/src/assets/icons/Invoice.png";
import LeftHighlightButton from "@/src/assets/icons/LeftHighlightButton.png";
import OwlIcon from "@/src/assets/icons/Owlicon.png";
import ReportIcon from "@/src/assets/icons/ReportIcon.png";
import RightHighlightButton from "@/src/assets/icons/RightHighlightButton.png";
import SliderButton from "@/src/assets/icons/SliderButton.png";
import SliderFill from "@/src/assets/icons/SliderFill.png";
import TaxReserveIcon from "@/src/assets/icons/TaxReserveIcon.png";
import type { DailyEntry, MonthlySummary, Screen, Settings } from "@/lib/types";
import {
  getSetupCompleteness,
  getCurrentMonthStats,
  getCurrentWeekStats,
  getCurrentYearStats,
  getEarliestMissingCurrentMonthWeekday,
  getEarliestMissingPreviousMonthWeekday,
  getMissingPreviousMonthSummaryKeys,
} from "@/lib/calculations";
import {
  formatCurrency,
  formatDate,
  formatHours,
  formatNumber,
} from "@/lib/formatters";

const STAGE_WIDTH = 390;
const STAGE_HEIGHT = 844;
const STAGE_VIEWPORT_PADDING = 16;
const CONFIG_SCREEN_INTENT_KEY = "configuration-screen-intent";
const CONFIG_SCREEN_FOCUS_TARGET_KEY = "configuration-screen-focus-target";
type ProgressStatusKind =
  | "waiting"
  | "setGoal"
  | "onTrack"
  | "close"
  | "behind";

const DASHBOARD_POS = {
  // Weekly strip: use these to nudge the top summary tiles.
  weekly: {
    top: 18,
    side: 10,
    height: 55,
    gap: 3,

    headingTop: 70,
    headingOffsetX: 0,
    headingOffsetY: 0,
    headingPillHeight: 19,
    headingTextOffsetX: 0,
    headingTextOffsetY: 1,
    headingTextScale: 1,

    iconSize: 38,
    iconLabelGap: 0,
    labelValueGap: 0,
    labelRowHeight: 10,
    labelRowOffsetY: 3,
    iconValueRowOffsetY: 0,

    hoursLeftOffsetX: -1.5,
    hoursLeftOffsetY: 0,
    workedOffsetX: 0,
    workedOffsetY: 0,
    goalOffsetX: -2,
    goalOffsetY: 0,
    invoicedOffsetX: -1,
    invoicedOffsetY: 0,

    hoursLeftIconOffsetX: 0,
    hoursLeftIconOffsetY: -2,
    hoursLeftIconSize: 34,
    workedIconOffsetX: -6,
    workedIconOffsetY: -2,
    workedIconSize: 34,
    goalIconOffsetX: 0,
    goalIconOffsetY: -2,
    goalIconSize: 34,
    invoicedIconOffsetX: -1,
    invoicedIconOffsetY: 0,
    invoicedIconSize: 30,

    hoursLeftValueOffsetX: 0,
    hoursLeftValueOffsetY: 0,
    workedValueOffsetX: 0,
    workedValueOffsetY: 0,
    goalValueOffsetX: 0,
    goalValueOffsetY: 0,
    invoicedValueOffsetX: 0,
    invoicedValueOffsetY: 0,
  },

  // Greeting bubble near the owl head.
  greeting: {
    top: 78,
    left: 268,
    maxWidth: 224,
  },

  // Main yearly card shell bounds.
  card: {
    top: 130,
    bottom: 110,
    insetX: 10,
  },

  // Compact premium alert panel anchored to the top-right shoulder of the card.
  tray: {
    top: 180,
    right: 20,
    width: 376,
    height: 60,
    collapsedWidth: 14,
    collapsedHeight: 50,
    configurationOffsetX: 0,
    configurationOffsetY: 0,
    reportsOffsetX: 0,
    reportsOffsetY: 0,
    collapseButtonSize: 24,
    alertIconSize: 32,
    actionGap: 4,
    actionsWidth: 156,
    popoverWidth: 240,
    parts: {
      collapseButton: { x: 18, y: 0, scale: 1 },
      collapseArrow: { x: 0, y: -1 },
      body: { x: 10, y: 0, scale: 1 },
      infoButton: { x: 14, y: -5, scale: 1.5 },
      badge: { x: 169, y: -8, scale: 0.7 },
      alertIcon: { x: -5, y: 0, scale: 0.8 },
      alertSymbol: { x: 0, y: -1, scale: 0.9 },
      divider: { x: -10, y: 0, scale: 1.5 },
      textBlock: { x: 0, y: 5, scale: 1 },
      title: { x: -16, y: -4, scale: 1.3 },
      subtitle: { x: -15, y: -8, scale: 1 },
      actions: { x: 40, y: 0, scale: 0.8 },
      primaryButton: { x: -40, y: 0, scale: 1, scaleX: 1.6, scaleY: 0.8 },
      primaryIcon: { x: -27, y: 1, scale: 1.8 },
      primaryLabel: { x: -25, y: 1, scale: 2.3 },
      primaryArrow: { x: 30, y: 1, scale: 1 },
      secondaryButton: { x: -10, y: 0, scale: 1, scaleX: 1, scaleY: 0.8 },
      secondaryLabel: { x: 0, y: 0, scale: 1 },
      secondarySubLabel: { x: 0, y: 0, scale: 1 },
      popover: { x: 0, y: 0, scale: 1 },
    },
  },

  // Hero copy block inside the main yearly card.
  hero: {
    titleTop: 75,
    valueTop: 110,
    valueMaxWidth: 230,
    valueMaxFontSize: 58,
    valueMinFontSize: 34,
    sentenceTop: 170,
    centerX: 0,
    sentenceMaxWidth: 230,
  },

  // Reference row: goal and before-tax target pills.
  refs: {
    rowTop: 232,
    insetX: 11,
    gap: 16,
    leftOffsetX: -1,
    leftOffsetY: 0,
    rightOffsetX: 0,
    rightOffsetY: 0,
  },

  // Progress strip: tune label, status, track, and thumb separately.
  progress: {
    rowTop: 297.1,
    insetX: 13,
    labelY: 5,
    statusX: 8,
    statusY: 5,
    trackY: 30,
    trackHeight: 11.5,
    thumbY: 19,
    thumbClampMin: 4,
    thumbClampMax: 96,
  },

  // Metrics row: before-tax projection and monthly gap cards.
  metrics: {
    rowTop: 390,
    insetX: 16,
    gap: 40,
    leftOffsetX: 0,
    leftOffsetY: 0,
    rightOffsetX: 0,
    rightOffsetY: 0,
  },

  // Tax support section: heading block plus the two support items.
  tax: {
    sectionTop: 481,
    insetX: 12,
    headingY: 0,
    itemsY: 43,
    gap: 12,
    leftOffsetX: 0,
    leftOffsetY: -10,
    rightOffsetX: 8,
    rightOffsetY: -10,

    taxReservedIconSize: 40,
    taxReservedLabelSize: 11,
    taxReservedValueSize: 13,
    taxToSaveIconSize: 40,
    taxToSaveLabelSize: 9.8,
    taxToSaveValueSize: 13,
  },

  // Bottom nav: dock frame plus per-slot offsets.
  nav: {
    bottom:10,
    side: 60,
    height: 101,
    gap: 45,

    selectedCoverOffsetX: 0.5,
    selectedCoverOffsetY: 0,
    selectedCoverScaleX: 2.02,
    selectedCoverScaleY: 1.03,
    selectedCoverRadius: 9,

    leftOffsetX: 0,
    leftOffsetY: 0,
    centerOffsetX: 0,
    centerOffsetY: 0,
    rightOffsetX: 0,
    rightOffsetY: 0,

    reportIconOffsetX: -10,
    reportIconOffsetY: 0,
    reportIconScale: 1.5,
    dashboardIconOffsetX: 0,
    dashboardIconOffsetY: 0,
    dashboardIconScale: 2.5,
    configurationIconOffsetX: 10,
    configurationIconOffsetY: 0,
    configurationIconScale: 2,

    reportLabelOffsetX: -10,
    reportLabelOffsetY: 20,
    reportLabelScale: 1.6,
    dashboardLabelOffsetX: 0,
    dashboardLabelOffsetY: 20,
    dashboardLabelScale: 2,
    configurationLabelOffsetX: 15,
    configurationLabelOffsetY: 20,
    configurationLabelScale: 1.6,
  },
} as const;

type WeeklyItemId = "hoursLeft" | "worked" | "goal" | "invoiced";
type NavItemId = "report" | "dashboard" | "configuration";
type TaxItemId = "taxReserved" | "taxToSave";

function getOffsetTransform(offsetX = 0, offsetY = 0) {
  return `translate(${offsetX}px, ${offsetY}px)`;
}

function getOffsetScaleTransform(offsetX = 0, offsetY = 0, scale = 1) {
  return `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

function getTrayPartTransform(
  control: {
    x: number;
    y: number;
    scale: number;
    scaleX?: number;
    scaleY?: number;
  },
  baseTransform = "",
) {
  return `${baseTransform} translate(${control.x}px, ${control.y}px) scale(${control.scale})`.trim();
}

function getTrayShapeScaleTransform(control: {
  scaleX?: number;
  scaleY?: number;
}) {
  const scaleX = control.scaleX ?? 1;
  const scaleY = control.scaleY ?? 1;

  return `scaleX(${scaleX}) scaleY(${scaleY})`;
}

function getSingleLineFitFontSize(
  text: string,
  maxFontSize: number,
  characterWidthRatio: number,
) {
  const estimatedTextWidth = Math.max(1, text.length * characterWidthRatio);

  return `min(${maxFontSize}px, calc(100cqw / ${estimatedTextWidth}))`;
}

function getPrimaryActionLabelFontSize(text: string) {
  if (text.length >= 18) {
    return getSingleLineFitFontSize(text, 14, 0.48);
  }

  return getSingleLineFitFontSize(text, 12, 0.5);
}

function getWeeklyItemOffsetY(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftOffsetY;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedOffsetY;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalOffsetY;
  }

  return DASHBOARD_POS.weekly.invoicedOffsetY;
}

function getWeeklyItemOffsetX(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftOffsetX;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedOffsetX;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalOffsetX;
  }

  return DASHBOARD_POS.weekly.invoicedOffsetX;
}

function getWeeklyIconOffsetY(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftIconOffsetY;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedIconOffsetY;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalIconOffsetY;
  }

  return DASHBOARD_POS.weekly.invoicedIconOffsetY;
}

function getWeeklyIconOffsetX(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftIconOffsetX;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedIconOffsetX;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalIconOffsetX;
  }

  return DASHBOARD_POS.weekly.invoicedIconOffsetX;
}

function getWeeklyIconSize(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftIconSize;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedIconSize;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalIconSize;
  }

  return DASHBOARD_POS.weekly.invoicedIconSize;
}

function getWeeklyValueOffsetY(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftValueOffsetY;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedValueOffsetY;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalValueOffsetY;
  }

  return DASHBOARD_POS.weekly.invoicedValueOffsetY;
}

function getWeeklyValueOffsetX(id: WeeklyItemId) {
  if (id === "hoursLeft") {
    return DASHBOARD_POS.weekly.hoursLeftValueOffsetX;
  }

  if (id === "worked") {
    return DASHBOARD_POS.weekly.workedValueOffsetX;
  }

  if (id === "goal") {
    return DASHBOARD_POS.weekly.goalValueOffsetX;
  }

  return DASHBOARD_POS.weekly.invoicedValueOffsetX;
}

function getWeeklyLabelFontSize(label: string) {
  if (label.length > 16) {
    return 9.5;
  }

  return 11;
}

function getWeeklyValueMaxWidth(id: WeeklyItemId) {
  const tileWidth =
    (STAGE_WIDTH -
      DASHBOARD_POS.weekly.side * 2 -
      DASHBOARD_POS.weekly.gap * 3) /
    4;
  const itemPadding = 8;
  const iconGap = Math.max(0, DASHBOARD_POS.weekly.iconLabelGap);

  return Math.max(18, tileWidth - itemPadding - getWeeklyIconSize(id) - iconGap);
}

function getWeeklyValueFontSize(id: WeeklyItemId, value: string) {
  const maxFontSize = 17;
  const minFontSize = 9;
  const characterWidthRatio = 0.58;
  const availableWidth = getWeeklyValueMaxWidth(id);
  const estimatedWidth = value.length * maxFontSize * characterWidthRatio;

  if (estimatedWidth <= availableWidth) {
    return maxFontSize;
  }

  return Math.max(
    minFontSize,
    Math.min(maxFontSize, availableWidth / (value.length * characterWidthRatio)),
  );
}

function getNavIconOffsetX(id: NavItemId) {
  if (id === "report") {
    return DASHBOARD_POS.nav.reportIconOffsetX;
  }

  if (id === "dashboard") {
    return DASHBOARD_POS.nav.dashboardIconOffsetX;
  }

  return DASHBOARD_POS.nav.configurationIconOffsetX;
}

function getNavIconOffsetY(id: NavItemId) {
  if (id === "report") {
    return DASHBOARD_POS.nav.reportIconOffsetY;
  }

  if (id === "dashboard") {
    return DASHBOARD_POS.nav.dashboardIconOffsetY;
  }

  return DASHBOARD_POS.nav.configurationIconOffsetY;
}

function getNavIconScale(id: NavItemId) {
  if (id === "report") {
    return DASHBOARD_POS.nav.reportIconScale;
  }

  if (id === "dashboard") {
    return DASHBOARD_POS.nav.dashboardIconScale;
  }

  return DASHBOARD_POS.nav.configurationIconScale;
}

function getNavLabelOffsetX(id: NavItemId) {
  if (id === "report") {
    return DASHBOARD_POS.nav.reportLabelOffsetX;
  }

  if (id === "dashboard") {
    return DASHBOARD_POS.nav.dashboardLabelOffsetX;
  }

  return DASHBOARD_POS.nav.configurationLabelOffsetX;
}

function getNavLabelOffsetY(id: NavItemId) {
  if (id === "report") {
    return DASHBOARD_POS.nav.reportLabelOffsetY;
  }

  if (id === "dashboard") {
    return DASHBOARD_POS.nav.dashboardLabelOffsetY;
  }

  return DASHBOARD_POS.nav.configurationLabelOffsetY;
}

function getNavLabelScale(id: NavItemId) {
  if (id === "report") {
    return DASHBOARD_POS.nav.reportLabelScale;
  }

  if (id === "dashboard") {
    return DASHBOARD_POS.nav.dashboardLabelScale;
  }

  return DASHBOARD_POS.nav.configurationLabelScale;
}

function getTaxIconSize(id: TaxItemId) {
  return id === "taxReserved"
    ? DASHBOARD_POS.tax.taxReservedIconSize
    : DASHBOARD_POS.tax.taxToSaveIconSize;
}

function getTaxLabelSize(id: TaxItemId) {
  return id === "taxReserved"
    ? DASHBOARD_POS.tax.taxReservedLabelSize
    : DASHBOARD_POS.tax.taxToSaveLabelSize;
}

function getTaxValueSize(id: TaxItemId) {
  return id === "taxReserved"
    ? DASHBOARD_POS.tax.taxReservedValueSize
    : DASHBOARD_POS.tax.taxToSaveValueSize;
}

function getHeroValueFontSize(value: string) {
  const characterWidthRatio = 0.58;
  const estimatedWidth =
    value.length * DASHBOARD_POS.hero.valueMaxFontSize * characterWidthRatio;

  if (estimatedWidth <= DASHBOARD_POS.hero.valueMaxWidth) {
    return DASHBOARD_POS.hero.valueMaxFontSize;
  }

  return Math.max(
    DASHBOARD_POS.hero.valueMinFontSize,
    Math.min(
      DASHBOARD_POS.hero.valueMaxFontSize,
      DASHBOARD_POS.hero.valueMaxWidth / (value.length * characterWidthRatio),
    ),
  );
}

interface DashboardProps {
  displayName?: string;
  entries: DailyEntry[];
  isReportsAlertDismissed: boolean;
  monthlySummaries: MonthlySummary[];
  onNavigate?: (screen: Screen) => void;
  onGreetingShown?: () => void;
  onOpenConfigurationSetup: () => void;
  onAddPreviousMonths: () => void;
  onDismissCurrentMonthReminder: () => void;
  onFillMissingDays: (targetDateKey?: string) => void;
  settings: Settings;
  shouldShowGreeting?: boolean;
}

export function Dashboard({
  displayName,
  entries,
  isReportsAlertDismissed,
  monthlySummaries,
  onNavigate,
  onGreetingShown,
  onOpenConfigurationSetup,
  onAddPreviousMonths,
  onDismissCurrentMonthReminder,
  onFillMissingDays,
  settings,
  shouldShowGreeting = false,
}: DashboardProps) {
  const stageScale = useDashboardStageScale();
  const greetingTimeoutRef = useRef<number | null>(null);
  const [isGreetingVisible, setIsGreetingVisible] = useState(false);
  const [isAlertTrayCollapsed, setIsAlertTrayCollapsed] = useState(false);
  const [isSetupHiddenForCardView, setIsSetupHiddenForCardView] =
    useState(false);
  const now = new Date();
  const week = getCurrentWeekStats(entries, settings);
  const invoicedThisWeek = getCurrentWeekInvoicedIncome(entries, now);
  const month = getCurrentMonthStats(entries, monthlySummaries, settings);
  const year = getCurrentYearStats(entries, monthlySummaries, settings);
  const projectedTakeHome = year.projectedAnnualNet;
  const yearlyNetGoal = settings.targetNetMonth
    ? settings.targetNetMonth * 12
    : 0;
  const beforeTaxTarget = year.requiredAnnualBeforeTaxAmount;
  const greeting = getGreeting(now, displayName);
  const hasBusinessHistory = entries.length > 0 || monthlySummaries.length > 0;
  const setupCompleteness = getSetupCompleteness(
    settings,
    entries,
    monthlySummaries,
    now,
  );
  const earliestMissingCurrentMonthDay = getEarliestMissingCurrentMonthWeekday(
    entries,
    now,
  );
  const shouldShowCurrentMonthReminder =
    earliestMissingCurrentMonthDay !== undefined;
  const missingPreviousMonthSummaryKeys = getMissingPreviousMonthSummaryKeys(
    entries,
    monthlySummaries,
    now,
  );
  const earliestMissingHistoricalDay = getEarliestMissingPreviousMonthWeekday(
    entries,
    monthlySummaries,
    now,
  );
  const baseConfigurationStatus = !setupCompleteness.baseConfigurationComplete
    ? "Missing"
    : setupCompleteness.isUsingStarterBaseSettings
      ? "Review recommended"
      : "Ready";
  const isBaseConfigurationMissing = baseConfigurationStatus !== "Ready";
  const isSetupIncomplete =
    isBaseConfigurationMissing ||
    missingPreviousMonthSummaryKeys.length > 0 ||
    earliestMissingHistoricalDay !== undefined;
  const hasMissingDaysReports =
    !isReportsAlertDismissed && shouldShowCurrentMonthReminder;
  const projectedProfit = year.projectedAnnualPreTaxIncome;
  const gapToGoal =
    projectedTakeHome === undefined
      ? undefined
      : Math.max(0, yearlyNetGoal - projectedTakeHome);
  const amountAhead =
    projectedTakeHome === undefined
      ? undefined
      : Math.max(0, projectedTakeHome - yearlyNetGoal);
  const goalProgress =
    projectedTakeHome === undefined || yearlyNetGoal <= 0
      ? undefined
      : Math.min(100, (projectedTakeHome / yearlyNetGoal) * 100);
  const monthsRemaining = Math.max(1, 12 - now.getMonth());
  const neededMonthlyAverage =
    gapToGoal === undefined || gapToGoal <= 0 ? 0 : gapToGoal / monthsRemaining;
  const status = getTargetStatus(projectedTakeHome, yearlyNetGoal);
  const setupBanner = isSetupIncomplete
    ? {
        kind: "configuration" as const,
        missingReportDateKey:
          !isBaseConfigurationMissing &&
          missingPreviousMonthSummaryKeys.length === 0
            ? earliestMissingHistoricalDay
            : undefined,
        tooltip: isBaseConfigurationMissing
          ? "Your core setup is incomplete. Add your defaults, financial assumptions, and targets so projections, tax guidance, and progress tracking can work correctly."
          : missingPreviousMonthSummaryKeys.length > 0
            ? "Your reporting history is incomplete. Backfill daily logs or add monthly summaries to improve yearly accuracy."
            : "Your reporting history has missing work days. Complete the first missing day in your earliest partial month to improve yearly accuracy.",
      }
    : null;
  const reportsBanner = hasMissingDaysReports
    ? {
        kind: "reports" as const,
        tooltip:
          "Some work days in the current month have not been reported yet. Reporting them improves this month’s totals, yearly projections, tax guidance, and progress tracking.",
      }
    : null;
  const visibleBanner =
    setupBanner && !isSetupHiddenForCardView
      ? setupBanner
      : reportsBanner
        ? reportsBanner
        : setupBanner;
  const heroSupportSentence = getHeroSupportSentence({
    amountAhead,
    gapToGoal,
    monthsRemaining,
    neededMonthlyAverage,
    projectedTakeHome,
    yearlyNetGoal,
  });

  const openConfigurationSetupFromAlert = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(CONFIG_SCREEN_INTENT_KEY, "complete-setup");
      window.sessionStorage.setItem(
        CONFIG_SCREEN_FOCUS_TARGET_KEY,
        "first-missing-or-default",
      );
    }

    onOpenConfigurationSetup();
  };

  const openHistoryUpdateFromAlert = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(CONFIG_SCREEN_INTENT_KEY, "update-history");
      window.sessionStorage.setItem(
        CONFIG_SCREEN_FOCUS_TARGET_KEY,
        "add-month",
      );
    }

    onAddPreviousMonths();
  };

  const handleCollapseAlertTray = () => {
    setIsAlertTrayCollapsed(true);
  };

  const handleExpandAlertTray = () => {
    setIsSetupHiddenForCardView(false);
    setIsAlertTrayCollapsed(false);
  };

  const handleSetupLater = () => {
    if (reportsBanner) {
      setIsSetupHiddenForCardView(true);
      setIsAlertTrayCollapsed(false);
      return;
    }

    setIsAlertTrayCollapsed(true);
  };

  const handleReportsDismiss = () => {
    setIsSetupHiddenForCardView(false);
    setIsAlertTrayCollapsed(false);
    onDismissCurrentMonthReminder();
  };

  useEffect(() => {
    if (!isSetupIncomplete) {
      setIsSetupHiddenForCardView(false);
    }
  }, [isSetupIncomplete]);

  useEffect(() => {
    if (!shouldShowGreeting) {
      return;
    }

    if (greetingTimeoutRef.current !== null) {
      window.clearTimeout(greetingTimeoutRef.current);
    }

    setIsGreetingVisible(true);
    onGreetingShown?.();

    greetingTimeoutRef.current = window.setTimeout(() => {
      setIsGreetingVisible(false);
      greetingTimeoutRef.current = null;
    }, 20000);
  }, [onGreetingShown, shouldShowGreeting]);

  useEffect(() => {
    return () => {
      if (greetingTimeoutRef.current !== null) {
        window.clearTimeout(greetingTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[180] overflow-hidden bg-black text-[#f7ebda]">
      <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
        <div
          className="absolute left-1/2 top-1/2 h-[844px] w-[390px] overflow-hidden rounded-[2rem] bg-[#050505] shadow-[0_28px_80px_rgba(0,0,0,0.72)]"
          style={{
            transform: `translate(-50%, -50%) scale(${stageScale})`,
            transformOrigin: "center center",
          }}
        >
          <Image
            alt=""
            className="pointer-events-none object-fill"
            fill
            priority
            sizes="390px"
            src={CleanDash}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,219,172,0.05),transparent_34%),linear-gradient(180deg,rgba(0,0,0,0.03),rgba(0,0,0,0.12))]" />
          <DashboardBannerAnimationStyles />

          <WeeklyStrip
            items={[
              {
                id: "hoursLeft",
                icon: SandClockIcon,
                label: "Hours left",
                value: formatHours(week.hoursLeft),
              },
              {
                id: "worked",
                icon: BriefcaseIcon,
                label: "Worked",
                value: formatHours(week.actualHours),
              },
              {
                id: "goal",
                icon: CompassIcon,
                label: "Goal",
                value: formatHours(week.goalHours),
              },
              {
                id: "invoiced",
                icon: InvoiceIcon,
                label: "Invoiced",
                value: formatCurrency(invoicedThisWeek),
              },
            ]}
          />

          {isGreetingVisible ? (
            <GreetingBubble greeting={greeting} now={now} />
          ) : null}

          {visibleBanner ? (
            <DashboardSupportTray
              bannerKind={visibleBanner.kind}
              infoTooltip={visibleBanner.tooltip}
              isCollapsed={isAlertTrayCollapsed}
              onAddPreviousMonths={openHistoryUpdateFromAlert}
              onCollapse={handleCollapseAlertTray}
              onDismissCurrentMonthReminder={handleReportsDismiss}
              onExpand={handleExpandAlertTray}
              onFillMissingDays={onFillMissingDays}
              onLaterSetup={handleSetupLater}
              onOpenConfigurationSetup={openConfigurationSetupFromAlert}
              reportTargetDateKey={
                "missingReportDateKey" in visibleBanner
                  ? visibleBanner.missingReportDateKey
                  : undefined
              }
            />
          ) : null}

          <YearlyPlanningCard
            beforeTaxTarget={beforeTaxTarget}
            goalProgress={goalProgress}
            hasBusinessHistory={hasBusinessHistory}
            monthReservedTax={month.reservedTaxFromPreviousMonths}
            monthlyGap={
              projectedTakeHome === undefined ? undefined : neededMonthlyAverage
            }
            projectedProfit={projectedProfit}
            projectedTakeHome={projectedTakeHome}
            statusLabel={status.label}
            statusKind={status.kind}
            supportSentence={heroSupportSentence}
            taxToSaveThisMonth={month.forecastCalculatedTaxToSaveThisMonth}
            yearlyNetGoal={yearlyNetGoal}
          />

          <BottomNavigationDock onNavigate={onNavigate} />
        </div>
      </div>
    </div>
  );
}

function useDashboardStageScale() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const availableWidth = Math.max(
        1,
        window.innerWidth - STAGE_VIEWPORT_PADDING,
      );
      const availableHeight = Math.max(
        1,
        window.innerHeight - STAGE_VIEWPORT_PADDING,
      );
      const nextScale = Math.min(
        1,
        availableWidth / STAGE_WIDTH,
        availableHeight / STAGE_HEIGHT,
      );

      setScale(Number(nextScale.toFixed(4)));
    };

    updateScale();
    window.addEventListener("resize", updateScale);

    return () => {
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  return scale;
}

function WeeklyStrip({
  items,
}: {
  items: Array<{
    id: WeeklyItemId;
    icon: StaticImageData;
    label: string;
    value: string;
  }>;
}) {
  return (
    <>
      <div
        className="absolute left-0 right-0 z-[1] flex items-center justify-center"
        style={{
          top: DASHBOARD_POS.weekly.headingTop,
          transform: getOffsetTransform(
            DASHBOARD_POS.weekly.headingOffsetX,
            DASHBOARD_POS.weekly.headingOffsetY,
          ),
        }}
      >
        <span
          className="inline-flex items-center justify-center rounded-full border border-[#f1c78a]/38 bg-[linear-gradient(180deg,rgba(34,23,17,0.99),rgba(16,10,7,0.99))] px-0.5 shadow-[0_0_0_1px_rgba(255,231,190,0.05),0_8px_16px_rgba(0,0,0,0.36),0_0_12px_rgba(227,165,96,0.1)]"
          style={{
            height: DASHBOARD_POS.weekly.headingPillHeight,
          }}
        >
          <span
            className="dashboard-gold-title text-[8px] font-semibold uppercase tracking-[0.16em] leading-none"
            style={{
              transform: `${getOffsetTransform(
                DASHBOARD_POS.weekly.headingTextOffsetX,
                DASHBOARD_POS.weekly.headingTextOffsetY,
              )} scale(${DASHBOARD_POS.weekly.headingTextScale})`,
            }}
          >
            This Week
          </span>
        </span>
      </div>

      <section
        className="absolute grid grid-cols-4"
        style={{
          left: DASHBOARD_POS.weekly.side,
          right: DASHBOARD_POS.weekly.side,
          top: DASHBOARD_POS.weekly.top,
          height: DASHBOARD_POS.weekly.height,
          gap: DASHBOARD_POS.weekly.gap,
        }}
      >
        {items.map((item) => (
          <WeeklyStripItem
            id={item.id}
            key={item.label}
            icon={item.icon}
            label={item.label}
            value={item.value}
          />
        ))}
      </section>
    </>
  );
}

function WeeklyStripItem({
  id,
  icon,
  label,
  value,
}: {
  id: WeeklyItemId;
  icon: StaticImageData;
  label: string;
  value: string;
}) {
  const iconSize = getWeeklyIconSize(id);

  return (
    <div
      className="grid h-full min-w-0 justify-items-center overflow-visible px-1 text-center"
      style={{
        transform: getOffsetTransform(
          getWeeklyItemOffsetX(id),
          getWeeklyItemOffsetY(id),
        ),
        gridTemplateRows: `${DASHBOARD_POS.weekly.labelRowHeight}px minmax(0, 1fr)`,
        rowGap: DASHBOARD_POS.weekly.labelValueGap,
      }}
    >
      <span
        className="dashboard-gold-label flex w-full items-center justify-center text-center font-bold"
        style={{
          fontSize: getWeeklyLabelFontSize(label),
          lineHeight: 1.05,
          overflowWrap: "anywhere",
          transform: getOffsetTransform(
            0,
            DASHBOARD_POS.weekly.labelRowOffsetY,
          ),
        }}
      >
        {label}
      </span>
      <span
        className="flex min-w-0 items-center justify-center"
        style={{
          transform: getOffsetTransform(
            0,
            DASHBOARD_POS.weekly.iconValueRowOffsetY,
          ),
        }}
      >
        <span
          className="relative shrink-0"
          style={{
            height: iconSize,
            transform: getOffsetTransform(
              getWeeklyIconOffsetX(id),
              getWeeklyIconOffsetY(id),
            ),
            width: iconSize,
          }}
        >
          <Image
            alt=""
            className="object-contain"
            fill
            sizes={`${iconSize}px`}
            src={icon}
          />
        </span>
        <span
          className="dashboard-gold-value flex min-w-0 items-center justify-center whitespace-nowrap text-center font-semibold"
          style={{
            fontSize: getWeeklyValueFontSize(id, value),
            lineHeight: 1,
            marginLeft: DASHBOARD_POS.weekly.iconLabelGap,
            maxWidth: getWeeklyValueMaxWidth(id),
            overflow: "visible",
            transform: getOffsetTransform(
              getWeeklyValueOffsetX(id),
              getWeeklyValueOffsetY(id),
            ),
          }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

function GreetingBubble({ greeting, now }: { greeting: string; now: Date }) {
  return (
    <div
      className="absolute z-[2]"
      style={{
        left: DASHBOARD_POS.greeting.left,
        top: DASHBOARD_POS.greeting.top,
        maxWidth: DASHBOARD_POS.greeting.maxWidth,
      }}
    >
      <div className="relative rounded-[24px] bg-[#f7ebda] px-4 py-3 text-[#24170d] shadow-[0_14px_30px_rgba(0,0,0,0.26)]">
        <div className="text-[12px] font-semibold leading-[1.15]">
          {greeting}
        </div>
        <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#7f654b]">
          {formatDate(now)}
        </div>
        <span className="absolute -left-3 top-[26px] h-4 w-4 rounded-full bg-[#f7ebda]" />
        <span className="absolute -left-7 top-[34px] h-2.5 w-2.5 rounded-full bg-[#f7ebda]" />
      </div>
    </div>
  );
}

function SetupActionIcon() {
  return (
    <svg aria-hidden="true" className="h-full w-full" viewBox="0 0 24 24">
      <path
        d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.06-1.61a.5.5 0 0 0 .12-.64l-1.95-3.38a.5.5 0 0 0-.6-.22l-2.43.98a7.2 7.2 0 0 0-1.7-.98L14.56 2.6a.5.5 0 0 0-.49-.4h-4.14a.5.5 0 0 0-.49.4l-.37 2.57c-.6.25-1.17.58-1.7.98l-2.43-.98a.5.5 0 0 0-.6.22L2.39 8.77a.5.5 0 0 0 .12.64l2.06 1.61c-.04.32-.07.65-.07.98s.03.66.07.98l-2.06 1.61a.5.5 0 0 0-.12.64l1.95 3.38a.5.5 0 0 0 .6.22l2.43-.98c.53.4 1.1.73 1.7.98l.37 2.57a.5.5 0 0 0 .49.4h4.14a.5.5 0 0 0 .49-.4l.37-2.57c.6-.25 1.17-.58 1.7-.98l2.43.98a.5.5 0 0 0 .6-.22l1.95-3.38a.5.5 0 0 0-.12-.64l-2.06-1.61ZM12 15.25a3.25 3.25 0 1 1 0-6.5 3.25 3.25 0 0 1 0 6.5Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

function SetupWarningIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-[25px] w-[25px] drop-shadow-[0_0_2px_rgba(255,50,22,0.95)]"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M11.99 3.45 21 19.05a1.35 1.35 0 0 1-1.17 2.03H4.16a1.35 1.35 0 0 1-1.17-2.03L12 3.45Z"
        fill="transparent"
        stroke="#ffc226"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M12 9.15v4.55"
        stroke="#ffcb2e"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M12 17.55h.01"
        stroke="#ffcb2e"
        strokeLinecap="round"
        strokeWidth="2.35"
      />
    </svg>
  );
}

function DashboardSupportTray({
  bannerKind,
  infoTooltip,
  isCollapsed,
  onAddPreviousMonths,
  onCollapse,
  onDismissCurrentMonthReminder,
  onExpand,
  onFillMissingDays,
  onLaterSetup,
  onOpenConfigurationSetup,
  reportTargetDateKey,
}: {
  bannerKind: "configuration" | "reports";
  infoTooltip: string;
  isCollapsed: boolean;
  onAddPreviousMonths: () => void;
  onCollapse: () => void;
  onDismissCurrentMonthReminder: () => void;
  onExpand: () => void;
  onFillMissingDays: (targetDateKey?: string) => void;
  onLaterSetup: () => void;
  onOpenConfigurationSetup: () => void;
  reportTargetDateKey?: string;
}) {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const infoPopoverRef = useRef<HTMLDivElement>(null);
  const isConfigurationBanner = bannerKind === "configuration";
  const offsetX = isConfigurationBanner
    ? DASHBOARD_POS.tray.configurationOffsetX
    : DASHBOARD_POS.tray.reportsOffsetX;
  const offsetY = isConfigurationBanner
    ? DASHBOARD_POS.tray.configurationOffsetY
    : DASHBOARD_POS.tray.reportsOffsetY;

  const badgeLabel = isConfigurationBanner ? "Critical" : "Warning";
  const isHistoryBanner =
    isConfigurationBanner &&
    infoTooltip ===
      "Your reporting history is incomplete. Backfill daily logs or add monthly summaries to improve yearly accuracy.";
  const isPartialHistoryBanner =
    isConfigurationBanner &&
    infoTooltip ===
      "Your reporting history has missing work days. Complete the first missing day in your earliest partial month to improve yearly accuracy.";
  const title = isConfigurationBanner
    ? isHistoryBanner || isPartialHistoryBanner
      ? "Missing History"
      : "Missing Configuration"
    : "Missing Days Reports";
  const subtitle = isConfigurationBanner
    ? isHistoryBanner || isPartialHistoryBanner
      ? "Projection incomplete"
      : "Setup incomplete"
    : "Projection compromised";
  const actionLabel = isConfigurationBanner
    ? isHistoryBanner || isPartialHistoryBanner
      ? isPartialHistoryBanner
        ? "Report Missing Days"
        : "Update History"
      : "Complete Setup"
    : "Report Missing Days";
  const secondaryLabel = isConfigurationBanner ? "Later" : "Dismiss";
  const secondarySubLabel = isConfigurationBanner ? "" : "This session";
  const action = isConfigurationBanner
    ? isPartialHistoryBanner
      ? () => onFillMissingDays(reportTargetDateKey)
      : isHistoryBanner
        ? onAddPreviousMonths
        : onOpenConfigurationSetup
    : () => onFillMissingDays();
  const secondaryAction = isConfigurationBanner
    ? onLaterSetup
    : onDismissCurrentMonthReminder;

  useEffect(() => {
    if (isCollapsed) {
      setIsInfoOpen(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    if (!isInfoOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        infoButtonRef.current?.contains(target) ||
        infoPopoverRef.current?.contains(target)
      ) {
        return;
      }

      setIsInfoOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isInfoOpen]);

  return (
    <section
      className="absolute z-[4] overflow-visible"
      style={{
        right: DASHBOARD_POS.tray.right,
        top: DASHBOARD_POS.tray.top,
        width: isCollapsed
          ? DASHBOARD_POS.tray.collapsedWidth
          : DASHBOARD_POS.tray.width,
        height: isCollapsed
          ? DASHBOARD_POS.tray.collapsedHeight
          : DASHBOARD_POS.tray.height,
        transform: `translate(${offsetX}px, ${offsetY}px)`,
        transition:
          "width 260ms cubic-bezier(0.22, 1, 0.36, 1), height 260ms cubic-bezier(0.22, 1, 0.36, 1), transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "width, height, transform",
      }}
    >
      <button
        aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        className="absolute left-0 top-1/2 z-[3] flex items-center justify-center rounded-full border border-[#f1ba6b]/45 bg-[#0f0b08] text-[#ffd791] shadow-[0_0_16px_rgba(255,141,45,0.18),0_8px_18px_rgba(0,0,0,0.34)] transition hover:bg-[#19120d]"
        onClick={isCollapsed ? onExpand : onCollapse}
        style={{
          width: DASHBOARD_POS.tray.collapseButtonSize,
          height: DASHBOARD_POS.tray.collapseButtonSize,
          transform: getTrayPartTransform(
            DASHBOARD_POS.tray.parts.collapseButton,
            "translate(-42%, -50%)",
          ),
        }}
        type="button"
      >
        <span
          className="text-[20px] leading-none"
          style={{
            transform: getOffsetTransform(
              DASHBOARD_POS.tray.parts.collapseArrow.x,
              DASHBOARD_POS.tray.parts.collapseArrow.y,
            ),
          }}
        >
          {isCollapsed ? "‹" : "›"}
        </span>
      </button>

      {isCollapsed ? null : (
        <button
          ref={infoButtonRef}
          aria-label="What does this alert mean?"
          className="absolute right-1 top-1 z-[6] flex h-4 w-4 items-center justify-center rounded-full border border-[#9d7248]/45 bg-[#17110d] text-[9px] font-semibold leading-none text-[#f2d6ab] shadow-[0_6px_14px_rgba(0,0,0,0.28)] transition hover:bg-[#231914]"
          onClick={() => setIsInfoOpen((current) => !current)}
          style={{
            transform: getTrayPartTransform(
              DASHBOARD_POS.tray.parts.infoButton,
            ),
          }}
          type="button"
        >
          i
        </button>
      )}

      {!isCollapsed ? (
        <span
          className="absolute left-0 top-0 z-[7] inline-flex items-center rounded-full border border-[#ff2f22] bg-[linear-gradient(180deg,#58100c,#240605)] px-2.5 py-[4px] text-[8px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_0_1px_rgba(255,245,236,0.36),0_0_4px_rgba(255,38,25,0.78),0_0_4px_rgba(255,77,32,0.46)]"
          style={{
            transform: getTrayPartTransform(DASHBOARD_POS.tray.parts.badge),
          }}
        >
          {badgeLabel}
        </span>
      ) : null}

      <div
        className="relative ml-4 flex h-full items-center overflow-hidden rounded-[999px] border border-[#ffd15b] bg-[radial-gradient(circle_at_top,rgba(255,218,85,0.22),transparent_42%),linear-gradient(180deg,rgba(32,20,13,0.98),rgba(13,8,7,0.98))] px-4 shadow-[0_0_2px_rgba(255,251,202,0.72),0_0_2px_rgba(255,202,38,0.62),0_0_44px_rgba(255,119,35,0.38),0_14px_30px_rgba(0,0,0,0.36)]"
        style={{
          transform: getTrayPartTransform(DASHBOARD_POS.tray.parts.body),
        }}
      >
        <span className="pointer-events-none absolute inset-[1px] rounded-[999px] border border-[#fff4ad]/40 shadow-[inset_0_0_3px_rgba(255,201,55,0.18),0_0_18px_rgba(255,217,82,0.48)]" />

        <div
          className="relative flex shrink-0 items-center justify-center rounded-full border border-[#ff7a27] bg-[radial-gradient(circle,rgba(255,144,35,0.62)_0%,rgba(255,89,22,0.38)_4%,rgba(149,22,12,0.24)_5%)] text-[#ffc11e] shadow-[0_0_2px_rgba(255,128,48,0.9),0_0_5px_rgba(255,38,20,0.82),0_0_10px_rgba(208,18,12,0.56)]"
          style={{
            width: DASHBOARD_POS.tray.alertIconSize,
            height: DASHBOARD_POS.tray.alertIconSize,
            transform: getTrayPartTransform(DASHBOARD_POS.tray.parts.alertIcon),
          }}
        >
          <span className="absolute inset-0 rounded-full shadow-[inset_0_0_10px_rgba(255,190,80,0.22),inset_0_-8px_14px_rgba(194,25,12,0.28)]" />
          <span
            className="relative flex h-full w-full items-center justify-center"
            style={{
              transform: getTrayPartTransform(
                DASHBOARD_POS.tray.parts.alertSymbol,
              ),
            }}
          >
            <SetupWarningIcon />
          </span>
        </div>

        {isCollapsed ? null : (
          <>
            <div
              className="mx-3 h-[50px] w-px shrink-0 bg-[linear-gradient(180deg,rgba(255,199,121,0),rgba(255,199,121,0.42),rgba(255,199,121,0))]"
              style={{
                transform: getTrayPartTransform(
                  DASHBOARD_POS.tray.parts.divider,
                ),
              }}
            />

            <div
              className="min-w-0 flex-1 pr-2"
              style={{
                containerType: "inline-size",
                transform: getTrayPartTransform(
                  DASHBOARD_POS.tray.parts.textBlock,
                ),
              }}
            >
              <p
                className="mt-1.5 whitespace-nowrap font-semibold leading-none text-[#fff6e7]"
                style={{
                  fontSize: getSingleLineFitFontSize(title, 17, 0.58),
                  transform: getTrayPartTransform(
                    DASHBOARD_POS.tray.parts.title,
                  ),
                  transformOrigin: "left center",
                }}
              >
                {title}
              </p>
              <p
                className="mt-1.5 whitespace-nowrap leading-none text-[#d6b692]"
                style={{
                  fontSize: getSingleLineFitFontSize(subtitle, 11, 0.5),
                  transform: getTrayPartTransform(
                    DASHBOARD_POS.tray.parts.subtitle,
                  ),
                  transformOrigin: "left center",
                }}
              >
                {subtitle}
              </p>
            </div>

            <div
              className="ml-1 flex shrink-0 items-center"
              style={{
                gap: DASHBOARD_POS.tray.actionGap,
                transform: getTrayPartTransform(
                  DASHBOARD_POS.tray.parts.actions,
                ),
                transformOrigin: "left center",
                width: DASHBOARD_POS.tray.actionsWidth,
              }}
            >
              <button
                className="relative isolate inline-flex h-11 min-w-0 flex-1 items-center gap-1.5 overflow-visible rounded-[5px] px-2 text-[12px] font-semibold text-[#160d04] transition hover:brightness-105"
                onClick={action}
                style={{
                  transform: getTrayPartTransform(
                    DASHBOARD_POS.tray.parts.primaryButton,
                  ),
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 -z-10 rounded-[6px] border border-[#fff7c3] bg-[linear-gradient(180deg,#ff9c32_0%,#ffd94f_55%,#fff8cf_100%)] shadow-[0_0_2px_rgba(255,255,237,0.92),0_0_4px_rgba(255,217,65,0.86),0_0_2px_rgba(255,124,28,0.58),0_8px_16px_rgba(0,0,0,0.2)]"
                  style={{
                    width: `${(DASHBOARD_POS.tray.parts.primaryButton.scaleX ?? 1) * 100}%`,
                    height: `${(DASHBOARD_POS.tray.parts.primaryButton.scaleY ?? 1) * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
                <span
                  className="flex h-[17px] w-[17px] shrink-0 items-center justify-center leading-none"
                  style={{
                    transform: getTrayPartTransform(
                      DASHBOARD_POS.tray.parts.primaryIcon,
                    ),
                  }}
                >
                  {isConfigurationBanner ? <SetupActionIcon /> : "🗓"}
                </span>
                <span
                  className="min-w-0 flex-1"
                  style={{
                    containerType: "inline-size",
                  }}
                >
                  <span
                    className="block whitespace-nowrap leading-none"
                    style={{
                      fontSize: getPrimaryActionLabelFontSize(actionLabel),
                      transform: getTrayPartTransform(
                        DASHBOARD_POS.tray.parts.primaryLabel,
                      ),
                      transformOrigin: "left center",
                    }}
                  >
                    {actionLabel}
                  </span>
                </span>
                <span
                  className="text-[16px] leading-none"
                  style={{
                    transform: getTrayPartTransform(
                      DASHBOARD_POS.tray.parts.primaryArrow,
                    ),
                  }}
                >
                  ›
                </span>
              </button>

              <button
                className="relative isolate flex h-11 w-[62px] shrink-0 flex-col items-center justify-center overflow-visible rounded-[9px] px-1 text-[#dfc6a8] transition hover:brightness-110"
                onClick={secondaryAction}
                style={{
                  containerType: "inline-size",
                  transform: getTrayPartTransform(
                    DASHBOARD_POS.tray.parts.secondaryButton,
                  ),
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-[9px] border border-[#a97849]/65 bg-[#1a1410]"
                  style={{
                    transform: getTrayShapeScaleTransform(
                      DASHBOARD_POS.tray.parts.secondaryButton,
                    ),
                  }}
                />
                <span
                  className="whitespace-nowrap font-semibold leading-none"
                  style={{
                    fontSize: getSingleLineFitFontSize(
                      secondaryLabel,
                      11,
                      0.56,
                    ),
                    transform: getTrayPartTransform(
                      DASHBOARD_POS.tray.parts.secondaryLabel,
                    ),
                    transformOrigin: "center",
                  }}
                >
                  {secondaryLabel}
                </span>
                {secondarySubLabel ? (
                  <span
                    className="mt-1 whitespace-nowrap leading-none text-[#a88c71]"
                    style={{
                      fontSize: getSingleLineFitFontSize(
                        secondarySubLabel,
                        9,
                        0.54,
                      ),
                      transform: getTrayPartTransform(
                        DASHBOARD_POS.tray.parts.secondarySubLabel,
                      ),
                      transformOrigin: "center",
                    }}
                  >
                    {secondarySubLabel}
                  </span>
                ) : null}
              </button>
            </div>
          </>
        )}
      </div>

      {!isCollapsed && isInfoOpen ? (
        <div
          ref={infoPopoverRef}
          className="absolute right-10 top-[calc(100%+2px)] rounded-[16px] border border-[#8b653f]/45 bg-[rgba(14,10,8,0.97)] p-3 text-[12px] leading-[1.35] text-[#f0e0c7] shadow-[0_14px_28px_rgba(0,0,0,0.34)] backdrop-blur"
          style={{
            width: DASHBOARD_POS.tray.popoverWidth,
            transform: getTrayPartTransform(DASHBOARD_POS.tray.parts.popover),
          }}
        >
          {infoTooltip}
        </div>
      ) : null}
    </section>
  );
}

function DashboardBannerAnimationStyles() {
  return (
    <style jsx global>{`
      @keyframes dashboardBannerContentIn {
        0% {
          opacity: 0;
          transform: translateX(8px) scale(0.98);
        }
        60% {
          opacity: 1;
          transform: translateX(-2px) scale(1.01);
        }
        100% {
          opacity: 1;
          transform: translateX(0) scale(1);
        }
      }

      .dashboard-gold-label {
        background: linear-gradient(
          180deg,
          #fff3df 0%,
          #e5c6a3 48%,
          #b9845f 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 1px 1px rgba(18, 10, 5, 0.76))
          drop-shadow(0 0 4px rgba(205, 142, 88, 0.16));
      }

      .dashboard-gold-soft {
        background: linear-gradient(
          180deg,
          #f9dfbc 0%,
          #c99770 58%,
          #9e6848 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 1px 1px rgba(15, 8, 4, 0.78));
      }

      .dashboard-gold-title {
        background: linear-gradient(
          180deg,
          #fff8ec 0%,
          #ead0ad 48%,
          #bd8a63 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        line-height: 1.08;
        filter: drop-shadow(0 2px 2px rgba(17, 9, 4, 0.82))
          drop-shadow(0 0 7px rgba(210, 152, 95, 0.2));
      }

      .dashboard-gold-value {
        background: linear-gradient(
          180deg,
          #f7d7a8 0%,
          #d69a61 42%,
          #aa6f43 72%,
          #7a4629 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 2px 2px rgba(18, 9, 4, 0.82))
          drop-shadow(0 0 8px rgba(190, 126, 70, 0.24));
      }

      .dashboard-gold-hero-value {
        background: linear-gradient(
          180deg,
          #fff1ca 0%,
          #e9bf7f 30%,
          #c3824a 64%,
          #7f492a 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        letter-spacing: 0;
        filter: drop-shadow(0 4px 4px rgba(18, 9, 4, 0.88))
          drop-shadow(0 0 14px rgba(205, 139, 75, 0.3));
      }

      .dashboard-nav-active-text {
        background: linear-gradient(
          180deg,
          #fff4df 0%,
          #d4a77a 62%,
          #704329 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        filter: drop-shadow(0 1px 1px rgba(255, 242, 207, 0.28));
      }

      .dashboard-status-good {
        color: #aaf0be;
        text-shadow:
          0 1px 1px rgba(5, 18, 8, 0.72),
          0 0 8px rgba(93, 231, 132, 0.24);
      }

      .dashboard-status-waiting {
        color: #fff2a8;
        text-shadow:
          0 1px 1px rgba(32, 23, 4, 0.72),
          0 0 8px rgba(255, 230, 91, 0.26);
      }

      .dashboard-status-set-goal {
        color: #ff5b4f;
        text-shadow:
          0 1px 1px rgba(35, 3, 2, 0.72),
          0 0 8px rgba(255, 50, 37, 0.3);
      }

      .dashboard-status-close {
        color: #67f2dc;
        text-shadow:
          0 1px 1px rgba(3, 24, 22, 0.72),
          0 0 8px rgba(68, 234, 211, 0.28);
      }

      .dashboard-status-behind {
        color: #ffae4f;
        text-shadow:
          0 1px 1px rgba(35, 14, 2, 0.72),
          0 0 8px rgba(255, 134, 37, 0.28);
      }
    `}</style>
  );
}

function YearlyPlanningCard({
  beforeTaxTarget,
  goalProgress,
  hasBusinessHistory,
  monthReservedTax,
  monthlyGap,
  projectedProfit,
  projectedTakeHome,
  statusLabel,
  statusKind,
  supportSentence,
  taxToSaveThisMonth,
  yearlyNetGoal,
}: {
  beforeTaxTarget: number;
  goalProgress: number | undefined;
  hasBusinessHistory: boolean;
  monthReservedTax: number | undefined;
  monthlyGap: number | undefined;
  projectedProfit: number | undefined;
  projectedTakeHome: number | undefined;
  statusLabel: string;
  statusKind: ProgressStatusKind;
  supportSentence: string;
  taxToSaveThisMonth: number | undefined;
  yearlyNetGoal: number;
}) {
  const projectedTakeHomeText =
    projectedTakeHome === undefined ? "—" : formatCurrency(projectedTakeHome);

  return (
    <section
      className="absolute"
      style={{
        left: DASHBOARD_POS.card.insetX,
        right: DASHBOARD_POS.card.insetX,
        top: DASHBOARD_POS.card.top,
        bottom: DASHBOARD_POS.card.bottom,
      }}
    >
      <div className="relative h-full px-[24px]">
        <div className="absolute inset-x-0 top-0">
          <p
            className="dashboard-gold-title absolute text-center text-[15px] font-bold uppercase tracking-[0.08em]"
            style={{
              left: "50%",
              top: DASHBOARD_POS.hero.titleTop,
              width: 260,
              marginLeft: DASHBOARD_POS.hero.centerX,
              transform: "translateX(-50%)",
            }}
          >
            Projected yearly
            <br />
            take-home income (NET)
          </p>
          <p
            className="dashboard-gold-hero-value absolute overflow-visible whitespace-nowrap text-center font-bold leading-[0.9]"
            style={{
              fontSize: getHeroValueFontSize(projectedTakeHomeText),
              left: "50%",
              top: DASHBOARD_POS.hero.valueTop,
              marginLeft: DASHBOARD_POS.hero.centerX,
              transform: "translateX(-50%)",
            }}
          >
            {projectedTakeHomeText}
          </p>
          <p
            className="dashboard-gold-soft absolute whitespace-pre-line text-center text-[13px] leading-[1.28]"
            style={{
              left: "50%",
              top: DASHBOARD_POS.hero.sentenceTop,
              width: "100%",
              maxWidth: DASHBOARD_POS.hero.sentenceMaxWidth,
              marginLeft: DASHBOARD_POS.hero.centerX,
              transform: "translateX(-50%)",
            }}
          >
            {supportSentence}
          </p>
        </div>

        <div
          className="absolute grid grid-cols-2"
          style={{
            left: DASHBOARD_POS.refs.insetX,
            right: DASHBOARD_POS.refs.insetX,
            top: DASHBOARD_POS.refs.rowTop,
            gap: DASHBOARD_POS.refs.gap,
          }}
        >
          <div
            style={{
              transform: getOffsetTransform(
                DASHBOARD_POS.refs.leftOffsetX,
                DASHBOARD_POS.refs.leftOffsetY,
              ),
            }}
          >
            <ReferencePill
              label="Yearly net goal"
              value={formatCurrency(yearlyNetGoal)}
            />
          </div>
          <div
            style={{
              transform: getOffsetTransform(
                DASHBOARD_POS.refs.rightOffsetX,
                DASHBOARD_POS.refs.rightOffsetY,
              ),
            }}
          >
            <ReferencePill
              label="Before-tax target"
              value={formatCurrency(beforeTaxTarget)}
            />
          </div>
        </div>

        <div
          className="absolute"
          style={{
            left: DASHBOARD_POS.progress.insetX,
            right: DASHBOARD_POS.progress.insetX,
            top: DASHBOARD_POS.progress.rowTop,
          }}
        >
          <ProgressRow
            goalProgress={goalProgress}
            statusKind={statusKind}
            statusLabel={statusLabel}
          />
        </div>

        <div
          className="absolute grid grid-cols-2"
          style={{
            left: DASHBOARD_POS.metrics.insetX,
            right: DASHBOARD_POS.metrics.insetX,
            top: DASHBOARD_POS.metrics.rowTop,
            gap: DASHBOARD_POS.metrics.gap,
          }}
        >
          <div
            style={{
              transform: getOffsetTransform(
                DASHBOARD_POS.metrics.leftOffsetX,
                DASHBOARD_POS.metrics.leftOffsetY,
              ),
            }}
          >
            <DashboardMetricCard
              icon={CoinsBeforeTaxIcon}
              label="Pre-tax projection"
              value={
                projectedProfit === undefined
                  ? "—"
                  : formatCurrency(projectedProfit)
              }
            />
          </div>
          <div
            style={{
              transform: getOffsetTransform(
                DASHBOARD_POS.metrics.rightOffsetX,
                DASHBOARD_POS.metrics.rightOffsetY,
              ),
            }}
          >
            <DashboardMetricCard
              icon={GapIcon}
              label="Monthly gap"
              value={
                monthlyGap === undefined ? "—" : formatCurrency(monthlyGap)
              }
            />
          </div>
        </div>

        <div
          className="absolute"
          style={{
            left: DASHBOARD_POS.tax.insetX,
            right: DASHBOARD_POS.tax.insetX,
            top: DASHBOARD_POS.tax.sectionTop,
          }}
        >
          <div className="relative min-h-[112px]">
            <div
              className="absolute left-0 right-0 flex items-center justify-center"
              style={{ top: DASHBOARD_POS.tax.headingY }}
            >
              <span className="dashboard-gold-title text-[11px] font-semibold uppercase tracking-[0.14em]">
                Tax planning support
              </span>
            </div>

            <div
              className="absolute left-0 right-0 px-1"
              style={{ top: DASHBOARD_POS.tax.itemsY }}
            >
              {hasBusinessHistory ? (
                <div
                  className="grid grid-cols-2"
                  style={{ gap: DASHBOARD_POS.tax.gap }}
                >
                  <div
                    style={{
                      transform: getOffsetTransform(
                        DASHBOARD_POS.tax.leftOffsetX,
                        DASHBOARD_POS.tax.leftOffsetY,
                      ),
                    }}
                  >
                    <TaxSupportItem
                      icon={TaxReserveIcon}
                      id="taxReserved"
                      label="Tax reserved so far"
                      value={
                        monthReservedTax === undefined
                          ? "—"
                          : formatCurrency(monthReservedTax)
                      }
                    />
                  </div>
                  <div
                    style={{
                      transform: getOffsetTransform(
                        DASHBOARD_POS.tax.rightOffsetX,
                        DASHBOARD_POS.tax.rightOffsetY,
                      ),
                    }}
                  >
                    <TaxSupportItem
                      icon={CalendarSaveIcon}
                      id="taxToSave"
                      label="Tax to save this month"
                      value={
                        taxToSaveThisMonth === undefined
                          ? "—"
                          : formatCurrency(taxToSaveThisMonth)
                      }
                    />
                  </div>
                </div>
              ) : (
                <p className="dashboard-gold-soft min-h-[40px] px-2 text-center text-[12px] leading-[1.35]">
                  Tax guidance starts after you log income
                  <br />or backfill a month!
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReferencePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[56px] flex-col items-center justify-center px-3 text-center">
      <p className="dashboard-gold-label text-[10px] font-medium uppercase tracking-[0.08em] leading-none">
        {label}
      </p>
      <p className="dashboard-gold-value mt-2 truncate text-[15px] font-semibold leading-none">
        {value}
      </p>
    </div>
  );
}

function ProgressRow({
  goalProgress,
  statusKind,
  statusLabel,
}: {
  goalProgress: number | undefined;
  statusKind: ProgressStatusKind;
  statusLabel: string;
}) {
  const progress = Math.max(0, Math.min(100, goalProgress ?? 0));
  const thumbPosition = Math.max(
    DASHBOARD_POS.progress.thumbClampMin,
    Math.min(DASHBOARD_POS.progress.thumbClampMax, progress),
  );

  return (
    <div className="relative h-[60px] px-1">
      <span
        className="dashboard-gold-title absolute left-0 text-[11px] font-semibold uppercase tracking-[0.13em]"
        style={{ top: DASHBOARD_POS.progress.labelY }}
      >
        {goalProgress === undefined ? "—" : `${formatNumber(goalProgress)}%`}{" "}
        Target Progress
      </span>
      <span
        className={`${getProgressStatusClassName(statusKind)} absolute right-0 max-w-[70%] text-right text-[11px] font-semibold leading-[1.15]`}
        style={{
          top: DASHBOARD_POS.progress.statusY,
          transform: getOffsetTransform(DASHBOARD_POS.progress.statusX, 0),
        }}
      >
        {statusLabel}
      </span>
      <div
        className="absolute left-0 right-0 overflow-hidden rounded-full"
        style={{
          top: DASHBOARD_POS.progress.trackY,
          height: DASHBOARD_POS.progress.trackHeight,
        }}
      >
        <div
          className="relative h-full overflow-hidden rounded-full"
          style={{ width: `${progress}%` }}
        >
          {progress > 0 ? (
            <Image
              alt=""
              className="object-fill"
              fill
              sizes="300px"
              src={SliderFill}
            />
          ) : null}
        </div>
      </div>
      <span
        className="absolute block h-8 w-8 -translate-x-1/2"
        style={{
          left: `${thumbPosition}%`,
          top: DASHBOARD_POS.progress.thumbY,
        }}
      >
        <Image
          alt=""
          className="object-contain"
          fill
          sizes="32px"
          src={SliderButton}
        />
      </span>
    </div>
  );
}

function DashboardMetricCard({
  icon,
  label,
  value,
}: {
  icon: StaticImageData;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-[72px] items-center gap-0 px-0">
      <span className="relative h-9 w-9 shrink-0">
        <Image alt="" className="object-contain" fill sizes="36px" src={icon} />
      </span>
      <span className="min-w-0 flex-1 text-center">
        <span className="dashboard-gold-label block truncate whitespace-nowrap text-[13px] font-medium leading-[1.1]">
          {label}
        </span>
        <span className="dashboard-gold-value mt-2 block truncate text-[18px] font-semibold leading-none">
          {value}
        </span>
      </span>
    </div>
  );
}

function TaxSupportItem({
  icon,
  id,
  label,
  value,
}: {
  icon: StaticImageData;
  id: TaxItemId;
  label: string;
  value: string;
}) {
  const iconSize = getTaxIconSize(id);

  return (
    <div className="flex min-h-[56px] min-w-0 items-center gap-2 px-2 py-1">
      <span
        className="relative shrink-0 opacity-90"
        style={{
          height: iconSize,
          width: iconSize,
        }}
      >
        <Image
          alt=""
          className="object-contain"
          fill
          sizes={`${iconSize}px`}
          src={icon}
        />
      </span>
      <span className="min-w-0 flex-1 text-center">
        <span
          className="dashboard-gold-label block text-center leading-[1.1]"
          style={{ fontSize: getTaxLabelSize(id) }}
        >
          {label}
        </span>
        <span
          className="dashboard-gold-value mt-1 block truncate text-center font-semibold leading-none"
          style={{ fontSize: getTaxValueSize(id) }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

function BottomNavigationDock({
  onNavigate,
}: {
  onNavigate?: (screen: Screen) => void;
}) {
  return (
    <nav
      className="absolute"
      style={{
        left: DASHBOARD_POS.nav.side,
        right: DASHBOARD_POS.nav.side,
        bottom: DASHBOARD_POS.nav.bottom,
        height: DASHBOARD_POS.nav.height,
      }}
    >
      <div
        className="grid h-full grid-cols-3"
        style={{ gap: DASHBOARD_POS.nav.gap }}
      >
        <div
          className="h-full"
          style={{
            transform: getOffsetTransform(
              DASHBOARD_POS.nav.leftOffsetX,
              DASHBOARD_POS.nav.leftOffsetY,
            ),
          }}
        >
          <BottomNavItem
            highlight={LeftHighlightButton}
            id="report"
            icon={ReportIcon}
            label="Report"
            onClick={() => onNavigate?.("daily-log")}
          />
        </div>
        <div
          className="h-full"
          style={{
            transform: getOffsetTransform(
              DASHBOARD_POS.nav.centerOffsetX,
              DASHBOARD_POS.nav.centerOffsetY,
            ),
          }}
        >
          <BottomNavItem
            active
            highlight={CenterHighlightButton}
            id="dashboard"
            icon={OwlIcon}
            label="Dashboard"
            onClick={() => onNavigate?.("dashboard")}
          />
        </div>
        <div
          className="h-full"
          style={{
            transform: getOffsetTransform(
              DASHBOARD_POS.nav.rightOffsetX,
              DASHBOARD_POS.nav.rightOffsetY,
            ),
          }}
        >
          <BottomNavItem
            highlight={RightHighlightButton}
            id="configuration"
            icon={ConfigurationIcon}
            label="Configuration"
            onClick={() => onNavigate?.("configuration")}
          />
        </div>
      </div>
    </nav>
  );
}

function BottomNavItem({
  active = false,
  highlight,
  id,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  highlight: StaticImageData;
  id: NavItemId;
  icon: StaticImageData;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className="dashboard-gold-label relative flex h-full min-w-0 flex-col items-center justify-center gap-1 overflow-visible px-1"
      onClick={onClick}
      type="button"
    >
      {active ? (
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: DASHBOARD_POS.nav.selectedCoverRadius,
            clipPath: `inset(0 round ${DASHBOARD_POS.nav.selectedCoverRadius}px)`,
            overflow: "hidden",
            transform: `translate(${DASHBOARD_POS.nav.selectedCoverOffsetX}px, ${DASHBOARD_POS.nav.selectedCoverOffsetY}px) scaleX(${DASHBOARD_POS.nav.selectedCoverScaleX}) scaleY(${DASHBOARD_POS.nav.selectedCoverScaleY})`,
          }}
        >
          <Image
            alt=""
            className="rounded-[inherit] object-fill"
            fill
            sizes="100px"
            src={highlight}
          />
        </span>
      ) : null}
      <span
        className="relative h-8 w-8"
        style={{
          transform: getOffsetScaleTransform(
            getNavIconOffsetX(id),
            getNavIconOffsetY(id),
            getNavIconScale(id),
          ),
        }}
      >
        <Image alt="" className="object-contain" fill sizes="32px" src={icon} />
      </span>
      <span
        className={`relative w-full overflow-visible whitespace-nowrap text-center text-[10px] font-semibold leading-[1.15] ${
          active ? "dashboard-nav-active-text" : "dashboard-gold-label"
        }`}
        style={{
          transform: getOffsetScaleTransform(
            getNavLabelOffsetX(id),
            getNavLabelOffsetY(id),
            getNavLabelScale(id),
          ),
        }}
      >
        {label}
      </span>
    </button>
  );
}

function getHeroSupportSentence({
  amountAhead,
  gapToGoal,
  monthsRemaining,
  neededMonthlyAverage,
  projectedTakeHome,
  yearlyNetGoal,
}: {
  amountAhead: number | undefined;
  gapToGoal: number | undefined;
  monthsRemaining: number;
  neededMonthlyAverage: number;
  projectedTakeHome: number | undefined;
  yearlyNetGoal: number;
}) {
  if (projectedTakeHome === undefined) {
    return "Projection starts after your first logged income.";
  }

  if (yearlyNetGoal <= 0) {
    return "Add a yearly net goal to compare this projection.";
  }

  if (gapToGoal && gapToGoal > 0) {
    return `    To hit your goal add ${formatCurrency(neededMonthlyAverage)} net per month for the next ${monthsRemaining} months`;
  }

  return `Ahead by ${formatCurrency(amountAhead ?? 0)}\nKeep the pace steady`;
}

function getCurrentWeekInvoicedIncome(entries: DailyEntry[], now: Date) {
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  return entries.reduce((total, entry) => {
    const entryDate = new Date(`${entry.date}T00:00:00`);

    if (entryDate >= weekStart && entryDate < weekEnd) {
      return total + entry.invoicedIncome;
    }

    return total;
  }, 0);
}

function getGreeting(now: Date, displayName?: string) {
  const hour = now.getHours();
  const suffix = displayName?.trim() ? `, ${displayName.trim()}` : "";

  if (hour < 12) {
    return `Good morning${suffix}`;
  }

  if (hour < 18) {
    return `Good afternoon${suffix}`;
  }

  return `Good evening${suffix}`;
}

function getProgressStatusClassName(kind: ProgressStatusKind) {
  if (kind === "waiting") {
    return "dashboard-status-waiting";
  }

  if (kind === "setGoal") {
    return "dashboard-status-set-goal";
  }

  if (kind === "close") {
    return "dashboard-status-close";
  }

  if (kind === "behind") {
    return "dashboard-status-behind";
  }

  return "dashboard-status-good";
}

function getTargetStatus(projectedTakeHome: number | undefined, goal: number) {
  if (projectedTakeHome === undefined) {
    return {
      kind: "waiting" as const,
      label: "Waiting",
    };
  }

  if (goal <= 0) {
    return {
      kind: "setGoal" as const,
      label: "Set goal",
    };
  }

  const ratio = projectedTakeHome / goal;

  if (ratio >= 1) {
    return {
      kind: "onTrack" as const,
      label: "On track",
    };
  }

  if (ratio >= 0.9) {
    return {
      kind: "close" as const,
      label: "Close",
    };
  }

  return {
    kind: "behind" as const,
    label: "Behind",
  };
}
