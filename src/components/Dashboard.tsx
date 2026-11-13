import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Flame,
  Moon,
  Plus,
  Play,
  Sparkles,
  Sun,
} from 'lucide-react';
import { StudyPlan, StudySession, SyncMode } from '../types/study';
import {
  deleteStudyPlan,
  fetchAllPlans,
} from '../services/apiClient';
import {
  downloadPlanAsIcs,
  syncPlanToGoogleCalendar,
  syncPlanToGoogleTasks,
} from '../utils/calendarSync';
import { formatLocalDate } from '../utils/spacingEngine';
import { CreatePlanModal } from './CreatePlanModal';
import { PlanTimeline } from './PlanTimeline';
import { SessionWorkspace } from './SessionWorkspace';

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

export const Dashboard: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveCurrentTheme());
  const [plans, setPlans] = useState<StudyPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [backendLive, setBackendLive] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-3.8-flash');
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

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

  // Load plans on mount & resolve deep-link query params (?plan_id=X&session_id=Y)
  useEffect(() => {
    void (async () => {
      const init = await fetchAllPlans();
      setPlans(init.plans);
      setBackendLive(init.backendLive);
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

  // Global metrics across all plans
  const metrics = useMemo(() => {
    const today = formatLocalDate(new Date());
    let totalSessions = 0;
    let completedSessions = 0;
    let scoreSum = 0;
    let scoredCount = 0;
    const dueOrNextSessions: Array<{ plan: StudyPlan; session: StudySession }> =
      [];

    for (const p of plans) {
      for (const s of p.sessions) {
        totalSessions++;
        if (s.status === 'completed') {
          completedSessions++;
        } else if (s.scheduledDate <= today || dueOrNextSessions.length < 3) {
          dueOrNextSessions.push({ plan: p, session: s });
        }
        if (typeof s.masteryScore === 'number') {
          scoreSum += s.masteryScore;
          scoredCount++;
        }
      }
    }

    return {
      totalPlans: plans.length,
      totalSessions,
      completedSessions,
      avgMastery: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null,
      dueOrNextSessions: dueOrNextSessions.slice(0, 3),
    };
  }, [plans]);

  const handleLaunchSession = (planId: number, session: StudySession) => {
    setSelectedPlanId(planId);
    setActiveSessionId(session.id);
    setSearchParams({
      plan_id: String(planId),
      session_id: String(session.id),
    });
  };

  const handleBackToTimeline = () => {
    setActiveSessionId(null);
    if (selectedPlan) {
      setSearchParams({ plan_id: String(selectedPlan.id) });
    } else {
      setSearchParams({});
    }
  };

  const handlePlanCreated = async (
    newPlan: StudyPlan,
    autoSyncMode: SyncMode
  ) => {
    setPlans((prev) => [newPlan, ...prev.filter((p) => p.id !== newPlan.id)]);
    setSelectedPlanId(newPlan.id);
    setActiveSessionId(null);
    setSearchParams({ plan_id: String(newPlan.id) });

    if (autoSyncMode === 'ics_download') {
      downloadPlanAsIcs(newPlan, newPlan.studyWindow);
      setBannerNotice(
        `Created "${newPlan.topicTitle}" and downloaded universal .ics schedule with embedded quiz deep links.`
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
          `Created "${newPlan.topicTitle}" and synced ${res.syncedCount} sessions to Google Calendar.`
        );
      } catch {
        setBannerNotice(
          `Created "${newPlan.topicTitle}". Click "Sync Timed Blocks to Google Calendar" in the timeline to authorize OAuth.`
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
          `Created "${newPlan.topicTitle}" and synced ${res.syncedCount} reminders to Google Tasks.`
        );
      } catch {
        setBannerNotice(
          `Created "${newPlan.topicTitle}". Click "Sync to Google Tasks" in the timeline to authorize OAuth.`
        );
      }
    } else {
      setBannerNotice(
        `Generated "${newPlan.topicTitle}" (${newPlan.sessions.length} Cepeda-spaced retrieval sessions).`
      );
    }
  };

  const handleDeletePlan = async (planId: number) => {
    const remaining = await deleteStudyPlan(planId);
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          {/* Logo and Title Area linking to index.html */}
          <a
            href="/study/index.html"
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
          </a>

          {/* Right Header Controls: Engine Status, Light/Dark Toggle, Primary Action */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="hidden md:flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-900 px-3 py-1.5 text-xs">
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

            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 transition"
            >
              <Plus className="h-4 w-4" />
              New Spaced Study Plan
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 space-y-6">
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

        {/* If a session is active, render SessionWorkspace */}
        {selectedPlan && activeSession ? (
          <SessionWorkspace
            plan={selectedPlan}
            session={activeSession}
            onBackToTimeline={handleBackToTimeline}
            onPlanUpdated={(updatedPlan, refreshedSession) => {
              setPlans((prev) =>
                prev.map((p) => (p.id === updatedPlan.id ? updatedPlan : p))
              );
              if (refreshedSession) {
                setActiveSessionId(refreshedSession.id);
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
                    {metrics.dueOrNextSessions[0]
                      ? `${metrics.dueOrNextSessions[0].session.scheduledDate} (#${metrics.dueOrNextSessions[0].session.sessionNumber})`
                      : 'All Caught Up'}
                  </div>
                </div>
              </div>
            </div>

            {/* Priority Retrieval Queue (Quick Launch) */}
            {metrics.dueOrNextSessions.length > 0 && (
              <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-50/90 via-white to-sky-50/60 dark:from-emerald-950/35 dark:via-slate-900 dark:to-slate-900 p-4 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <Activity className="h-4 w-4" />
                    Priority Active-Recall Queue (Ready to Launch)
                  </h2>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Practice Buddy Closed-Book Studio
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {metrics.dueOrNextSessions.map(({ plan, session }) => (
                    <div
                      key={session.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 p-3.5 flex flex-col justify-between gap-3 shadow-2xs"
                    >
                      <div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-sky-700 dark:text-sky-400 mb-1">
                          <span>
                            Session #{session.sessionNumber} • Day{' '}
                            {session.dayOffset}
                          </span>
                          <span>{session.scheduledDate}</span>
                        </div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {plan.topicTitle}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {session.stageName}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLaunchSession(plan.id, session)}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        Launch Practice Session
                      </button>
                    </div>
                  ))}
                </div>
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
                        {p.sessions.length}s
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
        onPlanCreated={handlePlanCreated}
      />
    </div>
  );
};
