import React from 'react';
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Compass,
  FileText,
  Globe,
  Layers,
  Sparkles,
} from 'lucide-react';
import { STAGE_GUIDANCE_CONFIG } from '../utils/spacingEngine';

interface AboutViewProps {
  onCreatePlan: () => void;
  onGoToDashboard: () => void;
}

const STAGE_VISUAL_ACCENTS: Record<
  1 | 2 | 3 | 4 | 5,
  { badge: string; border: string; iconBg: string }
> = {
  1: {
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-900/60',
    iconBg: 'bg-gradient-to-br from-emerald-600 to-teal-600 text-white',
  },
  2: {
    badge: 'bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-900/60',
    iconBg: 'bg-gradient-to-br from-teal-600 to-sky-600 text-white',
  },
  3: {
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
    border: 'border-sky-200 dark:border-sky-900/60',
    iconBg: 'bg-gradient-to-br from-sky-600 to-emerald-600 text-white',
  },
  4: {
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-900/60',
    iconBg: 'bg-gradient-to-br from-amber-600 to-emerald-600 text-white',
  },
  5: {
    badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200',
    border: 'border-emerald-300 dark:border-emerald-800',
    iconBg: 'bg-gradient-to-br from-emerald-700 to-teal-700 text-white',
  },
};

export const AboutView: React.FC<AboutViewProps> = ({
  onCreatePlan,
  onGoToDashboard,
}) => {
  const stages = ([1, 2, 3, 4, 5] as const).map((num) => ({
    num,
    config: STAGE_GUIDANCE_CONFIG[num],
    accent: STAGE_VISUAL_ACCENTS[num],
  }));

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <section className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-50 via-white to-sky-50 dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-900 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              Evidence-Based Active Recall Platform
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              About Practice Buddy
            </h1>
            <p className="text-sm sm:text-base italic font-medium text-emerald-700 dark:text-emerald-300">
              Cepeda et al. (2008) Optimal Spacing Engine + Gemini Flash Cognitive Scaffolding
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Practice Buddy transforms syllabi, documents, and lecture links into structured,
              closed-book active-recall sessions timed right before natural forgetting sets in—moving
              you systematically from initial mental schema construction to effortless Feynman mastery.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onCreatePlan}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-emerald-500 transition"
            >
              <Sparkles className="h-4 w-4" />
              Create a Study Plan
            </button>
            <button
              type="button"
              onClick={onGoToDashboard}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              Study Dashboard
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Section 1: Science of Optimal Spacing */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              1. The Science of Optimal Spacing
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Grounded in Cepeda, Vul, Rohrer, Wixted, &amp; Pashler (2008) distributed practice research
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Target Retention Horizon (T)
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Instead of fixed guesses, Practice Buddy takes your exact start date (Day 0) and
              target exam or mastery deadline (Day T) to compute expanding retrieval intervals—targeting
              an optimal inter-session gap relative to your overall retention window.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Closed-Book Desirable Difficulty
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Every session locks reference notes during your retrieval attempt so your brain must
              reconstruct pathways from scratch—producing stronger synaptic consolidation than passive
              re-reading, followed immediately by source-grounded AI rubric feedback.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Adaptive Rescue &amp; Rescheduling
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Scoring below 70% unlocks targeted corrective booster sessions focused on weak spots,
              while one-click overdue rescheduling shifts a missed session to today and cleanly
              re-cascades subsequent spacing intervals.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: 5-Stage Cognitive Scaffolding */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500/15 text-teal-700 dark:text-teal-300">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              2. 5-Stage Cognitive Scaffolding Progression
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each spaced session escalates the cognitive demand—moving from structural mapping to deep synthesis
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stages.map(({ num, config, accent }) => (
            <div
              key={num}
              className={`rounded-2xl border ${accent.border} bg-slate-50/70 dark:bg-slate-950/60 p-4 flex flex-col justify-between space-y-3`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold shadow-xs ${accent.iconBg}`}
                  >
                    {num}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${accent.badge}`}>
                    {config.badgeLabel}
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Stage {num}: {config.shortTitle}
                  </h3>
                  <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    {config.sectionHeader}
                  </p>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {config.guidanceBanner}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Multi-Modal Ingestion & Calendar Integration */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 space-y-5 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              3. Multi-Modal Ingestion &amp; Calendar Integration
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bring your real study materials and launch sessions straight from your calendar
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Multi-Modal Knowledge Digestion</span>
            </div>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  Combine exam focus prompts with uploaded PDFs, lecture slides, CSV notes, Markdown,
                  and diagrams.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Globe className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <span>
                  Harvest documentation pages, articles, or YouTube links into structured digests that
                  power both closed-book prompts and unlocked answer verification.
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <Calendar className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <span>Deep-Linked Calendar &amp; Tasks Sync</span>
            </div>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <CalendarCheck className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                <span>
                  Inspects your Google Calendar FreeBusy window (customizable in 5-minute increments)
                  to reserve conflict-free 25–60 minute study blocks with one-click deep links back to the
                  exact recall stage.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <BookOpen className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Supports Google Tasks checklists and universal RFC-5545 <code>.ics</code> downloads for
                  Apple Calendar and Outlook, with multi-user accounts and automatic Guest-to-Account plan saving.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};

