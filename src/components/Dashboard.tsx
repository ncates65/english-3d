import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Award,
  BookOpen,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  Flame,
  Info,
  LogOut,
  Moon,
  Plus,
  Play,
  RefreshCw,
  Sparkles,
  Sun,
  User,
  UserCheck,
} from 'lucide-react';
import {
  RecalibrationResolutionMode,
  StudyPlan,
  StudySession,
  SyncMode,
  UserAccount,
} from '../types/study';
import {
  deleteStudyPlan,
  fetchAllPlans,
  logoutUser,
  rescheduleOverdueSession,
} from '../services/apiClient';
import {
  downloadPlanAsIcs,
  syncPlanToGoogleCalendar,
  syncPlanToGoogleTasks,
} from '../utils/calendarSync';
import { diffCalendarDays, formatLocalDate } from '../utils/spacingEngine';
import { AboutView } from './AboutView';
import { AuthModal } from './AuthModal';
import { CreatePlanModal } from './CreatePlanModal';
import { PlanTimeline } from './PlanTimeline';
import { SessionWorkspace } from './SessionWorkspace';

type QueueFilter =
  | 'all_actionable'
  | 'missed'
  | 'today'
  | 'upcoming'
  | 'completed';

interface QueueEntry {
  plan: StudyPlan;
  session: StudySession;
  category: 'missed' | 'today' | 'upcoming' | 'completed';
  dayDelta: number;
}

interface DashboardProps {
  initialView?: 'dashboard' | 'about';
}

type ResolvedTheme = 'light' | 'dark';

function resolveCurrentTheme(): ResolvedTheme {
  try {
    const stored = localStorage.getItem('color-scheme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Ignore storage access errors
  }
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

function applyDocumentTheme(
  target: ResolvedTheme,
  persistOverride: boolean
): void {
  const isSystemDark =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const systemTheme: ResolvedTheme = isSystemDark ? 'dark' : 'light';

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]'
  );

  if (persistOverride) {
    try {
      // Per modern-web-guidance dark-mode-toggle: if target matches current system preference,
      // remove the stored override so the document reverts to following system preference.
      if (target === systemTheme) {
        localStorage.removeItem('color-scheme');
        if (meta) meta.content = 'light dark';
      } else {
        localStorage.setItem('color-scheme', target);
        if (meta) meta.content = target;
      }
    } catch {
      if (meta) meta.content = target;
    }
  } else {
    try {
      const stored = localStorage.getItem('color-scheme');
      if (meta) {
        meta.content =
          stored === 'light' || stored === 'dark' ? stored : 'light dark';
      }
    } catch {
      // Ignore
    }
  }

  document.documentElement.classList.toggle('dark', target === 'dark');
}

