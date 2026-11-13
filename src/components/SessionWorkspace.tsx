import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BookOpen,
  CalendarPlus,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  History,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Unlock,
} from 'lucide-react';
import {
  GradeRecallEvaluation,
  StudyPlan,
  StudySession,
} from '../types/study';
import {
  scheduleAdaptiveBoosterSession,
  submitRecallForGrading,
} from '../services/apiClient';
import {
  buildGoogleCalendarTemplateUrl,
  buildSessionDeepLink,
} from '../utils/calendarSync';

interface SessionWorkspaceProps {
  plan: StudyPlan;
  session: StudySession;
  onBackToTimeline: () => void;
  onPlanUpdated: (updatedPlan: StudyPlan, nextSession?: StudySession) => void;
}

// TypeScript interface for Web Speech API (SpeechRecognition / webkitSpeechRecognition)
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export const SessionWorkspace: React.FC<SessionWorkspaceProps> = ({
  plan,
  session,
  onBackToTimeline,
  onPlanUpdated,
}) => {
  // 1. Closed-Book Lock Screen state (locked by default for genuine retrieval)
  const [isSourceUnlocked, setIsSourceUnlocked] = useState(false);

  // 2. User active-recall response & Socratic follow-up
  const [responseText, setResponseText] = useState('');
  const [socraticReply, setSocraticReply] = useState('');

  // 3. Web Speech API Voice Dictation state
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // 4. AI Rubric Grading & Adaptive Booster state
  const [isGrading, setIsGrading] = useState(false);
  const [evaluation, setEvaluation] = useState<GradeRecallEvaluation | null>(
    null
  );
  const [isSchedulingBooster, setIsSchedulingBooster] = useState(false);
  const [boosterCreatedSession, setBoosterCreatedSession] =
    useState<StudySession | null>(null);

  // Initialize from most recent attempt if session was already completed
  useEffect(() => {
    setIsSourceUnlocked(false);
    setBoosterCreatedSession(null);
    setSocraticReply('');

    const latestAttempt = session.attempts?.[0];
    if (latestAttempt) {
      setResponseText(latestAttempt.userResponseText);
      setEvaluation({
        masteryScore: latestAttempt.aiScore,
        accuratePoints: latestAttempt.strengths,
        missedOrInaccurateConcepts: latestAttempt.missingConcepts,
        coachFeedback: latestAttempt.correctiveFeedback,
        socraticFollowUpQuestion: latestAttempt.followUpQuestion,
        recommendAdaptiveExtraSession: latestAttempt.aiScore < 70,
      });
    } else {
      setResponseText('');
      setEvaluation(null);
    }
  }, [session.id]);

  // Cleanup Web Speech API on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore stop errors
        }
      }
    };
  }, []);

  const toggleVoiceDictation = () => {
    setSpeechError(null);

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      setInterimTranscript('');
      return;
    }

    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    if (typeof SpeechRecognitionCtor !== 'function') {
      setSpeechError(
        'Web Speech API voice dictation is not supported in this browser. Try Chrome or Edge.'
      );
      return;
    }

    const recognition =
      new (SpeechRecognitionCtor as new () => SpeechRecognitionInstance)();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalChunk += res[0].transcript + ' ';
        } else {
          interimChunk += res[0].transcript;
        }
      }

      if (finalChunk) {
        setResponseText((prev) =>
          (prev ? prev.trimEnd() + ' ' : '') + finalChunk.trim()
        );
      }
      setInterimTranscript(interimChunk);
    };

    recognition.onerror = (event) => {
      setSpeechError(`Microphone dictation error: ${event.error}`);
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleGradeSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    const combinedText = socraticReply.trim()
      ? `${responseText.trim()}\n\n[Socratic Follow-Up Response]: ${socraticReply.trim()}`
      : responseText.trim();

    if (!combinedText) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setIsGrading(true);
    try {
      const { evaluation: resultEval, updatedPlan } =
        await submitRecallForGrading({
          plan,
          session,
          userResponseText: combinedText,
        });
      setEvaluation(resultEval);
      setResponseText(combinedText);
      setSocraticReply('');
      setIsSourceUnlocked(true); // Automatically unlock source digest & rubric after genuine attempt
      const refreshedSession = updatedPlan.sessions.find(
        (s) => s.id === session.id
      );
      onPlanUpdated(updatedPlan, refreshedSession);
    } finally {
      setIsGrading(false);
    }
  };

  const handleScheduleAdaptiveBooster = async () => {
    if (!evaluation) return;
    setIsSchedulingBooster(true);
    try {
      const { updatedPlan, newSession } = await scheduleAdaptiveBoosterSession({
        plan,
        session,
        missingConcepts: evaluation.missedOrInaccurateConcepts,
        followUpQuestion: evaluation.socraticFollowUpQuestion,
      });
      setBoosterCreatedSession(newSession);
      onPlanUpdated(updatedPlan);
    } finally {
      setIsSchedulingBooster(false);
    }
  };

  const wordCount = responseText
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const isFeynmanStage =
    session.stageName.toLowerCase().includes('feynman') ||
    session.stageName.toLowerCase().includes('mastery verification');

  return (
    <div className="space-y-6">
      {/* Top Navigation & Session Stage Banner */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm dark:shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <button
            type="button"
            onClick={onBackToTimeline}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Plan Timeline
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-1 font-mono text-xs text-slate-700 dark:text-slate-300">
              Deep Link: {buildSessionDeepLink(plan.id, session.id)}
            </span>
            <button
              type="button"
              onClick={() => setIsSourceUnlocked((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition ${
                isSourceUnlocked
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
              }`}
            >
              {isSourceUnlocked ? (
                <>
                  <Unlock className="h-3.5 w-3.5" />
                  Source Material &amp; Rubric Unlocked
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Closed-Book Retrieval Lock Active
                </>
              )}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span>{plan.topicTitle}</span>
            <span>•</span>
            <span>
              Session #{session.sessionNumber} (Day {session.dayOffset}, Gap +
              {session.gapDays}d)
            </span>
            <span>•</span>
            <span>Scheduled: {session.scheduledDate}</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            {session.stageName}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {session.cognitiveGoal}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Active-Recall Prompts & Interactive Input Studio */}
        <div className="lg:col-span-2 space-y-6">
          {/* Prompts Card */}
          <div className="rounded-2xl border border-emerald-500/30 bg-white dark:bg-slate-900/95 p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                {isFeynmanStage
                  ? 'Feynman Teach-Back Studio Challenge'
                  : 'Assigned Closed-Book Active-Recall Prompts'}
              </h3>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                No Passive Re-Reading
              </span>
            </div>

            <ol className="space-y-3">
              {session.prompts.map((prompt, idx) => (
                <li
                  key={idx}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 p-4 text-sm text-slate-800 dark:text-slate-100 leading-relaxed flex items-start gap-3"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {idx + 1}
                  </span>
                  <span>{prompt}</span>
                </li>
              ))}
            </ol>

            {/* Interactive Recall Input + Web Speech API Dictation */}
            <form onSubmit={handleGradeSubmission} className="space-y-4 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="active-recall-textarea"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
                >
                  Your Closed-Book Retrieval / Teach-Back Response
                </label>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {wordCount} words
                  </span>
                  <button
                    type="button"
                    onClick={toggleVoiceDictation}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                      isListening
                        ? 'border-rose-500 bg-rose-500/20 text-rose-700 dark:text-rose-200 animate-pulse'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {isListening ? (
                      <>
                        <MicOff className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
                        Stop Dictation (Recording...)
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Dictate via Web Speech API
                      </>
                    )}
                  </button>
                </div>
              </div>

              <textarea
                id="active-recall-textarea"
                rows={8}
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder={
                  isFeynmanStage
                    ? 'Explain the core concepts from scratch in plain, vivid language as if teaching an intelligent beginner. Avoid hiding behind undefined jargon...'
                    : 'Type or dictate everything you can retrieve from long-term memory for each prompt above before unlocking the source digest...'
                }
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 leading-relaxed focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />

              {interimTranscript && (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200 italic">
                  Live voice stream: &ldquo;{interimTranscript}&rdquo;
                </div>
              )}

              {speechError && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  {speechError}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Graded by <code>gemini-3.8-flash</code> against your cached{' '}
                  <code>extracted_context_cache</code> &amp; session rubric.
                </p>

                <button
                  type="submit"
                  disabled={isGrading || !responseText.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-50 transition"
                >
                  {isGrading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Evaluating Retrieval via Gemini...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Grade Active-Recall Response
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* AI Rubric Evaluation Result Card */}
          {evaluation && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6 shadow-sm dark:shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl border font-mono text-lg font-extrabold ${
                      evaluation.masteryScore >= 80
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : evaluation.masteryScore >= 70
                        ? 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300'
                        : 'border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {evaluation.masteryScore}%
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Award className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      Practice Buddy Rubric Assessment
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {evaluation.masteryScore >= 80
                        ? 'High Mastery — Synaptic trace consolidated for expanding interval.'
                        : evaluation.masteryScore >= 70
                        ? 'Competent Retrieval — Review missed nuances below to solidify.'
                        : 'Fragile Retrieval (< 70%) — Adaptive Booster Session (+2 Days) recommended.'}
                    </p>
                  </div>
                </div>

                {/* Adaptive Spacing Hook when masteryScore < 70 */}
                {(evaluation.masteryScore < 70 ||
                  evaluation.recommendAdaptiveExtraSession) && (
                  <div>
                    {boosterCreatedSession ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          Booster Scheduled for{' '}
                          <strong>{boosterCreatedSession.scheduledDate}</strong>
                        </span>
                        <a
                          href={buildGoogleCalendarTemplateUrl(
                            plan,
                            boosterCreatedSession,
                            plan.studyWindow
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="underline font-semibold text-emerald-700 dark:text-emerald-300 ml-1"
                        >
                          + Add to Google Calendar
                        </a>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleScheduleAdaptiveBooster}
                        disabled={isSchedulingBooster}
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-400 disabled:opacity-60 transition"
                      >
                        {isSchedulingBooster ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CalendarPlus className="h-4 w-4" />
                        )}
                        Schedule Adaptive Booster Session (+2 Days)
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Strengths & Missed Concepts Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/15 p-4 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Accurate Retrieval Points ({evaluation.accuratePoints.length})
                  </h4>
                  <ul className="space-y-1.5 text-xs text-emerald-950 dark:text-emerald-100/90">
                    {evaluation.accuratePoints.map((pt, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                          ✓
                        </span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/15 p-4 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4" />
                    Missed or Incomplete Concepts (
                    {evaluation.missedOrInaccurateConcepts.length})
                  </h4>
                  {evaluation.missedOrInaccurateConcepts.length === 0 ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      Zero critical omissions detected!
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-amber-950 dark:text-amber-100/90">
                      {evaluation.missedOrInaccurateConcepts.map((miss, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-amber-600 dark:text-amber-400 font-bold">
                            •
                          </span>
                          <span>{miss}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Corrective Coach Feedback */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  Practice Buddy Coach Corrective Synthesis
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                  {evaluation.coachFeedback}
                </p>
              </div>

              {/* Interactive Socratic Follow-Up Question */}
              {evaluation.socraticFollowUpQuestion && (
                <div className="rounded-xl border border-sky-500/40 bg-sky-50/70 dark:bg-sky-950/20 p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <HelpCircle className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                        Socratic Follow-Up Probe
                      </h4>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">
                        {evaluation.socraticFollowUpQuestion}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={socraticReply}
                      onChange={(e) => setSocraticReply(e.target.value)}
                      placeholder="Answer the Socratic follow-up to boost your mastery score..."
                      className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-emerald-600 dark:focus:border-emerald-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isGrading || !socraticReply.trim()}
                      onClick={(e) => void handleGradeSubmission(e)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Re-Evaluate
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Closed-Book Lock Screen + Verification Checklist + Attempt History */}
        <div className="space-y-6">
          {/* Closed-Book Verification Rubric & Source Digest Card */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Verification Rubric &amp; Source Digest
              </h3>
              <button
                type="button"
                onClick={() => setIsSourceUnlocked((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-300"
              >
                {isSourceUnlocked ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" /> Lock
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Peek
                  </>
                )}
              </button>
            </div>

            {!isSourceUnlocked ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/90 p-6 text-center space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  <Lock className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  Closed-Book Retrieval Shield Active
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Roediger &amp; Karpicke (2006) demonstrated that consulting
                  notes before retrieving creates an{' '}
                  <strong className="text-slate-900 dark:text-slate-200">
                    illusion of competence
                  </strong>
                  . Submit your closed-book recall first to automatically unlock
                  the rubric and source digest.
                </p>
                <button
                  type="button"
                  onClick={() => setIsSourceUnlocked(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  <Unlock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Override &amp; Peek Source Material
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-2">
                    Mastery Verification Checklist:
                  </h4>
                  <ul className="space-y-2">
                    {session.verificationChecklist.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2.5 text-xs text-slate-800 dark:text-slate-200"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-1.5">
                    Cached Source Digest (<code>extracted_context_cache</code>):
                  </h4>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {plan.extractedContextCache}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Past Recall Attempts History (`recall_attempts` table) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <History className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              Session Recall Attempt Log ({session.attempts?.length || 0})
            </h3>

            {!session.attempts || session.attempts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No graded attempts logged for this session yet.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {session.attempts.map((att) => (
                  <div
                    key={att.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${
                          att.aiScore >= 80
                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                            : att.aiScore >= 70
                            ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
                            : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {att.aiScore}% Mastery
                      </span>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {att.createdAt}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-3">
                      {att.userResponseText}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
