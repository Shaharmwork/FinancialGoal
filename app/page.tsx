"use client";

import { getSettingsForYear, isAutomaticHoliday } from "@/lib/year-settings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Configuration as ConfigurationScreen,
  type ConfigurationNavigationHandlers,
  type ConfigurationSaveResult,
} from "@/components/configuration";
import {
  DailyLog,
  type DailyLogNavigationHandlers,
} from "@/components/daily-log";
import { Dashboard } from "@/components/dashboard";
import { LoginForm, PasswordResetForm } from "@/components/login-form";
import { Onboarding } from "@/components/onboarding";
import { authErrorMessage } from "@/lib/registration";
import { PhoneStage } from "@/components/phone-stage";
import { Toast } from "@/components/ui/kit";
import { WarningModal } from "@/components/warning-modal";
import {
  deleteDailyEntryRemote,
  deleteMonthlySummaryRemote,
  loadRemoteAppData,
  saveDailyEntryRemote,
  saveMonthlySummaryRemote,
  saveSettingsRemote,
} from "@/lib/app-data-store";
import { sortMonthlySummaries, toDateKey } from "@/lib/calculations";
import {
  applyReportOverlay,
  diffMonthlySummaries,
  diffReportOverlay,
  EMPTY_REPORT_OVERLAY,
  fingerprintOf,
  isReportOverlayEmpty,
  isSameSettingsContent,
  mergeListIntoOverlay,
  MutationIds,
  pruneReportOverlay,
  runMutations,
  type ConflictReason,
  type EntryMutation,
  type MutationOutcome,
  type ReportOverlay,
} from "@/lib/sync";
import { starterStoredState } from "@/lib/default-state";
import {
  clearStoredUiPreferences,
  clearUserReportDayFormDrafts,
  clearUserReportOverlay,
  getUserCurrentScreen,
  getUserReportOverlay,
  updateUserCurrentScreen,
  updateUserReportOverlay,
} from "@/lib/ui-preferences";
import {
  getCurrentSession,
  hasSupabaseConfig,
  onSupabaseAuthStateChange,
  signInWithEmailPassword,
  signOutFromSupabase,
} from "@/lib/supabase";
import type { DailyEntry, MonthlySummary, Screen, Settings } from "@/lib/types";

type DeletedReport = {
  token: string;
  userId: string;
  entry: DailyEntry;
  savedEntry?: DailyEntry;
};

const CONFIG_SCREEN_INTENT_KEY = "configuration-screen-intent";
const CONFIG_SCREEN_FOCUS_TARGET_KEY = "configuration-screen-focus-target";
const CONFIG_SCREEN_TARGET_MONTH_KEY = "configuration-screen-target-month";
const DASHBOARD_ALERT_LOGIN_SESSION_KEY = "dashboard-alert-login-session";

function createDashboardAlertLoginSessionId() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDashboardAlertLoginSessionKey(userId: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  const storedValue = window.sessionStorage.getItem(
    DASHBOARD_ALERT_LOGIN_SESSION_KEY,
  );

  if (storedValue) {
    try {
      const parsedValue = JSON.parse(storedValue) as {
        id?: string;
        userId?: string;
      };

      if (parsedValue.userId === userId && parsedValue.id) {
        return `${userId}:${parsedValue.id}`;
      }
    } catch {
      // Replace malformed session metadata below.
    }
  }

  const nextValue = {
    id: createDashboardAlertLoginSessionId(),
    userId,
  };

  window.sessionStorage.setItem(
    DASHBOARD_ALERT_LOGIN_SESSION_KEY,
    JSON.stringify(nextValue),
  );

  return `${userId}:${nextValue.id}`;
}

function clearDashboardAlertLoginSessionKey() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(DASHBOARD_ALERT_LOGIN_SESSION_KEY);
}

function clearBrowserSessionState() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(CONFIG_SCREEN_INTENT_KEY);
    window.sessionStorage.removeItem(CONFIG_SCREEN_FOCUS_TARGET_KEY);
    window.sessionStorage.removeItem(CONFIG_SCREEN_TARGET_MONTH_KEY);
  }

  clearDashboardAlertLoginSessionKey();
  clearStoredUiPreferences();
}

function keepSessionForSameUser(
  previousSession: Session | null,
  nextSession: Session | null,
) {
  if (
    previousSession &&
    nextSession &&
    previousSession.user.id === nextSession.user.id
  ) {
    return previousSession;
  }

  return nextSession;
}

type ReportConflict = {
  date: string;
  reason: ConflictReason;
};

function hasFutureDatedEntries(entries: DailyEntry[], todayDateKey: string) {
  return entries.some((entry) => !isAutomaticHoliday(entry) && entry.date > todayDateKey);
}

function getNewSummaryConflictMonthKeys(
  savedEntries: DailyEntry[],
  nextEntries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
) {
  const summaryMonthKeys = new Set(
    monthlySummaries
      .filter((summary) => summary.monthType === "business")
      .map((summary) => summary.monthKey),
  );
  const savedEntryMonthKeys = new Set(
    savedEntries.filter((entry) => !isAutomaticHoliday(entry)).map((entry) => entry.date.slice(0, 7)),
  );
  const nextEntryMonthKeys = new Set(
    nextEntries.filter((entry) => !isAutomaticHoliday(entry)).map((entry) => entry.date.slice(0, 7)),
  );

  return [...summaryMonthKeys].filter(
    (monthKey) =>
      nextEntryMonthKeys.has(monthKey) && !savedEntryMonthKeys.has(monthKey),
  );
}

function getEmploymentSummaryConflictMonthKeys(
  nextEntries: DailyEntry[],
  monthlySummaries: MonthlySummary[],
) {
  const employmentMonthKeys = new Set(
    monthlySummaries
      .filter((summary) => summary.monthType === "employment")
      .map((summary) => summary.monthKey),
  );
  const nextEntryMonthKeys = new Set(
    nextEntries.filter((entry) => !isAutomaticHoliday(entry)).map((entry) => entry.date.slice(0, 7)),
  );

  return [...employmentMonthKeys].filter((monthKey) =>
    nextEntryMonthKeys.has(monthKey),
  );
}