export const Dashboard: React.FC<DashboardProps> = ({
  initialView = 'dashboard',
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveCurrentTheme());
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'register'>('signin');
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all_actionable');
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [reschedulingSessionId, setReschedulingSessionId] = useState<number | null>(null);
  const [deadlineSqueezeSessionId, setDeadlineSqueezeSessionId] = useState<number | null>(null);

  const [backendLive, setBackendLive] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.8-flash');
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const isAboutView =
    (initialView === 'about' || searchParams.get('view') === 'about') &&
    !activeSessionId;

  // Sync theme on mount + listen to OS prefers-color-scheme & cross-tab storage changes
  useEffect(() => {
    const initial = resolveCurrentTheme();
    setTheme(initial);
    applyDocumentTheme(initial, false);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      try {
        const stored = localStorage.getItem('color-scheme');
        if (stored === 'light' || stored === 'dark') {
          return; // Keep explicit user override intact
        }
      } catch {
        // Ignore
      }
      const next: ResolvedTheme = e.matches ? 'dark' : 'light';
      setTheme(next);
      applyDocumentTheme(next, false);
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next = resolveCurrentTheme();
        setTheme(next);
        applyDocumentTheme(next, false);
      }
    };

    mediaQuery.addEventListener('change', handleMediaChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleToggleTheme = () => {
    const nextTheme: ResolvedTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    applyDocumentTheme(nextTheme, true);
  };

  // Light-dismiss account popover on outside pointerdown or Escape
  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setIsAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  // Load plans on mount & resolve deep-link query params (?plan_id=X&session_id=Y)
  useEffect(() => {
    void (async () => {
      const init = await fetchAllPlans();
      setCurrentUser(init.user);
      setPlans(init.plans);
      setBackendLive(init.backendLive);
      setBackendError(init.backendError || null);
      setGoogleClientId(init.googleOAuthClientId);
      setGeminiModel(init.geminiModel);

      const paramPlanId = Number(searchParams.get('plan_id') || 0);
      const paramSessionId = Number(searchParams.get('session_id') || 0);

      if (paramSessionId > 0) {
        for (const p of init.plans) {
          const foundSession = p.sessions.find((s) => s.id === paramSessionId);
          if (foundSession) {
            setSelectedPlanId(p.id);
            setActiveSessionId(foundSession.id);
            return;
          }
        }
      }

      if (paramPlanId > 0 && init.plans.some((p) => p.id === paramPlanId)) {
        setSelectedPlanId(paramPlanId);
      } else if (init.plans.length > 0) {
        setSelectedPlanId(init.plans[0].id);
      }
    })();
  }, []);

  const reloadPlansForUser = async (
    nextUser: UserAccount,
    noticeText?: string | null
  ) => {
    const init = await fetchAllPlans(nextUser);
    setCurrentUser(init.user);
    setPlans(init.plans);
    setBackendLive(init.backendLive);
    setBackendError(init.backendError || null);
    setGoogleClientId(init.googleOAuthClientId);
    setGeminiModel(init.geminiModel);
    setActiveSessionId(null);
    setSelectedPlanId(init.plans[0]?.id || null);
    if (noticeText) {
      setBannerNotice(noticeText);
    }
  };

  const handleAuthSuccess = async (
    authedUser: UserAccount,
    migratedPlansCount: number
  ) => {
    const migrationSuffix =
      migratedPlansCount > 0
        ? ` Migrated ${migratedPlansCount} guest study ${migratedPlansCount === 1 ? 'plan' : 'plans'} into your account.`
        : '';
    const notice = authedUser.isGuest
      ? 'Switched to Guest Mode.'
      : `Signed in as ${authedUser.displayName || authedUser.email}.${migrationSuffix}`;
    await reloadPlansForUser(authedUser, notice);
  };

  const handleLogout = async () => {
    setIsAccountMenuOpen(false);
    const freshGuest = await logoutUser();
    await reloadPlansForUser(
      freshGuest,
      'Signed out. Now browsing in fresh Guest Mode.'
    );
  };

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) || plans[0] || null,
    [plans, selectedPlanId]
  );

  const activeSession = useMemo(() => {
    if (!selectedPlan || !activeSessionId) return null;
    return (
      selectedPlan.sessions.find((s) => s.id === activeSessionId) || null
    );
  }, [selectedPlan, activeSessionId]);

  // Global metrics & Study Queue categorization across all plans
  const metrics = useMemo(() => {
    const today = formatLocalDate(new Date());
    let totalSessions = 0;
    let completedSessions = 0;
    let scoreSum = 0;
    let scoredCount = 0;

    const missedEntries: QueueEntry[] = [];
    const todayEntries: QueueEntry[] = [];
    const allUpcomingEntries: QueueEntry[] = [];
    const completedEntries: QueueEntry[] = [];

    const upcomingPerPlanCount = new Map<number, number>();

    for (const p of plans) {
      const sortedSessions = [...p.sessions].sort((a, b) =>
        a.scheduledDate.localeCompare(b.scheduledDate) ||
        a.sessionNumber - b.sessionNumber
      );

      for (const s of sortedSessions) {
        if (s.status === 'merged') {
          continue;
        }
        totalSessions++;
        if (typeof s.masteryScore === 'number') {
          scoreSum += s.masteryScore;
          scoredCount++;
        }

        if (s.status === 'completed') {
          completedSessions++;
          completedEntries.push({
            plan: p,
            session: s,
            category: 'completed',
            dayDelta: diffCalendarDays(today, s.scheduledDate),
          });
        } else if (s.scheduledDate < today) {
          missedEntries.push({
            plan: p,
            session: s,
            category: 'missed',
            dayDelta: diffCalendarDays(s.scheduledDate, today),
          });
        } else if (s.scheduledDate === today) {
          todayEntries.push({
            plan: p,
            session: s,
            category: 'today',
            dayDelta: 0,
          });
        } else {
          allUpcomingEntries.push({
            plan: p,
            session: s,
            category: 'upcoming',
            dayDelta: diffCalendarDays(today, s.scheduledDate),
          });
        }
      }
    }

    missedEntries.sort(
      (a, b) =>
        a.session.scheduledDate.localeCompare(b.session.scheduledDate) ||
        a.session.sessionNumber - b.session.sessionNumber
    );
    todayEntries.sort((a, b) => a.session.sessionNumber - b.session.sessionNumber);
    allUpcomingEntries.sort(
      (a, b) =>
        a.session.scheduledDate.localeCompare(b.session.scheduledDate) ||
        a.session.sessionNumber - b.session.sessionNumber
    );
    completedEntries.sort(
      (a, b) =>
        (b.session.completedAt || b.session.scheduledDate).localeCompare(
          a.session.completedAt || a.session.scheduledDate
        ) || b.session.sessionNumber - a.session.sessionNumber
    );

    // Cap visible upcoming items per plan at 2 unless showAllUpcoming is toggled
    const cappedUpcomingEntries = showAllUpcoming
      ? allUpcomingEntries
      : allUpcomingEntries.filter((entry) => {
          const count = upcomingPerPlanCount.get(entry.plan.id) || 0;
          if (count < 2) {
            upcomingPerPlanCount.set(entry.plan.id, count + 1);
            return true;
          }
          return false;
        });

    const actionableEntries = [
      ...missedEntries,
      ...todayEntries,
      ...cappedUpcomingEntries,
    ];

    const filteredQueue =
      queueFilter === 'all_actionable'
        ? actionableEntries
        : queueFilter === 'missed'
          ? missedEntries
          : queueFilter === 'today'
            ? todayEntries
            : queueFilter === 'upcoming'
              ? cappedUpcomingEntries
              : completedEntries;

    return {
      totalPlans: plans.length,
      totalSessions,
      completedSessions,
      avgMastery: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null,
      missedCount: missedEntries.length,
      todayCount: todayEntries.length,
      upcomingCount: allUpcomingEntries.length,
      completedCount: completedEntries.length,
      actionableCount: missedEntries.length + todayEntries.length + allUpcomingEntries.length,
      hasHiddenUpcoming: cappedUpcomingEntries.length < allUpcomingEntries.length,
      nextScheduledEntry: actionableEntries[0] || null,
      filteredQueue,
    };
  }, [plans, queueFilter, showAllUpcoming]);

  const handleRescheduleSession = async (
    plan: StudyPlan,
    session: StudySession,
    resolutionMode: RecalibrationResolutionMode = 'auto'
  ) => {
    setReschedulingSessionId(session.id);
    try {
      const res = await rescheduleOverdueSession({
        plan,
        session,
        resolutionMode,
        cascadeRemaining: true,
        user: currentUser,
      });

      if (res.tier === 'deadline_squeeze') {
        setDeadlineSqueezeSessionId(session.id);
        return;
      }

      setDeadlineSqueezeSessionId(null);
      setPlans((prev) =>
        prev.map((p) => (p.id === res.updatedPlan.id ? res.updatedPlan : p))
      );

      const mergedInfo =
        res.mergedCount && res.mergedCount > 0
          ? ` and consolidated ${res.mergedCount} review session${res.mergedCount === 1 ? '' : 's'} into upcoming blocks`
          : '';
      const modeText =
        res.tier === 'tier3_final_sprint'
          ? `Consolidated remaining sessions of "${plan.topicTitle}" into a Final Sprint today (${formatLocalDate(new Date())}).`
          : res.tier === 'tier3_extended'
            ? `Extended "${plan.topicTitle}" Master-By deadline (+7 days) and recalibrated ${res.shiftedCount} pending session${res.shiftedCount === 1 ? '' : 's'}${mergedInfo}.`
            : `Shifted "${plan.topicTitle}" to today (${formatLocalDate(new Date())}) — recalibrated ${res.shiftedCount} pending session${res.shiftedCount === 1 ? '' : 's'}${mergedInfo}.`;
      setBannerNotice(modeText);
    } catch (err) {
      setBackendError(
        err instanceof Error ? err.message : 'Unable to reschedule session.'
      );
    } finally {
      setReschedulingSessionId(null);
    }
  };

  const handleLaunchSession = (planId: number, session: StudySession) => {
    setSelectedPlanId(planId);
    setActiveSessionId(session.id);
    navigate(`/?plan_id=${planId}&session_id=${session.id}`);
  };

  const handleBackToTimeline = () => {
    setActiveSessionId(null);
    if (selectedPlan) {
      navigate(`/?plan_id=${selectedPlan.id}`);
    } else {
      navigate('/');
    }
  };

  const handlePlanCreated = async (
    newPlan: StudyPlan,
    autoSyncMode: SyncMode,
    persistedInMySql: boolean
  ) => {
    setPlans((prev) => [newPlan, ...prev.filter((p) => p.id !== newPlan.id)]);
    setSelectedPlanId(newPlan.id);
    setActiveSessionId(null);
    navigate(`/?plan_id=${newPlan.id}`);
    setBackendLive((prev) => prev || persistedInMySql);
    if (persistedInMySql) {
      setBackendError(null);
    } else {
      setBackendError(
        'This study plan was cached in your browser only because Hostinger MySQL could not be reached.'
      );
    }

    const storageNote = persistedInMySql
      ? ' Saved to MySQL.'
      : ' Saved locally in browser cache (MySQL unavailable).';

    if (autoSyncMode === 'ics_download') {
      downloadPlanAsIcs(newPlan, newPlan.studyWindow);
      setBannerNotice(
        `Created "${newPlan.topicTitle}" and downloaded universal .ics schedule with embedded quiz deep links.${storageNote}`
      );
    } else if (
      autoSyncMode === 'google_calendar' &&
      googleClientId &&
      !googleClientId.startsWith('REPLACE_WITH_')
    ) {
      try {
        const res = await syncPlanToGoogleCalendar(
          newPlan,
          newPlan.studyWindow || {
            startHour: '09:00',
            endHour: '17:00',
            durationMinutes: 30,
            syncMode: 'google_calendar',
          },
          googleClientId
        );
        setBannerNotice(
          `Created "${newPlan.topicTitle}" and synced ${res.syncedCount} sessions to Google Calendar.${storageNote}`
        );
      } catch {
        setBannerNotice(
          `Created "${newPlan.topicTitle}". Click "Sync Timed Blocks to Google Calendar" in the timeline to authorize OAuth.${storageNote}`
        );
      }
    } else if (
      autoSyncMode === 'google_tasks' &&
      googleClientId &&
      !googleClientId.startsWith('REPLACE_WITH_')
    ) {
      try {
        const res = await syncPlanToGoogleTasks(newPlan, googleClientId);
        setBannerNotice(
          `Created "${newPlan.topicTitle}" and synced ${res.syncedCount} reminders to Google Tasks.${storageNote}`
        );
      } catch {
        setBannerNotice(
          `Created "${newPlan.topicTitle}". Click "Sync to Google Tasks" in the timeline to authorize OAuth.${storageNote}`
        );
      }
    } else {
      setBannerNotice(
        `Generated "${newPlan.topicTitle}" (${newPlan.sessions.length} Cepeda-spaced retrieval sessions).${storageNote}`
      );
    }
  };

  const handleDeletePlan = async (planId: number) => {
    const remaining = await deleteStudyPlan(planId, currentUser);
    setPlans(remaining);
    if (selectedPlanId === planId) {
      setSelectedPlanId(remaining[0]?.id || null);
      setActiveSessionId(null);
      setSearchParams({});
    }
  };

  const handleUpdateGoogleClientId = (clientId: string) => {
    setGoogleClientId(clientId);
    try {
      localStorage.setItem('sp_google_client_id', clientId);
    } catch {
      // Ignore storage error
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col transition-colors duration-150">
      {/* Top Application Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          {/* Logo and Navigation Links */}
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Link
              to="/"
              onClick={() => setActiveSessionId(null)}
              className="flex items-center gap-3 group focus:outline-none"
            >
              <img
                src="/study/logo.png"
                alt="Practice Buddy logo"
                className="h-9 w-9 rounded-lg object-contain transition-transform group-hover:scale-105"
              />
              <span className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                Practice Buddy
              </span>
            </Link>

            <nav aria-label="Primary" className="flex items-center gap-1.5">
              <Link
                to="/"
                onClick={() => setActiveSessionId(null)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  !isAboutView
                    ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Study Dashboard</span>
              </Link>
              <Link
                to="/about"
                onClick={() => setActiveSessionId(null)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  isAboutView
                    ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Info className="h-3.5 w-3.5" />
                <span>About</span>
              </Link>
            </nav>
          </div>

          {/* Right Header Controls: Engine Status, Theme, Account Pill, Primary Action */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <div className="hidden lg:flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900 px-3 py-1.5 text-xs">
              <Database className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-slate-500 dark:text-slate-400">Engine:</span>
              <span className="font-mono text-sky-700 dark:text-sky-300">
                {geminiModel}
              </span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  backendLive
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-300'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    backendLive ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
                {backendLive ? 'Hostinger MySQL Live' : 'Local Cache + API Ready'}
              </span>
            </div>

            {/* Light / Dark Theme Switcher */}
            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Switch to light theme'
                  : 'Switch to dark theme'
              }
              title={
                theme === 'dark'
                  ? 'Switch to Light Mode'
                  : 'Switch to Dark Mode'
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400 transition"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span className="hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-sky-600" />
                  <span className="hidden sm:inline">Dark</span>
                </>
              )}
            </button>

            {/* Account Pill / Switcher */}
            {!currentUser || currentUser.isGuest ? (
              <button
                type="button"
                onClick={() => {
                  setAuthModalMode('signin');
                  setIsAuthModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/70 transition"
              >
                <User className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>Guest Mode (Sign In / Save Account)</span>
              </button>
            ) : (
              <div ref={accountMenuRef} className="relative">
                <button
                  type="button"
                  aria-expanded={isAccountMenuOpen}
                  onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-900 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition"
                >
                  <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="max-w-[160px] truncate">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      isAccountMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isAccountMenuOpen && (
                  <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-xl z-40">
                    <div className="border-b border-slate-200 dark:border-slate-800 px-3 py-2 mb-1">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {currentUser.displayName}
                      </div>
                      {currentUser.email && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {currentUser.email}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        setAuthModalMode('signin');
                        setIsAuthModalOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Switch Account</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 transition"
            >
              <Plus className="h-4 w-4" />
              New Spaced Study Plan
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 space-y-6">
        {backendError && (
          <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                <strong>MySQL Connection Warning:</strong> {backendError}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setBackendError(null)}
              className="text-amber-700 dark:text-amber-300 hover:underline font-semibold ml-4 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {bannerNotice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{bannerNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline font-semibold ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Render About View, Active Session Workspace, or Dashboard */}
        {isAboutView ? (
          <AboutView
            onCreatePlan={() => setIsCreateModalOpen(true)}
            onGoToDashboard={() => navigate('/')}
          />
        ) : selectedPlan && activeSession ? (
          <SessionWorkspace
            plan={selectedPlan}
            session={activeSession}
            currentUser={currentUser}
            onBackToTimeline={handleBackToTimeline}
            onPlanUpdated={(updatedPlan, refreshedSession, recalibrated) => {
              setPlans((prev) =>
                prev.map((p) => (p.id === updatedPlan.id ? updatedPlan : p))
              );
              if (refreshedSession) {
                setActiveSessionId(refreshedSession.id);
              }
              if (recalibrated) {
                setBannerNotice(
                  'Completed your session and automatically recalibrated remaining pending sessions to keep you on track.'
                );
              }
            }}
          />
        ) : (
          <>
            {/* Top KPI & Next-Up Retrieval Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex items-center gap-3.5 shadow-xs">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Active Study Plans
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {metrics.totalPlans}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex items-center gap-3.5 shadow-xs">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Sessions Completed
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {metrics.completedSessions} / {metrics.totalSessions}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex items-center gap-3.5 shadow-xs">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-400">
                  <Award className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Mean Retrieval Mastery
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {metrics.avgMastery !== null
                      ? `${metrics.avgMastery}%`
                      : '—'}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex items-center gap-3.5 shadow-xs">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                  <Flame className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Next Scheduled Recall
                  </div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-[170px]">
                    {metrics.nextScheduledEntry
                      ? `${metrics.nextScheduledEntry.session.scheduledDate} (#${metrics.nextScheduledEntry.session.sessionNumber})`
                      : 'All Caught Up'}
                  </div>
                </div>
              </div>
            </div>

            {/* Study Queue */}
            {metrics.totalSessions > 0 && (
              <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-50/90 via-white to-sky-50/60 dark:from-emerald-950/35 dark:via-slate-900 dark:to-slate-900 p-4 sm:p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                    <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                      Study Queue
                    </h2>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        {
                          id: 'all_actionable' as QueueFilter,
                          label: 'All Actionable',
                          count: metrics.actionableCount,
                        },
                        {
                          id: 'missed' as QueueFilter,
                          label: 'Missed',
                          count: metrics.missedCount,
                        },
                        {
                          id: 'today' as QueueFilter,
                          label: 'Today',
                          count: metrics.todayCount,
                        },
                        {
                          id: 'upcoming' as QueueFilter,
                          label: 'Upcoming',
                          count: metrics.upcomingCount,
                        },
                        {
                          id: 'completed' as QueueFilter,
                          label: 'Completed',
                          count: metrics.completedCount,
                        },
                      ] as const
                    ).map((tab) => {
                      const active = queueFilter === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setQueueFilter(tab.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            active
                              ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-emerald-500/40'
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span
                            className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] ${
                              active
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {metrics.filteredQueue.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/60 px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    No sessions in this queue view yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {metrics.filteredQueue.map(({ plan, session, category, dayDelta }) => {
                      const isOverdue = category === 'missed';
                      const isDueToday = category === 'today';
                      const isUpcoming = category === 'upcoming';
                      const isCompleted = category === 'completed';
                      const isAdjusted = Boolean(
                        session.originalScheduledDate &&
                          session.scheduledDate !== session.originalScheduledDate
                      );
                      const showSqueezePrompt = deadlineSqueezeSessionId === session.id;

                      const cardContainerClass = isOverdue
                        ? 'border border-rose-200 dark:border-rose-900/60 border-l-4 border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/25'
                        : isDueToday
                          ? 'border border-emerald-200 dark:border-emerald-900/60 border-l-4 border-l-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/25'
                          : isUpcoming
                            ? 'border border-slate-200 dark:border-slate-800 border-l-4 border-l-slate-300 dark:border-l-slate-600 bg-white dark:bg-slate-950/80'
                            : 'opacity-75 hover:opacity-100 border border-slate-200 dark:border-slate-800 border-l-4 border-l-teal-500 bg-white dark:bg-slate-950/70 transition';

                      return (
                        <div
                          key={session.id}
                          className={`rounded-xl p-3.5 flex flex-col justify-between gap-3 shadow-2xs ${cardContainerClass}`}
                        >
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {isOverdue && (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                                    Ready to resume • {dayDelta}d behind
                                  </span>
                                )}
                                {isDueToday && (
                                  <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                                    Due Today
                                  </span>
                                )}
                                {isUpcoming && (
                                  <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                                    Upcoming • In {dayDelta} {dayDelta === 1 ? 'Day' : 'Days'} ({session.scheduledDate})
                                  </span>
                                )}
                                {isCompleted && (
                                  <span className="inline-flex items-center rounded-full bg-teal-100 dark:bg-teal-900/50 px-2.5 py-0.5 text-[11px] font-semibold text-teal-800 dark:text-teal-200">
                                    Completed
                                    {typeof session.masteryScore === 'number'
                                      ? ` • Score: ${session.masteryScore}%`
                                      : ''}
                                  </span>
                                )}
                                {isAdjusted && (
                                  <span className="inline-flex items-center rounded-full bg-teal-100/80 dark:bg-teal-950/60 px-2 py-0.5 text-[10px] font-medium text-teal-800 dark:text-teal-300">
                                    Adjusted to keep you on track
                                  </span>
                                )}
                              </div>

                              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                #{session.sessionNumber} • {session.scheduledDate}
                              </span>
                            </div>

                            <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {plan.topicTitle}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                              {session.stageName}
                            </div>
                          </div>

                          {showSqueezePrompt && (
                            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-white/90 dark:bg-slate-900 p-2.5 space-y-2 text-[11px]">
                              <div className="font-semibold text-amber-900 dark:text-amber-200">
                                Master-By date ({plan.masterByDate}) leaves zero future buffer days. Choose how to recalibrate:
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  disabled={reschedulingSessionId === session.id}
                                  onClick={() =>
                                    handleRescheduleSession(
                                      plan,
                                      session,
                                      'extend_7_days'
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition"
                                >
                                  Extend Master-By (+7 Days)
                                </button>
                                <button
                                  type="button"
                                  disabled={reschedulingSessionId === session.id}
                                  onClick={() =>
                                    handleRescheduleSession(
                                      plan,
                                      session,
                                      'final_sprint_today'
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-[11px] font-semibold text-rose-800 dark:text-rose-200 hover:bg-rose-100 disabled:opacity-50 transition"
                                >
                                  Run Final Sprint Today
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            {isOverdue && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleLaunchSession(plan.id, session)}
                                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 transition"
                                >
                                  <Play className="h-3 w-3 fill-current" />
                                  Catch Up Now
                                </button>
                                <button
                                  type="button"
                                  disabled={reschedulingSessionId === session.id}
                                  onClick={() =>
                                    handleRescheduleSession(plan, session, 'auto')
                                  }
                                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-300 dark:border-rose-800 bg-white/80 dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 disabled:opacity-50 transition"
                                >
                                  <CalendarClock className="h-3 w-3" />
                                  {reschedulingSessionId === session.id
                                    ? 'Shifting...'
                                    : 'Shift Plan to Today'}
                                </button>
                              </>
                            )}

                            {isDueToday && (
                              <button
                                type="button"
                                onClick={() => handleLaunchSession(plan.id, session)}
                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                              >
                                <Play className="h-3 w-3 fill-current" />
                                Start Session
                              </button>
                            )}

                            {isUpcoming && (
                              <button
                                type="button"
                                onClick={() => handleLaunchSession(plan.id, session)}
                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                              >
                                <Play className="h-3 w-3" />
                                Preview / Start Early
                              </button>
                            )}

                            {isCompleted && (
                              <button
                                type="button"
                                onClick={() => handleLaunchSession(plan.id, session)}
                                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-teal-300 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/30 px-3 py-1.5 text-xs font-semibold text-teal-800 dark:text-teal-200 hover:bg-teal-100/70 dark:hover:bg-teal-950/60 transition"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Review Session
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {(queueFilter === 'all_actionable' || queueFilter === 'upcoming') &&
                  (metrics.hasHiddenUpcoming || showAllUpcoming) &&
                  metrics.upcomingCount > 0 && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowAllUpcoming((prev) => !prev)}
                        className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        {showAllUpcoming
                          ? 'Show Fewer Upcoming Sessions'
                          : `Show All Upcoming (${metrics.upcomingCount})`}
                      </button>
                    </div>
                  )}
              </div>
            )}

            {/* Plan Switcher Tabs */}
            {plans.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {plans.map((p) => {
                  const active = selectedPlan?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPlanId(p.id);
                        setSearchParams({ plan_id: String(p.id) });
                      }}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold whitespace-nowrap transition ${
                        active
                          ? 'border-emerald-600 dark:border-emerald-400 bg-emerald-500/15 text-emerald-900 dark:text-white'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      <Calendar className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{p.topicTitle}</span>
                      <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:text-slate-300">
                        {p.sessions.filter((s) => s.status !== 'merged').length}s
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected Plan Timeline */}
            {selectedPlan ? (
              <PlanTimeline
                plan={selectedPlan}
                googleClientId={googleClientId}
                onUpdateGoogleClientId={handleUpdateGoogleClientId}
                onLaunchSession={(session) =>
                  handleLaunchSession(selectedPlan.id, session)
                }
                onDeletePlan={handleDeletePlan}
              />
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center space-y-4 shadow-xs">
                <Clock className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Welcome to Practice Buddy — No Active Study Plans Yet
                </h2>
                <p className="mx-auto max-w-md text-xs text-slate-600 dark:text-slate-400">
                  Upload your lecture PDFs, DOCX files, slides, or URLs and set
                  your &ldquo;Master By&rdquo; target date to generate a
                  Cepeda-optimal spaced retrieval schedule.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                >
                  <Plus className="h-4 w-4" />
                  Create First Spaced Study Plan
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white/60 dark:bg-slate-950/60 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
        Practice Buddy — Evidence-Based Spaced Retrieval &amp; Feynman Teach-Back Studio
      </footer>

      {/* Create Plan Modal */}
      <CreatePlanModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        currentUser={currentUser}
        onPlanCreated={handlePlanCreated}
      />

      {/* Sign In / Register Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        googleClientId={googleClientId}
        initialMode={authModalMode}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
};
