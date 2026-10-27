"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Configuration as ConfigurationScreen,
  type ConfigurationNavigationHandlers,
} from "@/components/configuration";
import {
  DailyLog,
  type DailyLogNavigationHandlers,
} from "@/components/daily-log";
import { Dashboard } from "@/components/dashboard";
import { LoginForm } from "@/components/login-form";
import { PhoneStage } from "@/components/phone-stage";
import { Toast } from "@/components/ui/kit";
import { WarningModal } from "@/components/warning-modal";
import {
  loadRemoteAppData,
  saveDailyEntriesToSupabase,
  saveMonthlySummariesToSupabase,
  saveSettingsToSupabase,
} from "@/lib/app-data-store";
import { toDateKey } from "@/lib/calculations";
import { starterStoredState } from "@/lib/default-state";
import {
  clearStoredUiPreferences,
  clearUserReportDayFormDrafts,
  clearUserReportDraftEntries,
  getUserCurrentScreen,
  getUserReportDraftEntries,
  updateUserCurrentScreen,
  updateUserReportDraftEntries,
} from "@/lib/ui-preferences";
import {
  getCurrentSession,
  hasSupabaseConfig,
  onSupabaseAuthStateChange,
  signInWithEmailPassword,
  signOutFromSupabase,
} from "@/lib/supabase";
import type { DailyEntry, MonthlySummary, Screen, Settings, WorkItem } from "@/lib/types";

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

function cloneEntries(entries: DailyEntry[]) {
  return entries.map((entry) => ({
    ...entry,
    workItems: entry.workItems?.map((workItem) => ({ ...workItem })),
  }));
}

function removeEntryByDate(entries: DailyEntry[], dateKey: string) {
  return entries.filter((entry) => entry.date !== dateKey);
}