export default function Home() {
  // Local date: toISOString() is UTC and lags a day between midnight and 02:00 in NL.
  const todayDateKey = toDateKey(new Date());
  const [currentScreen, setCurrentScreen] = useState<Screen>(
    starterStoredState.currentScreen,
  );
  // Saved data, exactly as last loaded from or confirmed by Supabase.
  const [entries, setEntries] = useState<DailyEntry[]>(
    starterStoredState.entries,
  );
  // Unsaved report changes: edited days and explicit deletions only.
  const [reportOverlay, setReportOverlay] =
    useState<ReportOverlay>(EMPTY_REPORT_OVERLAY);
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>(
    starterStoredState.monthlySummaries,
  );
  const [settings, setSettings] = useState<Settings>(
    starterStoredState.settings,
  );
  const [hasCheckedSession, setHasCheckedSession] = useState(false);
  const [hasLoadedRemoteState, setHasLoadedRemoteState] = useState(false);
  const [loadedRemoteUserId, setLoadedRemoteUserId] = useState<string | null>(
    null,
  );
  // Set when the initial load failed. Nothing can be written until a load succeeds.
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const [settingsFocusRequest, setSettingsFocusRequest] = useState(0);
  const [backfillFocusRequest, setBackfillFocusRequest] = useState(0);
  const [reportResetRequest, setReportResetRequest] = useState(0);
  const [fillMissingDaysRequest, setFillMissingDaysRequest] = useState(0);
  const [fillMissingDayTargetDateKey, setFillMissingDayTargetDateKey] =
    useState<string | undefined>(undefined);
  const [
    isReportsAlertDismissedForSession,
    setIsReportsAlertDismissedForSession,
  ] = useState(false);
  const [shouldShowDashboardGreeting, setShouldShowDashboardGreeting] =
    useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [dashboardAlertPulseSessionKey, setDashboardAlertPulseSessionKey] =
    useState<string | undefined>(undefined);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [authLinkError, setAuthLinkError] = useState("");

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false);
  const [isUnsavedReportModalOpen, setIsUnsavedReportModalOpen] =
    useState(false);
  const [isUnsavedConfigurationModalOpen, setIsUnsavedConfigurationModalOpen] =
    useState(false);
  const [isSummaryConflictWarningOpen, setIsSummaryConflictWarningOpen] =
    useState(false);
  const [isEmploymentMonthWarningOpen, setIsEmploymentMonthWarningOpen] =
    useState(false);
  const [isFutureReportWarningOpen, setIsFutureReportWarningOpen] =
    useState(false);
  const [
    pendingSummaryConflictSaveEntries,
    setPendingSummaryConflictSaveEntries,
  ] = useState<DailyEntry[] | null>(null);
  const [pendingFutureSaveEntries, setPendingFutureSaveEntries] = useState<
    DailyEntry[] | null
  >(null);
  const [pendingScreen, setPendingScreen] = useState<Screen | null>(null);
  const [toastErrorMessage, setToastErrorMessage] = useState("");
  const [toastSuccessMessage, setToastSuccessMessage] = useState("");
  const [deletedReports, setDeletedReports] = useState<DeletedReport[]>([]);
  const [undoError, setUndoError] = useState("");
  const sessionUserIdRef = useRef(session?.user.id);
  useEffect(() => {
    sessionUserIdRef.current = session?.user.id;
    setDeletedReports([]);
    setUndoError("");
  }, [session?.user.id]);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [reportConflict, setReportConflict] = useState<ReportConflict | null>(
    null,
  );
  const [hasHydratedReportOverlay, setHasHydratedReportOverlay] =
    useState(false);
  const [hasUnsavedReportFieldDrafts, setHasUnsavedReportFieldDrafts] =
    useState(false);
  const [hasUnsavedConfigurationChanges, setHasUnsavedConfigurationChanges] =
    useState(false);
  const configurationNavigationHandlersRef =
    useRef<ConfigurationNavigationHandlers | null>(null);
  const dailyLogNavigationHandlersRef =
    useRef<DailyLogNavigationHandlers | null>(null);
  const entriesRef = useRef(entries);
  const reportOverlayRef = useRef(reportOverlay);
  const monthlySummariesRef = useRef(monthlySummaries);
  const settingsRef = useRef(settings);
  // One save at a time, so saves can't overlap or finish out of order.
  const saveLockRef = useRef(false);
  const mutationIdsRef = useRef(new MutationIds());
  const lastRefreshAtRef = useRef(0);
  const reportEntries = useMemo(
    () => applyReportOverlay(entries, reportOverlay),
    [entries, reportOverlay],
  );
  const hasUnsavedReportEntryChanges = !isReportOverlayEmpty(
    pruneReportOverlay(entries, reportOverlay),
  );
  const hasUnsavedReportChanges =
    hasUnsavedReportEntryChanges || hasUnsavedReportFieldDrafts;
  const hasAnyUnsavedChanges =
    hasUnsavedReportChanges || hasUnsavedConfigurationChanges;

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    reportOverlayRef.current = reportOverlay;
  }, [reportOverlay]);

  useEffect(() => {
    monthlySummariesRef.current = monthlySummaries;
  }, [monthlySummaries]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let isActive = true;
    let hasResolvedSession = false;
    const callbackUrl = new URL(window.location.href);
    const hash = new URLSearchParams(callbackUrl.hash.slice(1));
    if (hash.has("error") || callbackUrl.searchParams.has("error")) {
      setAuthLinkError("This email link has expired or is invalid. Try signing in to continue email confirmation, or choose Forgot password for a new reset link.");
      callbackUrl.hash = "";
      ["error", "error_code", "error_description"].forEach(key => callbackUrl.searchParams.delete(key));
      window.history.replaceState(null, "", callbackUrl.pathname + callbackUrl.search);
    }


    if (!hasSupabaseConfig()) {
      setHasCheckedSession(true);
      return () => {
        isActive = false;
      };
    }

    const fallbackTimer = window.setTimeout(() => {
      if (!isActive || hasResolvedSession) {
        return;
      }

      console.warn(
        "[Financial Goal] Session check timed out. Falling back to logged-out state.",
      );
      setSession(null);
      setToastErrorMessage(
        "Session error. Could not restore your session. Try signing in again.",
      );
      setHasCheckedSession(true);
    }, 2500);

    void getCurrentSession()
      .then((currentSession) => {
        if (!isActive) {
          return;
        }

        hasResolvedSession = true;
        window.clearTimeout(fallbackTimer);
        try {
          if (currentSession && sessionStorage.getItem("financial-goal-password-recovery") === currentSession.user.id) setIsPasswordRecovery(true);
        } catch { /* session storage is optional */ }
        setSession((previousSession) =>
          keepSessionForSameUser(previousSession, currentSession),
        );
        setHasCheckedSession(true);
      })
      .catch((error) => {
        console.error("[Financial Goal] Failed to load auth session.", error);
        if (!isActive) {
          return;
        }

        hasResolvedSession = true;
        window.clearTimeout(fallbackTimer);
        setSession(null);
        setToastErrorMessage(
          "Session error. Could not restore your session. Try signing in again.",
        );
        setHasCheckedSession(true);
      });

    const unsubscribe = onSupabaseAuthStateChange((event, nextSession) => {
      if (!isActive) {
        return;
      }

      hasResolvedSession = true;
      window.clearTimeout(fallbackTimer);
      if (event === "PASSWORD_RECOVERY" && nextSession) {
        setIsPasswordRecovery(true);
        try { sessionStorage.setItem("financial-goal-password-recovery", nextSession.user.id); } catch { /* optional */ }
      }
      if (!nextSession) setIsPasswordRecovery(false);
      // Supabase re-emits SIGNED_IN / TOKEN_REFRESHED when the tab regains
      // focus. Keep the same session object for the same user so the data
      // reload effects don't re-run and reset the screen (and its scroll).
      setSession((previousSession) =>
        keepSessionForSameUser(previousSession, nextSession),
      );
      setToastErrorMessage("");
      setHasCheckedSession(true);
    });

    return () => {
      isActive = false;
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasCheckedSession || !session) {
      setHasLoadedRemoteState(false);
      setLoadedRemoteUserId(null);
      setDisplayName(undefined);
      setLoadErrorMessage("");
      return;
    }

    let isActive = true;
    const userId = session.user.id;
    setHasLoadedRemoteState(false);
    setLoadedRemoteUserId(null);
    setLoadErrorMessage("");

    void loadRemoteAppData()
      .then((remoteData) => {
        if (!isActive) {
          return;
        }

        const storedOverlay = getUserReportOverlay(userId);
        setEntries(remoteData.entries);
        setReportOverlay(
          storedOverlay
            ? pruneReportOverlay(remoteData.entries, storedOverlay)
            : EMPTY_REPORT_OVERLAY,
        );
        setHasHydratedReportOverlay(true);
        setMonthlySummaries(remoteData.monthlySummaries);
        setSettings(remoteData.settings);
        setNeedsOnboarding(remoteData.isNewUser);
        setDisplayName(remoteData.displayName?.trim() || (typeof session.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name.trim() || undefined : undefined));
        setIsReportsAlertDismissedForSession(false);
        setLoadedRemoteUserId(userId);
        setHasLoadedRemoteState(true);
        lastRefreshAtRef.current = Date.now();
      })
      .catch((error) => {
        console.error("[Financial Goal] Failed to load Supabase data.", error);
        if (!isActive) {
          return;
        }

        // Stay "not loaded": the screens (and every save) stay disabled until a
        // load succeeds, so an empty screen can never be saved over real data.
        setLoadErrorMessage(
          getErrorMessage(error, "Your data couldn't be loaded."),
        );
      });

    return () => {
      isActive = false;
    };
  }, [hasCheckedSession, loadAttempt, session]);

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId) {
      if (!hasCheckedSession) {
        return;
      }

      clearBrowserSessionState();
      setDashboardAlertPulseSessionKey(undefined);
      setIsReportsAlertDismissedForSession(false);
      setShouldShowDashboardGreeting(false);
      setCurrentScreen("dashboard");
      setEntries(starterStoredState.entries);
      setReportOverlay(EMPTY_REPORT_OVERLAY);
      setMonthlySummaries(starterStoredState.monthlySummaries);
      setSettings(starterStoredState.settings);
      setDisplayName(undefined);
      setNeedsOnboarding(false);
      setHasLoadedRemoteState(false);
      setHasHydratedReportOverlay(false);
      setHasUnsavedReportFieldDrafts(false);
      setHasUnsavedConfigurationChanges(false);
      setLoadedRemoteUserId(null);
      setFillMissingDayTargetDateKey(undefined);
      setPendingScreen(null);
      setPendingSummaryConflictSaveEntries(null);
      setPendingFutureSaveEntries(null);
      setReportConflict(null);
      setIsUnsavedReportModalOpen(false);
      setIsUnsavedConfigurationModalOpen(false);
      setIsSummaryConflictWarningOpen(false);
      setIsEmploymentMonthWarningOpen(false);
      setIsFutureReportWarningOpen(false);
      return;
    }

    setDashboardAlertPulseSessionKey(getDashboardAlertLoginSessionKey(userId));
    setIsReportsAlertDismissedForSession(false);
    setShouldShowDashboardGreeting(true);

    const restoredScreen = getUserCurrentScreen(userId) ?? "dashboard";
    setCurrentScreen(restoredScreen);
    updateUserCurrentScreen(userId, restoredScreen);
  }, [hasCheckedSession, session]);

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId) {
      return;
    }

    updateUserCurrentScreen(userId, currentScreen);
  }, [currentScreen, session]);

  // Keep unsaved report changes on this device until they're saved or discarded.
  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId || !hasLoadedRemoteState || !hasHydratedReportOverlay) {
      return;
    }

    const pendingOverlay = pruneReportOverlay(entries, reportOverlay);

    if (isReportOverlayEmpty(pendingOverlay)) {
      clearUserReportOverlay(userId);
      return;
    }

    updateUserReportOverlay(userId, pendingOverlay);
  }, [entries, hasHydratedReportOverlay, hasLoadedRemoteState, reportOverlay, session]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [currentScreen]);

  const showSuccess = useCallback((message: string) => {
    setToastErrorMessage("");
    setToastSuccessMessage(message);
  }, []);

  const showError = useCallback((message: string) => {
    setToastSuccessMessage("");
    setToastErrorMessage(message);
  }, []);

  // Reload everything from Supabase. Unsaved changes are untouched: report edits
  // live in the overlay and configuration drafts are rebased by that screen.
  const refreshRemoteData = useCallback(async () => {
    const remoteData = await loadRemoteAppData();
    setEntries(remoteData.entries);
    setReportOverlay((currentOverlay) =>
      pruneReportOverlay(remoteData.entries, currentOverlay),
    );
    setMonthlySummaries(remoteData.monthlySummaries);
    setSettings(remoteData.settings);
    entriesRef.current = remoteData.entries;
    monthlySummariesRef.current = remoteData.monthlySummaries;
    settingsRef.current = remoteData.settings;
    lastRefreshAtRef.current = Date.now();
    return remoteData;
  }, []);

  // Pick up changes from other devices when coming back to the app, but only
  // when there's nothing unsaved here.
  useEffect(() => {
    if (!hasLoadedRemoteState) {
      return;
    }

    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        saveLockRef.current ||
        hasAnyUnsavedChanges ||
        Date.now() - lastRefreshAtRef.current < 30_000
      ) {
        return;
      }

      void refreshRemoteData().catch((error) => {
        console.warn("[Financial Goal] Background refresh failed.", error);
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasAnyUnsavedChanges, hasLoadedRemoteState, refreshRemoteData]);

  const performEntryMutation = useCallback(
    async (mutation: EntryMutation): Promise<MutationOutcome<DailyEntry>> => {
      const fingerprint = fingerprintOf(mutation);
      const mutationId = mutationIdsRef.current.idFor(fingerprint);
      const outcome =
        mutation.kind === "save"
          ? await saveDailyEntryRemote(
              mutation.entry,
              mutation.expectedUpdatedAt,
              mutationId,
            )
          : await deleteDailyEntryRemote(mutation.id, mutation.expectedUpdatedAt);

      if (outcome.status !== "conflict") {
        mutationIdsRef.current.forget(fingerprint);
      }

      return outcome;
    },
    [],
  );

  // Saves the given report changes. Only after Supabase confirms each change is it
  // treated as saved; anything not confirmed stays in the overlay for a retry.
  const persistReportOverlay = useCallback(
    async (overlayToSave: ReportOverlay): Promise<boolean> => {
      if (saveLockRef.current) {
        return false;
      }

      saveLockRef.current = true;
      setIsSavingReport(true);

      try {
        const mutations = diffReportOverlay(entriesRef.current, overlayToSave);
        const run = await runMutations(mutations, performEntryMutation);
        let nextEntries = entriesRef.current;

        run.applied.forEach(({ mutation, outcome }) => {
          nextEntries = nextEntries.filter((entry) => entry.date !== mutation.key);

          if (outcome.status === "saved") {
            nextEntries = [outcome.value, ...nextEntries];
          }
        });

        entriesRef.current = nextEntries;
        setEntries(nextEntries);
        // Prune the current overlay (not just what was sent): edits made elsewhere,
        // or while this save ran, must survive.
        const remainingOverlay = pruneReportOverlay(
          nextEntries,
          reportOverlayRef.current,
        );
        reportOverlayRef.current = remainingOverlay;
        setReportOverlay(remainingOverlay);

        if (run.status === "done") {
          return true;
        }

        if (run.status === "conflict" && run.conflict) {
          setReportConflict({
            date: run.conflict.mutation.key,
            reason: run.conflict.reason,
          });
          return false;
        }

        showError(
          `${getErrorMessage(run.error, "Saving failed.")} Your changes are kept on this device. Tap Save to try again.`,
        );
        return false;
      } finally {
        saveLockRef.current = false;
        setIsSavingReport(false);
      }
    },
    [performEntryMutation, showError],
  );

  const persistReportEntriesList = useCallback(
    async (entriesToSave: DailyEntry[]) => {
      const nextOverlay = mergeListIntoOverlay(
        entriesRef.current,
        reportOverlayRef.current,
        entriesToSave,
      );
      reportOverlayRef.current = nextOverlay;
      setReportOverlay(nextOverlay);
      return persistReportOverlay(nextOverlay);
    },
    [persistReportOverlay],
  );

  const finishReportSave = useCallback(() => {
    dailyLogNavigationHandlersRef.current?.markSaved();
    setHasUnsavedReportFieldDrafts(false);
    showSuccess("Reports saved.");
  }, [showSuccess]);

  const handleUpsertEntry = useCallback((entry: DailyEntry) => {
    setReportOverlay((currentOverlay) =>
      mergeListIntoOverlay(entriesRef.current, currentOverlay, [entry]),
    );
  }, []);

  const handleRemoveEntryForDate = useCallback((dateKey: string) => {
    setReportOverlay((currentOverlay) => {
      const savedEntry = entriesRef.current.find(
        (entry) => entry.date === dateKey,
      );
      const baseEntry = currentOverlay.entries[dateKey] ?? savedEntry;
      const { [dateKey]: _removedEntry, ...remainingEntries } =
        currentOverlay.entries;
      const deletions = { ...currentOverlay.deletions };

      if (savedEntry?.updatedAt) {
        deletions[dateKey] = {
          id: savedEntry.id,
          updatedAt: baseEntry?.updatedAt ?? savedEntry.updatedAt,
        };
      }

      return pruneReportOverlay(entriesRef.current, {
        entries: remainingEntries,
        deletions,
      });
    });
  }, []);

  // Keep each deleted report until Undo or dismissal, independently of navigation.
  const handleDeleteEntryImmediately = useCallback(
    async (entry: DailyEntry) => {
      if (saveLockRef.current || !session?.user.id) return false;
      const userId = session.user.id;
      const dateKey = entry.date;
      const savedEntry = entriesRef.current.find((item) => item.date === dateKey);
      const snapshot: DeletedReport = structuredClone({
        token: crypto.randomUUID(), userId, entry, savedEntry,
      });
      if (savedEntry?.updatedAt) {
        const baseVersion =
          reportOverlayRef.current.entries[dateKey]?.updatedAt ?? savedEntry.updatedAt;
        const wasDeleted = await persistReportOverlay({
          entries: {},
          deletions: { [dateKey]: { id: savedEntry.id, updatedAt: baseVersion } },
        });
        if (!wasDeleted || sessionUserIdRef.current !== userId) return false;
      }
      const currentOverlay = reportOverlayRef.current;
      const { [dateKey]: _entry, ...remainingEntries } = currentOverlay.entries;
      const { [dateKey]: _deletion, ...remainingDeletions } = currentOverlay.deletions;
      const nextOverlay = { entries: remainingEntries, deletions: remainingDeletions };
      reportOverlayRef.current = nextOverlay;
      setReportOverlay(nextOverlay);
      setToastSuccessMessage("");
      setUndoError("");
      setDeletedReports((current) => [snapshot, ...current]);
      return true;
    },
    [persistReportOverlay, session?.user.id],
  );

  const handleUndoDeletedReport = async () => {
    const deleted = deletedReports[0];
    if (!deleted || saveLockRef.current || deleted.userId !== session?.user.id) return;
    const dateKey = deleted.entry.date;
    // A new local report must not be replaced by an older deleted version.
    if (entriesRef.current.some((entry) => entry.date === dateKey) ||
        reportOverlayRef.current.entries[dateKey]) {
      setUndoError("A report now exists for this date. Undo has not replaced it.");
      return;
    }

    saveLockRef.current = true;
    setIsSavingReport(true);
    setUndoError("");
    try {
      let restored: DailyEntry | undefined;
      if (deleted.savedEntry) {
        // Insert-only: another device may have recreated this day since deletion.
        // The retained token makes a retry safe if the save response is lost.
        const outcome = await saveDailyEntryRemote(
          deleted.savedEntry, null, deleted.token,
        );
        if (sessionUserIdRef.current !== deleted.userId) return;
        if (outcome.status !== "saved") {
          setUndoError("This date changed on another device. Undo has not overwritten it.");
          return;
        }
        restored = outcome.value;
        const nextEntries = [restored, ...entriesRef.current];
        entriesRef.current = nextEntries;
        setEntries(nextEntries);
      }
      // Restore any unsaved edits as a draft, preserving all other dates.
      const currentOverlay = reportOverlayRef.current;
      const nextOverlay = pruneReportOverlay(entriesRef.current, {
        entries: {
          ...currentOverlay.entries,
          [dateKey]: { ...deleted.entry, updatedAt: restored?.updatedAt },
        },
        deletions: currentOverlay.deletions,
      });
      reportOverlayRef.current = nextOverlay;
      setReportOverlay(nextOverlay);
      setDeletedReports((current) => current.filter((item) => item.token !== deleted.token));
      showSuccess(deleted.savedEntry ? "Report restored." : "Draft report restored. Save to keep it.");
    } catch (error) {
      if (sessionUserIdRef.current === deleted.userId) {
        setUndoError(getErrorMessage(error, "Could not restore the report. Try Undo again."));
      }
    } finally {
      saveLockRef.current = false;
      setIsSavingReport(false);
    }
  };

  const proceedToScreen = (screen: Screen) => {
    if (screen === "daily-log") {
      setReportResetRequest((currentValue) => currentValue + 1);
    }

    setCurrentScreen(screen);
  };

  const saveReportAfterChecks = async (entriesToSave: DailyEntry[]) => {
    if (hasFutureDatedEntries(entriesToSave, todayDateKey)) {
      setPendingFutureSaveEntries(entriesToSave);
      setIsFutureReportWarningOpen(true);
      return false;
    }

    const wasSaved = await persistReportEntriesList(entriesToSave);

    if (wasSaved) {
      finishReportSave();
    }

    return wasSaved;
  };

  // Called by the Report screen with its full list of days (including unsaved
  // field edits). Resolves true once Supabase confirmed every change.
  const handleSaveReportEntries = async (nextEntries?: DailyEntry[]) => {
    const entriesToSave = nextEntries ?? reportEntries;

    if (
      getEmploymentSummaryConflictMonthKeys(entriesToSave, monthlySummaries)
        .length > 0
    ) {
      setIsEmploymentMonthWarningOpen(true);
      return false;
    }

    if (
      getNewSummaryConflictMonthKeys(entries, entriesToSave, monthlySummaries)
        .length > 0
    ) {
      setPendingSummaryConflictSaveEntries(entriesToSave);
      setIsSummaryConflictWarningOpen(true);
      return false;
    }

    return saveReportAfterChecks(entriesToSave);
  };

  const handleDiscardReportEntries = () => {
    setReportOverlay(EMPTY_REPORT_OVERLAY);
    setHasUnsavedReportFieldDrafts(false);
    const userId = session?.user?.id;

    if (userId) {
      clearUserReportDayFormDrafts(userId);
      clearUserReportOverlay(userId);
    }
  };

  // Conflict choice: drop my change for that day and show the other device's version.
  const handleUseOtherReportVersion = async () => {
    const conflict = reportConflict;

    if (!conflict) {
      return;
    }

    try {
      await refreshRemoteData();
      setReportOverlay((currentOverlay) => {
        const { [conflict.date]: _entry, ...entriesWithout } =
          currentOverlay.entries;
        const { [conflict.date]: _deletion, ...deletionsWithout } =
          currentOverlay.deletions;
        return { entries: entriesWithout, deletions: deletionsWithout };
      });
      dailyLogNavigationHandlersRef.current?.discardDraftForDate(conflict.date);
      setReportConflict(null);
      showSuccess("Loaded the latest version of that day.");
    } catch (error) {
      showError(getErrorMessage(error, "Couldn't load the latest version."));
    }
  };

  // Conflict choice (explicit): replace the other device's version with mine.
  const handleOverwriteReportVersion = async () => {
    const conflict = reportConflict;

    if (!conflict) {
      return;
    }

    try {
      const remoteData = await refreshRemoteData();
      const remoteEntry = remoteData.entries.find(
        (entry) => entry.date === conflict.date,
      );
      const currentOverlay = reportOverlayRef.current;
      const myEntry = currentOverlay.entries[conflict.date];
      const nextOverlay: ReportOverlay = {
        entries: { ...currentOverlay.entries },
        deletions: { ...currentOverlay.deletions },
      };

      if (myEntry) {
        nextOverlay.entries[conflict.date] = remoteEntry?.updatedAt
          ? { ...myEntry, id: remoteEntry.id, updatedAt: remoteEntry.updatedAt }
          : { ...myEntry, updatedAt: undefined };
      }

      if (currentOverlay.deletions[conflict.date]) {
        if (remoteEntry?.updatedAt) {
          nextOverlay.deletions[conflict.date] = {
            id: remoteEntry.id,
            updatedAt: remoteEntry.updatedAt,
          };
        } else {
          delete nextOverlay.deletions[conflict.date];
        }
      }

      setReportConflict(null);
      reportOverlayRef.current = nextOverlay;
      setReportOverlay(nextOverlay);

      if (await persistReportOverlay(nextOverlay)) {
        finishReportSave();
      }
    } catch (error) {
      showError(getErrorMessage(error, "Couldn't overwrite. Nothing was changed."));
    }
  };

  const handleRegisterConfigurationNavigationHandlers = useCallback(
    (handlers: ConfigurationNavigationHandlers | null) => {
      configurationNavigationHandlersRef.current = handlers;
    },
    [],
  );

  const handleRegisterDailyLogNavigationHandlers = useCallback(
    (handlers: DailyLogNavigationHandlers | null) => {
      dailyLogNavigationHandlersRef.current = handlers;
    },
    [],
  );

  const handleScreenChange = (screen: Screen) => {
    if (screen === currentScreen) {
      return;
    }

    if (
      currentScreen === "daily-log" &&
      screen !== "daily-log" &&
      hasUnsavedReportChanges
    ) {
      setPendingScreen(screen);
      setIsUnsavedReportModalOpen(true);
      return;
    }

    if (
      currentScreen === "configuration" &&
      screen !== "configuration" &&
      hasUnsavedConfigurationChanges
    ) {
      setPendingScreen(screen);
      setIsUnsavedConfigurationModalOpen(true);
      return;
    }

    proceedToScreen(screen);
  };

  const handleOpenConfigurationSetup = useCallback(() => {
    setSettingsFocusRequest((currentValue) => currentValue + 1);
    setCurrentScreen("configuration");
  }, []);

  const handleAddPreviousMonths = useCallback((monthKey?: string) => {
    window.sessionStorage.setItem(CONFIG_SCREEN_INTENT_KEY, "update-history");
    window.sessionStorage.setItem(CONFIG_SCREEN_FOCUS_TARGET_KEY, "add-month");
    if (monthKey) window.sessionStorage.setItem(CONFIG_SCREEN_TARGET_MONTH_KEY, monthKey);
    else window.sessionStorage.removeItem(CONFIG_SCREEN_TARGET_MONTH_KEY);
    setBackfillFocusRequest((currentValue) => currentValue + 1);
    setCurrentScreen("configuration");
  }, []);

  const handleFillMissingDays = useCallback((targetDateKey?: string) => {
    setFillMissingDayTargetDateKey(targetDateKey);
    setFillMissingDaysRequest((currentValue) => currentValue + 1);
    setCurrentScreen("daily-log");
  }, []);

  const handleBackfillMissingMonth = useCallback((monthKey: string) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(CONFIG_SCREEN_INTENT_KEY, "update-history");
      window.sessionStorage.setItem(
        CONFIG_SCREEN_FOCUS_TARGET_KEY,
        "add-month",
      );
      window.sessionStorage.setItem(CONFIG_SCREEN_TARGET_MONTH_KEY, monthKey);
    }

    setBackfillFocusRequest((currentValue) => currentValue + 1);
    setCurrentScreen("configuration");
  }, []);

  const handleDismissCurrentMonthReminder = useCallback(() => {
    setIsReportsAlertDismissedForSession(true);
  }, []);

  // Saves changed settings and months, one version-checked change at a time.
  // Months are never deleted here; that's always an explicit action.
  const handleSaveConfiguration = useCallback(
    async (
      nextSettings: Settings,
      nextMonthlySummaries: MonthlySummary[],
    ): Promise<ConfigurationSaveResult> => {
      if (saveLockRef.current) {
        return { status: "error", message: "Another save is still running." };
      }

      saveLockRef.current = true;

      try {
        if (!isSameSettingsContent(getSettingsForYear(settingsRef.current, nextSettings.year ?? new Date().getFullYear()), nextSettings)) {
          const fingerprint = fingerprintOf(["settings", nextSettings]);
          const outcome = await saveSettingsRemote(
            nextSettings,
            nextSettings.updatedAt ?? null,
            mutationIdsRef.current.idFor(fingerprint),
          );

          if (outcome.status === "conflict") {
            return {
              status: "conflict",
              reason: outcome.reason,
              target: { kind: "settings" },
            };
          }

          if (outcome.status === "saved") {
            mutationIdsRef.current.forget(fingerprint);
            settingsRef.current = outcome.value;
            setSettings(outcome.value);
            const refreshed = await loadRemoteAppData();
            entriesRef.current = refreshed.entries;
            setEntries(refreshed.entries);
          }
        }

        const mutations = diffMonthlySummaries(
          monthlySummariesRef.current,
          nextMonthlySummaries,
        );
        const run = await runMutations(
          mutations,
          async (mutation): Promise<MutationOutcome<MonthlySummary>> => {
            if (mutation.kind !== "save") {
              return { status: "deleted" };
            }

            const fingerprint = fingerprintOf(mutation);
            const outcome = await saveMonthlySummaryRemote(
              mutation.summary,
              mutation.expectedUpdatedAt,
              mutationIdsRef.current.idFor(fingerprint),
            );

            if (outcome.status !== "conflict") {
              mutationIdsRef.current.forget(fingerprint);
            }

            return outcome;
          },
        );
        let nextSummaries = monthlySummariesRef.current;

        run.applied.forEach(({ mutation, outcome }) => {
          if (outcome.status === "saved") {
            nextSummaries = sortMonthlySummaries([
              ...nextSummaries.filter(
                (summary) => summary.monthKey !== mutation.key,
              ),
              outcome.value,
            ]);
          }
        });

        monthlySummariesRef.current = nextSummaries;
        setMonthlySummaries(nextSummaries);

        if (run.status === "conflict" && run.conflict) {
          return {
            status: "conflict",
            reason: run.conflict.reason,
            target: { kind: "month", monthKey: run.conflict.mutation.key },
          };
        }

        if (run.status === "error") {
          throw run.error;
        }

        return {
          status: "saved",
          settings: settingsRef.current,
          monthlySummaries: monthlySummariesRef.current,
        };
      } catch (error) {
        console.error("[Financial Goal] Failed to save configuration.", error);
        return {
          status: "error",
          message: `${getErrorMessage(error, "Saving failed.")} Your changes are kept on this device.`,
        };
      } finally {
        saveLockRef.current = false;
      }
    },
    [],
  );

  const handleDeleteSavedMonthSummary = useCallback(
    async (monthKey: string) => {
      const savedSummary = monthlySummariesRef.current.find(
        (summary) => summary.monthKey === monthKey,
      );

      if (!savedSummary?.updatedAt) {
        return;
      }

      if (saveLockRef.current) {
        throw new Error("Another save is still running. Try again in a moment.");
      }

      saveLockRef.current = true;

      try {
        const outcome = await deleteMonthlySummaryRemote(
          monthKey,
          savedSummary.updatedAt,
        );

        if (outcome.status === "conflict") {
          throw new Error(
            "This month was changed on another device, so it wasn't deleted. Reload the app to see the latest version.",
          );
        }

        const nextSummaries = monthlySummariesRef.current.filter(
          (summary) => summary.monthKey !== monthKey,
        );
        monthlySummariesRef.current = nextSummaries;
        setMonthlySummaries(nextSummaries);
      } finally {
        saveLockRef.current = false;
      }
    },
    [],
  );

  const handleReloadRemote = useCallback(async () => {
    try {
      return await refreshRemoteData();
    } catch (error) {
      showError(getErrorMessage(error, "Couldn't load the latest data."));
      return null;
    }
  }, [refreshRemoteData, showError]);

  const handleSignIn = async (email: string, password: string) => {
    if (!hasSupabaseConfig()) {
      setToastErrorMessage(
        "Missing Supabase config. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      return;
    }

    if (!email || !password) {
      setToastErrorMessage("Enter your email and password.");
      return;
    }

    setIsSigningIn(true);
    setToastErrorMessage("");

    try {
      await signInWithEmailPassword(email, password);
    } catch (error) {
      if ((error as { code?: string })?.code === "email_not_confirmed") {
        return "confirmation-required" as const;
      }
      console.error("[Financial Goal] Sign in failed.", error);
      const nextMessage = getSignInErrorMessage(error);
      setToastErrorMessage(nextMessage);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Signing out clears this device's unsaved drafts, so ask first if there are any.
  const requestSignOut = () => {
    if (hasAnyUnsavedChanges) {
      setIsSignOutConfirmOpen(true);
      return;
    }

    void handleSignOut();
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setToastErrorMessage("");

    try {
      await signOutFromSupabase();
      setIsPasswordRecovery(false);
      try { sessionStorage.removeItem("financial-goal-password-recovery"); } catch { /* optional */ }
      clearBrowserSessionState();
      setSession(null);
      setHasLoadedRemoteState(false);
    } catch (error) {
      setToastErrorMessage(getErrorMessage(error, "Sign out failed."));
    } finally {
      setIsSigningOut(false);
    }
  };

  let activeScreen: React.ReactNode;

  if (currentScreen === "dashboard") {
    activeScreen = (
      <Dashboard
        alertPulseSessionKey={dashboardAlertPulseSessionKey}
        displayName={displayName}
        entries={entries}
        isReportsAlertDismissed={isReportsAlertDismissedForSession}
        monthlySummaries={monthlySummaries}
        onGreetingShown={() => setShouldShowDashboardGreeting(false)}
        onOpenConfigurationSetup={handleOpenConfigurationSetup}
        onAddPreviousMonths={handleAddPreviousMonths}
        onDismissCurrentMonthReminder={handleDismissCurrentMonthReminder}
        onFillMissingDays={handleFillMissingDays}
        settings={settings}
        shouldShowGreeting={shouldShowDashboardGreeting}
      />
    );
  } else if (currentScreen === "daily-log") {
    activeScreen = (
      <DailyLog
        accountCreatedAt={session?.user.created_at}
        entries={reportEntries}
        fillMissingDayTargetDateKey={fillMissingDayTargetDateKey}
        fillMissingDaysRequest={fillMissingDaysRequest}
        hasUnsavedChanges={hasUnsavedReportChanges}
        isSaving={isSavingReport}
        onDeleteEntryImmediately={handleDeleteEntryImmediately}
        onRemoveEntryForDate={handleRemoveEntryForDate}
        onRegisterNavigationHandlers={handleRegisterDailyLogNavigationHandlers}
        onSaveEntries={handleSaveReportEntries}
        onUnsavedDayInputDraftsChange={setHasUnsavedReportFieldDrafts}
        onBackfillMissingMonth={handleBackfillMissingMonth}
        onDiscardEntries={handleDiscardReportEntries}
        reportResetRequest={reportResetRequest}
        savedEntries={entries}
        settings={settings}
        monthlySummaries={monthlySummaries}
        onUpsertEntry={handleUpsertEntry}
        userId={session?.user?.id}
      />
    );
  } else {
    activeScreen = (
      <ConfigurationScreen
        accountCreatedAt={session?.user.created_at}
        backfillFocusRequest={backfillFocusRequest}
        entries={entries}
        settingsFocusRequest={settingsFocusRequest}
        monthlySummaries={monthlySummaries}
        onRegisterNavigationHandlers={
          handleRegisterConfigurationNavigationHandlers
        }
        onSaveConfiguration={handleSaveConfiguration}
        onDeleteSavedMonthSummary={handleDeleteSavedMonthSummary}
        onReloadRemote={handleReloadRemote}
        onSignOut={requestSignOut}
        isSigningOut={isSigningOut}
        onUnsavedChangesChange={setHasUnsavedConfigurationChanges}
        settings={settings}
        userId={session?.user?.id}
      />
    );
  }

  const isConfigured = hasSupabaseConfig();
  const isDashboardScreen = currentScreen === "dashboard";

  if (session && isPasswordRecovery) {
    return <><PasswordResetForm
      onComplete={() => {
        setIsPasswordRecovery(false);
        try { sessionStorage.removeItem("financial-goal-password-recovery"); } catch { /* optional */ }
        showSuccess("Password updated.");
      }}
      onCancel={() => { void handleSignOut(); }}
    /><Toast message={toastErrorMessage} onDismiss={() => setToastErrorMessage("")} tone="error" /></>;
  }

  if (session && hasLoadedRemoteState && loadedRemoteUserId === session.user.id && needsOnboarding) {
    return <><Onboarding key={session.user.id} userId={session.user.id}
      onSignOut={() => { void handleSignOut(); }}
      onSave={async nextSettings => {
        const result = await handleSaveConfiguration(nextSettings, monthlySummariesRef.current);
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "conflict") throw new Error("Your settings were saved in another tab or device. Refresh to load them before continuing.");
      }}
      onComplete={destination => {
        setNeedsOnboarding(false);
        if (destination === "history") handleAddPreviousMonths();
        else setCurrentScreen(destination);
        showSuccess("Your setup is saved. Welcome to Financial Goal.");
      }}
    /><Toast message={toastErrorMessage} onDismiss={() => setToastErrorMessage("")} tone="error" /></>;
  }

  if (!session) {
    return (
      <div className="relative isolate min-h-screen overflow-x-hidden text-foreground">
          <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[30rem] flex-col justify-center px-4 py-10 sm:px-5">
          {!hasCheckedSession ? (
            <p className="mb-4 text-center text-sm text-[#b0947a]">
              Checking your session…
            </p>
          ) : null}
          <section className="w-full">
            <LoginForm
              errorMessage={toastErrorMessage}
              isBusy={isSigningIn || !hasCheckedSession}
              isConfigured={isConfigured}
              onSubmit={handleSignIn}
              linkError={authLinkError}
            />
          </section>
        </main>
        <Toast
          message={toastErrorMessage}
          onDismiss={() => setToastErrorMessage("")}
          tone="error"
        />
      </div>
    );
  }

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden text-foreground">
      <main className="relative z-10 min-h-screen w-full" data-screen={currentScreen}>
        {/* Keep the frame and dock mounted while only the screen content changes. */}
          <PhoneStage
            active={currentScreen}
            onNavigate={handleScreenChange}
            variant={isDashboardScreen && hasLoadedRemoteState ? "artwork" : "screen"}
          >
            {!hasLoadedRemoteState ? (
              loadErrorMessage ? (
                <div className="space-y-4 rounded-[22px] border border-[#ff6b5b]/50 bg-[#240c09]/90 p-5">
                  <div>
                    <p className="dashboard-gold-title text-[17px] font-semibold">
                      Couldn&apos;t load your data
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#ffd9d2]">
                      {loadErrorMessage} Nothing was changed. Check your connection and try
                      again.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-[13px] border border-[#fff1c4]/70 bg-[linear-gradient(180deg,#ffe9a8_0%,#f2b860_45%,#c27a3a_100%)] px-4 py-2.5 text-sm font-semibold text-[#1b0f05]"
                      onClick={() => {
                        setLoadErrorMessage("");
                        setLoadAttempt((currentValue) => currentValue + 1);
                      }}
                      type="button"
                    >
                      Try again
                    </button>
                    <button
                      className="rounded-[13px] border border-[#a97849]/60 bg-[#1a1410] px-4 py-2.5 text-sm font-semibold text-[#e8cfae]"
                      disabled={isSigningOut}
                      onClick={() => void handleSignOut()}
                      type="button"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[22px] border border-[#a8744a]/45 bg-[#18120e] p-5 text-sm text-[#b0947a]">
                  Loading your data…
                </div>
              )
            ) : (
              activeScreen
            )}
          </PhoneStage>
      </main>

      <Toast
        message={toastErrorMessage}
        onDismiss={() => setToastErrorMessage("")}
        tone="error"
      />
      <Toast
        message={toastErrorMessage || deletedReports.length ? "" : toastSuccessMessage}
        onDismiss={() => setToastSuccessMessage("")}
        tone="success"
      />
      <Toast
        persistent
        message={toastErrorMessage || !deletedReports[0] ? "" :
          undoError || `Report for ${formatConflictDate(deletedReports[0].entry.date)} deleted.${deletedReports.length > 1 ? ` ${deletedReports.length} deletions can be undone.` : ""}`}
        tone={undoError ? "error" : "success"}
        action={{
          label: isSavingReport ? "Please wait…" : "Undo",
          disabled: isSavingReport,
          onClick: () => { void handleUndoDeletedReport(); },
        }}
        onDismiss={() => {
          if (saveLockRef.current) return;
          setDeletedReports((current) => current.slice(1));
          setUndoError("");
        }}
      />
      <WarningModal
        body={
          reportConflict
            ? `${formatConflictDate(reportConflict.date)} ${
                reportConflict.reason === "exists"
                  ? "was also added on another device"
                  : reportConflict.reason === "deleted"
                    ? "was deleted on another device"
                    : "was changed on another device"
              } after you opened it, so your change wasn't saved.\n\nYour change is still here. Keep editing to leave it unsaved, use the other device's version, or overwrite it with yours. Overwriting replaces what the other device saved.`
            : ""
        }
        extraActions={[
          {
            label: "Use other version",
            onClick: () => void handleUseOtherReportVersion(),
          },
          {
            label: "Overwrite with mine",
            onClick: () => void handleOverwriteReportVersion(),
            tone: "danger",
          },
        ]}
        isOpen={reportConflict !== null}
        onClose={() => setReportConflict(null)}
        primaryActionLabel="Keep editing"
        title="Changed on another device"
      />
      <WarningModal
        body="You have unsaved changes on this device. Signing out discards them."
        isOpen={isSignOutConfirmOpen}
        onClose={() => setIsSignOutConfirmOpen(false)}
        onPrimaryAction={() => {
          setIsSignOutConfirmOpen(false);
          void handleSignOut();
        }}
        onSecondaryAction={() => setIsSignOutConfirmOpen(false)}
        primaryActionLabel="Sign out anyway"
        secondaryActionLabel="Cancel"
        title="Sign out with unsaved changes?"
      />
      <WarningModal
        body="You have unsaved daily reports. Do you want to save them?"
        isOpen={isUnsavedReportModalOpen}
        onClose={() => {
          setIsUnsavedReportModalOpen(false);
          setPendingScreen(null);
        }}
        onPrimaryAction={async () => {
          setIsUnsavedReportModalOpen(false);
          const wasSaved = dailyLogNavigationHandlersRef.current
            ? await dailyLogNavigationHandlersRef.current.save()
            : await handleSaveReportEntries();

          if (wasSaved && pendingScreen) {
            proceedToScreen(pendingScreen);
          }

          setPendingScreen(null);
        }}
        onSecondaryAction={() => {
          dailyLogNavigationHandlersRef.current?.discard();
          handleDiscardReportEntries();
          setIsUnsavedReportModalOpen(false);

          if (pendingScreen) {
            proceedToScreen(pendingScreen);
            setPendingScreen(null);
          }
        }}
        primaryActionLabel="Save"
        secondaryActionLabel="Don't Save"
        title="Unsaved daily reports"
      />
      <WarningModal
        body="There are unsaved changes, do you want to save them or discard and leave"
        isOpen={isUnsavedConfigurationModalOpen}
        onClose={() => {
          setIsUnsavedConfigurationModalOpen(false);
          setPendingScreen(null);
        }}
        onPrimaryAction={async () => {
          const wasSaved =
            await configurationNavigationHandlersRef.current?.save();

          if (!wasSaved) {
            setIsUnsavedConfigurationModalOpen(false);
            setPendingScreen(null);
            return;
          }

          setIsUnsavedConfigurationModalOpen(false);
          setHasUnsavedConfigurationChanges(false);

          if (pendingScreen) {
            proceedToScreen(pendingScreen);
            setPendingScreen(null);
          }
        }}
        onSecondaryAction={() => {
          configurationNavigationHandlersRef.current?.discard();
          setHasUnsavedConfigurationChanges(false);
          setIsUnsavedConfigurationModalOpen(false);

          if (pendingScreen) {
            proceedToScreen(pendingScreen);
            setPendingScreen(null);
          }
        }}
        primaryActionLabel="Save"
        secondaryActionLabel="Discard"
        title="Unsaved configuration changes"
      />
      <WarningModal
        body="This month is marked as a non-business month. Adding daily business entries here would make your calculations inaccurate."
        isOpen={isEmploymentMonthWarningOpen}
        onClose={() => {
          setIsEmploymentMonthWarningOpen(false);
          setPendingScreen(null);
        }}
        onPrimaryAction={() => {
          setIsEmploymentMonthWarningOpen(false);
          setBackfillFocusRequest((currentValue) => currentValue + 1);
          proceedToScreen("configuration");
          setPendingScreen(null);
        }}
        onSecondaryAction={() => {
          setIsEmploymentMonthWarningOpen(false);
          setPendingScreen(null);
        }}
        primaryActionLabel="Go to month setup"
        secondaryActionLabel="Close"
        title="Non-business month"
      />
      <WarningModal
        body="Adding a daily entry here will make daily entries the source of truth for this month. Your monthly summary will no longer be used for calculations unless all daily entries for that month are removed. This may change your dashboard forecasts and tax planning."
        isOpen={isSummaryConflictWarningOpen}
        onClose={() => {
          setIsSummaryConflictWarningOpen(false);
          setPendingSummaryConflictSaveEntries(null);
          setPendingScreen(null);
        }}
        onPrimaryAction={async () => {
          const entriesToSave = pendingSummaryConflictSaveEntries;
          setIsSummaryConflictWarningOpen(false);
          setPendingSummaryConflictSaveEntries(null);

          if (!entriesToSave) {
            return;
          }

          const wasSaved = await saveReportAfterChecks(entriesToSave);

          if (wasSaved && pendingScreen) {
            proceedToScreen(pendingScreen);
          }

          setPendingScreen(null);
        }}
        onSecondaryAction={() => {
          setIsSummaryConflictWarningOpen(false);
          setPendingSummaryConflictSaveEntries(null);
          setPendingScreen(null);
        }}
        primaryActionLabel="Save daily entry"
        secondaryActionLabel="Cancel"
        title="This month already has a summary"
      />
      <WarningModal
        body="You have one or more daily reports on future dates. They can still be saved, but your dashboard may look ahead before those days actually happen."
        isOpen={isFutureReportWarningOpen}
        onClose={() => {
          setIsFutureReportWarningOpen(false);
          setPendingFutureSaveEntries(null);
          setPendingScreen(null);
        }}
        onPrimaryAction={async () => {
          const entriesToSave = pendingFutureSaveEntries;
          setIsFutureReportWarningOpen(false);
          setPendingFutureSaveEntries(null);
          const wasSaved = entriesToSave
            ? await persistReportEntriesList(entriesToSave)
            : false;

          if (wasSaved) {
            finishReportSave();
          }

          if (wasSaved && pendingScreen) {
            proceedToScreen(pendingScreen);
          }

          setPendingScreen(null);
        }}
        onSecondaryAction={() => {
          setIsFutureReportWarningOpen(false);
          setPendingFutureSaveEntries(null);
          setPendingScreen(null);
        }}
        primaryActionLabel="Save anyway"
        secondaryActionLabel="Go back"
        title="Future day reports included"
      />
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  const rawMessage =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  if (/failed to fetch|networkerror|load failed|network request failed/i.test(rawMessage)) {
    return "Couldn't reach the server. Check your connection.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  // Supabase errors are plain objects with a message.
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

function formatConflictDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function getSignInErrorMessage(error: unknown) {
  return authErrorMessage(error);
}
