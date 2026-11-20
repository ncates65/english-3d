import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  CheckSquare,
  Clock,
  Database,
  Download,
  ExternalLink,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Play,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { StudyPlan, StudySession } from '../types/study';
import {
  STAGE_GUIDANCE_CONFIG,
  calculateSpacedSchedule,
  normalizeStageName,
  resolveStageNumber,
} from '../utils/spacingEngine';
import {
  buildGoogleCalendarTemplateUrl,
  buildSessionDeepLink,
  downloadPlanAsIcs,
  syncPlanToGoogleCalendar,
  syncPlanToGoogleTasks,
} from '../utils/calendarSync';

interface PlanTimelineProps {
  plan: StudyPlan;
  googleClientId: string;
  onUpdateGoogleClientId: (clientId: string) => void;
  onLaunchSession: (session: StudySession) => void;
  onDeletePlan: (planId: number) => void;
}

export const PlanTimeline: React.FC<PlanTimelineProps> = ({
  plan,
  googleClientId,
  onUpdateGoogleClientId,
  onLaunchSession,
  onDeletePlan,
}) => {
  const [showDigest, setShowDigest] = useState(false);
  const [showOAuthConfig, setShowOAuthConfig] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState(googleClientId);
  const [syncStatus, setSyncStatus] = useState<{
    loading: boolean;
    message: string | null;
    isError: boolean;
  }>({ loading: false, message: null, isError: false });
  const [copiedSessionId, setCopiedSessionId] = useState<number | null>(null);

  const spacingMeta = calculateSpacedSchedule(
    plan.startDate,
    plan.masterByDate
  );

  const completedCount = plan.sessions.filter(
    (s) => s.status === 'completed'
  ).length;
  const scoredSessions = plan.sessions.filter(
    (s) => typeof s.masteryScore === 'number'
  );
  const avgMastery =
    scoredSessions.length > 0
      ? Math.round(
          scoredSessions.reduce((acc, s) => acc + (s.masteryScore || 0), 0) /
            scoredSessions.length
        )
      : null;

  const handleCopyDeepLink = async (session: StudySession) => {
    const url = buildSessionDeepLink(plan.id, session.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSessionId(session.id);
      setTimeout(() => setCopiedSessionId(null), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleGoogleCalendarBatchSync = async () => {
    setSyncStatus({ loading: true, message: null, isError: false });
    try {
      const windowCfg = plan.studyWindow || {
        startHour: '09:00',
        endHour: '17:00',
        durationMinutes: 30,
        syncMode: 'google_calendar',
      };
      const res = await syncPlanToGoogleCalendar(
        plan,
        windowCfg,
        googleClientId
      );
      setSyncStatus({
        loading: false,
        message: `Synced ${res.syncedCount} sessions to Google Calendar (${res.conflictsAvoided} FreeBusy conflict(s) automatically avoided).`,
        isError: false,
      });
    } catch (err) {
      setSyncStatus({
        loading: false,
        message:
          err instanceof Error
            ? err.message
            : 'Google Calendar OAuth sync failed.',
        isError: true,
      });
      setShowOAuthConfig(true);
    }
  };

  const handleGoogleTasksBatchSync = async () => {
    setSyncStatus({ loading: true, message: null, isError: false });
    try {
      const res = await syncPlanToGoogleTasks(plan, googleClientId);
      setSyncStatus({
        loading: false,
        message: `Synced ${res.syncedCount} active-recall reminders with deep links to Google Tasks.`,
        isError: false,
      });
    } catch (err) {
      setSyncStatus({
        loading: false,
        message:
          err instanceof Error
            ? err.message
            : 'Google Tasks OAuth sync failed.',
        isError: true,
      });
      setShowOAuthConfig(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Plan Overview Banner */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-sm dark:shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 border border-sky-500/30 px-3 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                <Calendar className="h-3.5 w-3.5" />
                {spacingMeta.horizonLabel}
              </span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-0.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                {plan.startDate} → {plan.masterByDate}
              </span>
              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {completedCount}/{plan.sessions.length} Completed
              </span>
              {avgMastery !== null && (
                <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Avg Mastery: {avgMastery}%
                </span>
              )}
            </div>

            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              {plan.topicTitle}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {plan.executiveSummary}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDigest((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <Database className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {showDigest ? 'Hide Source Digest' : 'View Context Cache'}
            </button>
            <button
              type="button"
              onClick={() => onDeletePlan(plan.id)}
              title="Delete Study Plan"
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 transition"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Ultra-Short Horizon Compressed Warning */}
        {spacingMeta.isCompressedWarning && spacingMeta.warningMessage && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-800 dark:text-amber-300">
                Compressed Horizon Alert:{' '}
              </span>
              {spacingMeta.warningMessage}
            </div>
          </div>
        )}

        {/* Extracted Context Cache Viewer (`study_plans.extracted_context_cache`) */}
        {showDigest && (
          <div className="mt-5 rounded-xl border border-emerald-500/30 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <BookOpen className="h-4 w-4" />
                <span>
                  MySQL <code>study_plans.extracted_context_cache</code> (Used by
                  Gemini 3.8 Flash during Closed-Book Quiz Grading)
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {plan.extractedContextCache.length.toLocaleString()} chars cached
              </span>
            </div>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
              {plan.extractedContextCache}
            </pre>
            {plan.sourceLinks && plan.sourceLinks.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Source Links:
                </span>
                {plan.sourceLinks.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-sky-700 dark:text-sky-300 hover:border-sky-500/40"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate max-w-xs">
                      {link.title || link.url}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Core Conceptual Pillars (`core_concepts_json`) */}
        {plan.coreConcepts && plan.coreConcepts.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Core Conceptual Schema Map ({plan.coreConcepts.length} Pillars)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {plan.coreConcepts.map((concept, idx) => (
                <div
                  key={concept.id || idx}
                  className="rounded-xl border border-slate-200 dark:border-slate-800/90 bg-slate-50/80 dark:bg-slate-950/70 p-3.5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/20 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                        P{idx + 1}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                        {concept.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {concept.summary}
                    </p>
                  </div>
                  {concept.connections && (
                    <div className="mt-3 border-t border-slate-200 dark:border-slate-800/80 pt-2 text-[11px] text-sky-700 dark:text-sky-300/90">
                      <strong className="text-slate-500 dark:text-slate-400">
                        Schema Link:
                      </strong>{' '}
                      {concept.connections}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Google Calendar / Google Tasks / .ics Sync Bar */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleGoogleCalendarBatchSync}
              disabled={syncStatus.loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60 transition"
            >
              {syncStatus.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Calendar className="h-3.5 w-3.5" />
              )}
              Sync Timed Blocks to Google Calendar (FreeBusy)
            </button>

            <button
              type="button"
              onClick={handleGoogleTasksBatchSync}
              disabled={syncStatus.loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 transition"
            >
              <CheckSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Sync to Google Tasks
            </button>

            <button
              type="button"
              onClick={() => downloadPlanAsIcs(plan, plan.studyWindow)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <Download className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              Download Universal .ics
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowOAuthConfig((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition"
          >
            <KeyRound className="h-3.5 w-3.5" />
            OAuth Client ID
          </button>
        </div>

        {showOAuthConfig && (
          <div className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px]">
              <label
                htmlFor="google-oauth-client-id-input"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Google OAuth2 Web Client ID (for one-click FreeBusy Calendar &amp; Tasks batch sync)
              </label>
              <input
                id="google-oauth-client-id-input"
                type="text"
                value={clientIdDraft}
                onChange={(e) => setClientIdDraft(e.target.value)}
                placeholder="1234567890-abcdefg.apps.googleusercontent.com"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white font-mono"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onUpdateGoogleClientId(clientIdDraft.trim());
                setShowOAuthConfig(false);
              }}
              className="rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 mt-4"
            >
              Save Client ID
            </button>
          </div>
        )}

        {syncStatus.message && (
          <div
            className={`mt-3 rounded-xl border px-4 py-2.5 text-xs ${
              syncStatus.isError
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            {syncStatus.message}
          </div>
        )}
      </div>

      {/* Spaced Retrieval Sessions Timeline */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Scheduled Active-Recall &amp; Feynman Teach-Back Sessions
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {spacingMeta.cepedaOptimalIsiRatio}
          </span>
        </div>

        <div className="space-y-4">
          {plan.sessions.map((session) => {
            const isCompleted = session.status === 'completed';
            const deepLink = buildSessionDeepLink(plan.id, session.id);
            const gcalTemplateUrl = buildGoogleCalendarTemplateUrl(
              plan,
              session,
              plan.studyWindow
            );
            const isBooster = session.stageName
              .toLowerCase()
              .includes('booster');

            return (
              <div
                key={session.id}
                className={`rounded-2xl border p-5 transition shadow-xs ${
                  isCompleted
                    ? 'border-emerald-500/35 bg-white dark:bg-slate-900/75'
                    : isBooster
                    ? 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/15'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Session #{session.sessionNumber}
                      </span>
                      <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 font-mono text-xs text-slate-700 dark:text-slate-200">
                        {session.scheduledDate} (Day {session.dayOffset})
                      </span>
                      {session.gapDays > 0 && (
                        <span className="rounded-lg bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 font-mono text-xs text-sky-700 dark:text-sky-300">
                          +{session.gapDays}d Expanding Gap
                        </span>
                      )}
                      {isCompleted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Completed
                          {typeof session.masteryScore === 'number' &&
                            ` • ${session.masteryScore}% Mastery`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                          <Clock className="h-3 w-3" />
                          Scheduled Retrieval
                        </span>
                      )}
                    </div>

                    <h4 className="text-base font-bold text-slate-900 dark:text-white">
                      {normalizeStageName(session.stageName)}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      <strong className="text-slate-500 dark:text-slate-400">
                        Cognitive Goal:
                      </strong>{' '}
                      {session.cognitiveGoal}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyDeepLink(session)}
                      title={`Copy Calendar Deep Link: ${deepLink}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition"
                    >
                      {copiedSessionId === session.id ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          Copied Deep Link
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          Deep Link
                        </>
                      )}
                    </button>

                    <a
                      href={gcalTemplateUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition"
                    >
                      <Calendar className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                      + Google Cal
                    </a>

                    <button
                      type="button"
                      onClick={() => onLaunchSession(session)}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 transition"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      {isCompleted
                        ? 'Re-Practice / View AI Evaluation'
                        : 'Launch Practice Session'}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Preview of Active-Recall Prompts */}
                <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800/90 bg-slate-50 dark:bg-slate-950/70 p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    <span>
                      {STAGE_GUIDANCE_CONFIG[resolveStageNumber(session)].sectionHeader}{' '}
                      ({session.prompts.length})
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      Deep Link: ?plan_id={plan.id}&amp;session_id={session.id}
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-200">
                    {session.prompts.map((prompt, pIdx) => (
                      <li key={pIdx} className="flex items-start gap-2">
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">
                          Q{pIdx + 1}.
                        </span>
                        <span>{prompt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