function getComparableEntries(entries: DailyEntry[]) {
  return [...entries].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function getComparableWorkItems(workItems: WorkItem[] | undefined) {
  return [...(workItems ?? [])].sort((left, right) => {
    const lineComparison = left.lineIndex - right.lineIndex;

    if (lineComparison !== 0) {
      return lineComparison;
    }

    return left.projectName.localeCompare(right.projectName);
  });
}

function areWorkItemsEqual(left: WorkItem[] | undefined, right: WorkItem[] | undefined) {
  const comparableLeft = getComparableWorkItems(left);
  const comparableRight = getComparableWorkItems(right);

  if (comparableLeft.length !== comparableRight.length) {
    return false;
  }

  return comparableLeft.every((leftWorkItem, index) => {
    const rightWorkItem = comparableRight[index];

    return (
      leftWorkItem.projectName === rightWorkItem.projectName &&
      leftWorkItem.hours === rightWorkItem.hours &&
      leftWorkItem.hourlyRate === rightWorkItem.hourlyRate &&
      leftWorkItem.invoicedIncome === rightWorkItem.invoicedIncome &&
      leftWorkItem.lineIndex === rightWorkItem.lineIndex
    );
  });
}

function areEntriesEqual(left: DailyEntry[], right: DailyEntry[]) {
  if (left.length !== right.length) {
    return false;
  }

  const comparableLeft = getComparableEntries(left);
  const comparableRight = getComparableEntries(right);

  return comparableLeft.every((leftEntry, index) => {
    const rightEntry = comparableRight[index];

    return (
      leftEntry.date === rightEntry.date &&
      (leftEntry.dayStatus ?? "worked") ===
        (rightEntry.dayStatus ?? "worked") &&
      leftEntry.hours === rightEntry.hours &&
      leftEntry.invoicedIncome === rightEntry.invoicedIncome &&
      leftEntry.expenses === rightEntry.expenses &&
      (leftEntry.note ?? "") === (rightEntry.note ?? "") &&
      (leftEntry.source ?? "") === (rightEntry.source ?? "") &&
      areWorkItemsEqual(leftEntry.workItems, rightEntry.workItems)
    );
  });
}

type PersistedEntriesSnapshot = {
  entries: DailyEntry[];
  userId: string;
};

function hasFutureDatedEntries(entries: DailyEntry[], todayDateKey: string) {
  return entries.some((entry) => entry.date > todayDateKey);
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
    savedEntries.map((entry) => entry.date.slice(0, 7)),
  );
  const nextEntryMonthKeys = new Set(
    nextEntries.map((entry) => entry.date.slice(0, 7)),
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
    nextEntries.map((entry) => entry.date.slice(0, 7)),
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
  const [entries, setEntries] = useState<DailyEntry[]>(
    starterStoredState.entries,
  );
  const [reportDraftEntries, setReportDraftEntries] = useState<
    DailyEntry[] | null
  >(null);
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
  const [isSigningOut, setIsSigningOut] = useState(false);
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
  const [entriesSaveAttempt, setEntriesSaveAttempt] = useState(0);
  const [hasHydratedReportDraftEntries, setHasHydratedReportDraftEntries] =
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
  const lastPersistedEntriesRef = useRef<PersistedEntriesSnapshot | null>(null);
  const hasUnsavedReportEntryChanges =
    reportDraftEntries !== null &&
    !areEntriesEqual(reportDraftEntries, entries);
  const hasUnsavedReportChanges =
    hasUnsavedReportEntryChanges || hasUnsavedReportFieldDrafts;

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    let isActive = true;
    let hasResolvedSession = false;

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

    const unsubscribe = onSupabaseAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return;
      }

      hasResolvedSession = true;
      window.clearTimeout(fallbackTimer);
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
      lastPersistedEntriesRef.current = null;
      return;
    }

    let isActive = true;
    const userId = session.user.id;
    setHasLoadedRemoteState(false);
    setLoadedRemoteUserId(null);
    lastPersistedEntriesRef.current = null;

    void loadRemoteAppData()
      .then((remoteData) => {
        if (!isActive) {
          return;
        }

        lastPersistedEntriesRef.current = {
          entries: cloneEntries(remoteData.entries),
          userId,
        };
        setEntries(remoteData.entries);
        setMonthlySummaries(remoteData.monthlySummaries);
        setSettings(remoteData.settings);
        setDisplayName(remoteData.displayName);
        setIsReportsAlertDismissedForSession(false);
        setLoadedRemoteUserId(userId);
        setHasLoadedRemoteState(true);
      })
      .catch((error) => {
        console.error("[Financial Goal] Failed to load Supabase data.", error);
        if (!isActive) {
          return;
        }

        lastPersistedEntriesRef.current = {
          entries: cloneEntries(entriesRef.current),
          userId,
        };
        setDisplayName(undefined);
        setLoadedRemoteUserId(userId);
        setHasLoadedRemoteState(true);
      });

    return () => {
      isActive = false;
    };
  }, [hasCheckedSession, session]);

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
      setReportDraftEntries(null);
      setMonthlySummaries(starterStoredState.monthlySummaries);
      setSettings(starterStoredState.settings);
      setDisplayName(undefined);
      setHasLoadedRemoteState(false);
      setHasHydratedReportDraftEntries(false);
      setHasUnsavedReportFieldDrafts(false);
      setHasUnsavedConfigurationChanges(false);
      setLoadedRemoteUserId(null);
      setFillMissingDayTargetDateKey(undefined);
      setPendingScreen(null);
      setPendingSummaryConflictSaveEntries(null);
      setPendingFutureSaveEntries(null);
      setIsUnsavedReportModalOpen(false);
      setIsUnsavedConfigurationModalOpen(false);
      setIsSummaryConflictWarningOpen(false);
      setIsEmploymentMonthWarningOpen(false);
      setIsFutureReportWarningOpen(false);
      lastPersistedEntriesRef.current = null;
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

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId || !hasLoadedRemoteState || loadedRemoteUserId !== userId) {
      return;
    }

    setReportDraftEntries(getUserReportDraftEntries(userId));
    setHasHydratedReportDraftEntries(true);
  }, [hasLoadedRemoteState, loadedRemoteUserId, session]);

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId || !hasLoadedRemoteState || loadedRemoteUserId !== userId) {
      return;
    }

    const lastPersistedEntries = lastPersistedEntriesRef.current;

    if (
      lastPersistedEntries?.userId === userId &&
      areEntriesEqual(entries, lastPersistedEntries.entries)
    ) {
      return;
    }

    let retryTimeoutId: number | undefined;

    void saveDailyEntriesToSupabase(entries)
      .then(() => {
        lastPersistedEntriesRef.current = {
          entries: cloneEntries(entries),
          userId,
        };
        setEntriesSaveAttempt(0);
      })
      .catch((error) => {
        console.error("[Financial Goal] Failed to save daily entries.", error);
        // The reports stay on screen; retry a few times before giving up.
        if (entriesSaveAttempt < 3) {
          setToastErrorMessage("Couldn't save your reports. Retrying…");
          retryTimeoutId = window.setTimeout(() => {
            setEntriesSaveAttempt((currentValue) => currentValue + 1);
          }, 4000);
          return;
        }

        setToastErrorMessage(
          "Your reports couldn't be saved. Check your connection and save again.",
        );
      });

    return () => {
      if (retryTimeoutId !== undefined) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [entries, entriesSaveAttempt, hasLoadedRemoteState, loadedRemoteUserId, session]);

  useEffect(() => {
    const userId = session?.user?.id;

    if (!userId || !hasLoadedRemoteState) {
      return;
    }

    if (
      reportDraftEntries !== null &&
      !areEntriesEqual(reportDraftEntries, entries)
    ) {
      updateUserReportDraftEntries(userId, reportDraftEntries);
      return;
    }

    clearUserReportDraftEntries(userId);
  }, [entries, hasLoadedRemoteState, reportDraftEntries, session]);

  useEffect(() => {
    if (currentScreen !== "daily-log") {
      return;
    }

    if (!hasLoadedRemoteState || !hasHydratedReportDraftEntries) {
      return;
    }

    if (reportDraftEntries === null) {
      setReportDraftEntries(cloneEntries(entries));
      return;
    }

    if (
      !hasUnsavedReportChanges &&
      !areEntriesEqual(reportDraftEntries, entries)
    ) {
      setReportDraftEntries(cloneEntries(entries));
    }
  }, [
    currentScreen,
    entries,
    hasHydratedReportDraftEntries,
    hasLoadedRemoteState,
    hasUnsavedReportChanges,
    reportDraftEntries,
  ]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [currentScreen]);

  const handleUpsertEntry = useCallback(
    (entry: DailyEntry) => {
      setReportDraftEntries((previousEntries) => {
        const draftEntries = previousEntries ?? cloneEntries(entries);

        return [
          entry,
          ...draftEntries.filter(
            (previousEntry) => previousEntry.date !== entry.date,
          ),
        ];
      });
    },
    [entries],
  );

  const handleRemoveEntryForDate = useCallback(
    (dateKey: string) => {
      setReportDraftEntries((previousEntries) => {
        const draftEntries = previousEntries ?? cloneEntries(entries);
        return draftEntries.filter(
          (previousEntry) => previousEntry.date !== dateKey,
        );
      });
    },
    [entries],
  );

  const handleDeleteSavedEntryImmediately = useCallback((dateKey: string) => {
    setEntries((previousEntries) => {
      const nextSavedEntries = removeEntryByDate(previousEntries, dateKey);

      setReportDraftEntries((previousDraftEntries) =>
        removeEntryByDate(
          previousDraftEntries ?? cloneEntries(nextSavedEntries),
          dateKey,
        ),
      );

      return nextSavedEntries;
    });
  }, []);

  const proceedToScreen = (screen: Screen) => {
    if (screen === "daily-log" && reportDraftEntries === null) {
      setReportDraftEntries(cloneEntries(entries));
    }

    if (screen === "daily-log") {
      setReportResetRequest((currentValue) => currentValue + 1);
    }

    setCurrentScreen(screen);
  };

  const commitReportEntries = (entriesToSave: DailyEntry[]) => {
    setEntries(cloneEntries(entriesToSave));
    setReportDraftEntries(cloneEntries(entriesToSave));
    setHasUnsavedReportFieldDrafts(false);
    const userId = session?.user?.id;

    if (userId) {
      clearUserReportDayFormDrafts(userId);
      clearUserReportDraftEntries(userId);
    }
  };

  const finishSavingReportEntries = (entriesToSave: DailyEntry[]) => {
    if (hasFutureDatedEntries(entriesToSave, todayDateKey)) {
      setPendingFutureSaveEntries(cloneEntries(entriesToSave));
      setIsFutureReportWarningOpen(true);
      return false;
    }

    commitReportEntries(entriesToSave);
    return true;
  };

  const handleSaveReportEntries = (nextEntries?: DailyEntry[]) => {
    const entriesToSave = nextEntries ?? reportDraftEntries;

    if (entriesToSave === null || !entriesToSave) {
      return true;
    }

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
      setPendingSummaryConflictSaveEntries(cloneEntries(entriesToSave));
      setIsSummaryConflictWarningOpen(true);
      return false;
    }

    return finishSavingReportEntries(entriesToSave);
  };

  const handleDiscardReportEntries = () => {
    setReportDraftEntries(cloneEntries(entries));
    setHasUnsavedReportFieldDrafts(false);
    const userId = session?.user?.id;

    if (userId) {
      clearUserReportDayFormDrafts(userId);
      clearUserReportDraftEntries(userId);
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

  const handleAddPreviousMonths = useCallback(() => {
    setBackfillFocusRequest((currentValue) => currentValue + 1);
    setCurrentScreen("configuration");
  }, []);

  const handleFillMissingDays = useCallback(
    (targetDateKey?: string) => {
      setReportDraftEntries((previousEntries) =>
        previousEntries ?? cloneEntries(entries),
      );
      setFillMissingDayTargetDateKey(targetDateKey);
      setFillMissingDaysRequest((currentValue) => currentValue + 1);
      setCurrentScreen("daily-log");
    },
    [entries],
  );

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

  const handleSaveConfiguration = useCallback(
    async (nextSettings: Settings, nextMonthlySummaries: MonthlySummary[]) => {
      try {
        await Promise.all([
          saveSettingsToSupabase(nextSettings),
          saveMonthlySummariesToSupabase(nextMonthlySummaries),
        ]);

        setSettings(nextSettings);
        setMonthlySummaries(nextMonthlySummaries);
      } catch (error) {
        console.error("[Financial Goal] Failed to save configuration.", error);
        setToastErrorMessage(
          getErrorMessage(error, "Failed to save configuration."),
        );
        throw error;
      }
    },
    [],
  );

  const handleDeleteSavedMonthSummary = useCallback(
    async (monthKey: string) => {
      const nextMonthlySummaries = monthlySummaries.filter(
        (summary) => summary.monthKey !== monthKey,
      );

      try {
        await saveMonthlySummariesToSupabase(nextMonthlySummaries);
        setMonthlySummaries(nextMonthlySummaries);
      } catch (error) {
        console.error(
          "[Financial Goal] Failed to delete saved month summary.",
          error,
        );
        setToastErrorMessage(
          getErrorMessage(error, "Failed to delete saved month summary."),
        );
        throw error;
      }
    },
    [monthlySummaries],
  );
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
      console.error("[Financial Goal] Sign in failed.", error);
      const nextMessage = getSignInErrorMessage(error);
      setToastErrorMessage(nextMessage);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setToastErrorMessage("");

    try {
      await signOutFromSupabase();
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
        onNavigate={handleScreenChange}
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
        entries={reportDraftEntries ?? entries}
        fillMissingDayTargetDateKey={fillMissingDayTargetDateKey}
        fillMissingDaysRequest={fillMissingDaysRequest}
        hasUnsavedChanges={hasUnsavedReportChanges}
        onDeleteSavedEntryImmediately={handleDeleteSavedEntryImmediately}
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
        backfillFocusRequest={backfillFocusRequest}
        entries={entries}
        settingsFocusRequest={settingsFocusRequest}
        monthlySummaries={monthlySummaries}
        onRegisterNavigationHandlers={
          handleRegisterConfigurationNavigationHandlers
        }
        onSaveConfiguration={handleSaveConfiguration}
        onDeleteSavedMonthSummary={handleDeleteSavedMonthSummary}
        onSignOut={() => void handleSignOut()}
        isSigningOut={isSigningOut}
        onUnsavedChangesChange={setHasUnsavedConfigurationChanges}
        settings={settings}
        userId={session?.user?.id}
      />
    );
  }

  const isConfigured = hasSupabaseConfig();
  const isDashboardScreen = currentScreen === "dashboard";

  useEffect(() => {
    if (!toastErrorMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToastErrorMessage("");
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toastErrorMessage]);

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
              isBusy={isSigningIn}
              isConfigured={isConfigured}
              onSubmit={handleSignIn}
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
        {isDashboardScreen && hasLoadedRemoteState ? (
          activeScreen
        ) : (
          // Report and Configuration share the dashboard's phone stage and dock.
          <PhoneStage
            key={currentScreen}
            active={currentScreen}
            onNavigate={handleScreenChange}
            variant="screen"
          >
            {!hasLoadedRemoteState ? (
              <div className="rounded-[22px] border border-[#a8744a]/45 bg-[#18120e] p-5 text-sm text-[#b0947a]">
                Loading your data…
              </div>
            ) : (
              activeScreen
            )}
          </PhoneStage>
        )}
      </main>

      <Toast
        message={toastErrorMessage}
        onDismiss={() => setToastErrorMessage("")}
        tone="error"
      />
      <WarningModal
        body="You have unsaved daily reports. Do you want to save them?"
        isOpen={isUnsavedReportModalOpen}
        onClose={() => {
          setIsUnsavedReportModalOpen(false);
          setPendingScreen(null);
        }}
        onPrimaryAction={() => {
          setIsUnsavedReportModalOpen(false);
          const wasSavedImmediately =
            hasUnsavedReportFieldDrafts && dailyLogNavigationHandlersRef.current
              ? dailyLogNavigationHandlersRef.current.save()
              : handleSaveReportEntries();

          if (wasSavedImmediately && pendingScreen) {
            proceedToScreen(pendingScreen);
            setPendingScreen(null);
          }
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
        onPrimaryAction={() => {
          const entriesToSave = pendingSummaryConflictSaveEntries;
          setIsSummaryConflictWarningOpen(false);
          setPendingSummaryConflictSaveEntries(null);

          if (!entriesToSave) {
            return;
          }

          const wasSavedImmediately = finishSavingReportEntries(entriesToSave);

          if (wasSavedImmediately && pendingScreen) {
            proceedToScreen(pendingScreen);
            setPendingScreen(null);
          }
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
        onPrimaryAction={() => {
          if (pendingFutureSaveEntries) {
            commitReportEntries(pendingFutureSaveEntries);
          }

          setIsFutureReportWarningOpen(false);
          setPendingFutureSaveEntries(null);

          if (pendingScreen) {
            proceedToScreen(pendingScreen);
            setPendingScreen(null);
          }
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
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function getSignInErrorMessage(error: unknown) {
  const rawMessage = getErrorMessage(error, "").toLowerCase();

  if (
    rawMessage.includes("invalid login credentials") ||
    rawMessage.includes("email not confirmed") ||
    rawMessage.includes("invalid credentials")
  ) {
    return "Invalid login credentials. Check your email and password.";
  }

  if (
    rawMessage.includes("failed to fetch") ||
    rawMessage.includes("fetch failed") ||
    rawMessage.includes("network") ||
    rawMessage.includes("load failed")
  ) {
    return "Network error. Supabase auth service is unavailable or unreachable.";
  }

  if (
    rawMessage.includes("session") ||
    rawMessage.includes("refresh token") ||
    rawMessage.includes("jwt")
  ) {
    return "Session error. Clear the saved session and sign in again.";
  }

  if (
    rawMessage.includes("supabase") ||
    rawMessage.includes("auth") ||
    rawMessage.includes("service unavailable")
  ) {
    return "Supabase auth service is unavailable. Check your auth configuration and try again.";
  }

  return `Unknown sign-in error.${rawMessage ? ` ${getErrorMessage(error, "")}` : ""}`.trim();
}
