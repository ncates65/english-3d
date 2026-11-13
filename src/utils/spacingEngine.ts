import {
  HorizonCategory,
  ScheduledSessionBlueprint,
  SpacingScheduleResult,
} from '../types/study';

/**
 * Parse a YYYY-MM-DD date string in local calendar terms without UTC timezone drift.
 */
export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

/**
 * Format a Date object back into YYYY-MM-DD.
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add N calendar days to a YYYY-MM-DD date string.
 */
export function addCalendarDays(ymd: string, daysToAdd: number): string {
  const dt = parseLocalDate(ymd);
  dt.setDate(dt.getDate() + daysToAdd);
  return formatLocalDate(dt);
}

/**
 * Calculate integer day difference T = (MasterByDate - StartDate) in days.
 */
export function diffCalendarDays(startDate: string, masterByDate: string): number {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(masterByDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Map a session index (0-based out of totalSessions) to its Cognitive Scaffolding Stage
 * and default cognitive goal.
 */
function resolveStageMetadata(
  index: number,
  totalSessions: number,
  isUltraShortFinalDay: boolean
): { stageName: string; cognitiveGoal: string } {
  const isFinal = index === totalSessions - 1;

  if (index === 0) {
    return {
      stageName: 'Stage 1: Initial Encoding & Schema Mapping',
      cognitiveGoal:
        'Extract 3–5 macro conceptual pillars and map their causal, hierarchical, and structural connections before memorizing details.',
    };
  }

  if (isFinal) {
    return {
      stageName: isUltraShortFinalDay
        ? 'Final Stage: Morning Mastery Verification (Feynman Teach-Back)'
        : 'Final Stage: Mastery Verification (Feynman Teach-Back)',
      cognitiveGoal:
        'Explain every core concept from scratch in plain language as if teaching an intelligent novice, verifying zero jargon-masking.',
    };
  }

  if (index === 1) {
    return {
      stageName: 'Stage 2: Closed-Book Free Recall',
      cognitiveGoal:
        'Execute an unassisted brain-dump from long-term memory after the initial 24-hour Ebbinghaus forgetting curve drop—before opening any notes.',
    };
  }

  if (index === 2) {
    return {
      stageName: 'Stage 3: Elaborative Interrogation',
      cognitiveGoal:
        'Answer deep "Why" and "How" mechanism prompts to connect new knowledge to existing mental models and fortify retrieval cues.',
    };
  }

  if (index === 3) {
    return {
      stageName: 'Stage 4: Application & Edge Cases',
      cognitiveGoal:
        'Solve realistic diagnostic scenarios, boundary conditions, and novel failure modes without consulting reference materials.',
    };
  }

  return {
    stageName: `Stage ${index + 1}: Interleaved Synthesis & Cue Discrimination`,
    cognitiveGoal:
      'Cross-connect subtopics across the domain and practice rapid cue-to-concept discrimination under expanding intervals.',
  };
}

/**
 * Enforce strictly unique, ascending day offsets.
 * Shifts any colliding day offset forward by +1 day:
 * if offsets[i] <= offsets[i - 1], offsets[i] = offsets[i - 1] + 1
 */
export function enforceAscendingCollisionGuard(rawOffsets: number[]): number[] {
  if (rawOffsets.length === 0) return [];
  const sorted = [...rawOffsets].sort((a, b) => a - b);
  const guarded: number[] = [Math.max(0, sorted[0])];

  for (let i = 1; i < sorted.length; i++) {
    const candidate = sorted[i];
    const prev = guarded[i - 1];
    if (candidate <= prev) {
      guarded.push(prev + 1);
    } else {
      guarded.push(candidate);
    }
  }

  return guarded;
}

/**
 * Evidence-Based Spacing Engine (Cepeda et al., 2008 ISI Ratios + Ebbinghaus Decay Mitigation)
 *
 * Calculates session offsets and dates between Day 0 (Start Date) and Day T (Master By Date):
 * - Ultra-Short Horizon (T <= 3 days): 1 session/day from Day 0 to Day T-1, plus morning verification review on Day T.
 * - Short Horizon (4 <= T <= 7 days): 4 sessions at Day 0, Day 1, Day floor(0.55 * T), and Day T-1.
 * - Medium Horizon (8 <= T <= 21 days): 5 sessions at Day 0, Day 1, Day floor(0.25 * T), Day floor(0.60 * T), and Day T-1.
 * - Long Horizon (22 <= T <= 60 days): 6 sessions at Day 0, Day 1, Day floor(0.15 * T), Day floor(0.35 * T), Day floor(0.65 * T), and Day T-1.
 * - Extended Horizon (T > 60 days): 7 sessions at Day 0, Day 1, Day 4, Day 12, Day floor(0.35 * T), Day floor(0.68 * T), and Day T-1.
 */
export function calculateSpacedSchedule(
  startDate: string,
  masterByDate: string
): SpacingScheduleResult {
  const rawT = diffCalendarDays(startDate, masterByDate);
  const T = Math.max(1, rawT);

  let horizonCategory: HorizonCategory;
  let horizonLabel: string;
  let isCompressedWarning = false;
  let warningMessage: string | null = null;
  let cepedaOptimalIsiRatio: string;
  let rawOffsets: number[] = [];

  if (T <= 3) {
    horizonCategory = 'ultra_short';
    horizonLabel = `Ultra-Short Horizon (${T} ${T === 1 ? 'Day' : 'Days'})`;
    isCompressedWarning = true;
    warningMessage =
      'Compressed Horizon Warning (T ≤ 3 days): Synaptic consolidation typically requires multi-day sleep cycles. Daily intensive retrieval + Day T morning verification activated.';
    cepedaOptimalIsiRatio = 'Daily Intensive + Day T Morning Verification (~24h ISI)';
    // 1 session/day from Day 0 to Day T-1, plus morning verification review on Day T
    for (let d = 0; d <= T; d++) {
      rawOffsets.push(d);
    }
  } else if (T <= 7) {
    horizonCategory = 'short';
    horizonLabel = `Short Horizon (${T} Days)`;
    cepedaOptimalIsiRatio = 'Cepeda Short-Retention ISI (~20–35% of Retention Interval)';
    rawOffsets = [0, 1, Math.floor(0.55 * T), T - 1];
  } else if (T <= 21) {
    horizonCategory = 'medium';
    horizonLabel = `Medium Horizon (${T} Days)`;
    cepedaOptimalIsiRatio = 'Cepeda Medium-Retention ISI (~15–25% Expanding Interval)';
    rawOffsets = [0, 1, Math.floor(0.25 * T), Math.floor(0.60 * T), T - 1];
  } else if (T <= 60) {
    horizonCategory = 'long';
    horizonLabel = `Long Horizon (${T} Days)`;
    cepedaOptimalIsiRatio = 'Cepeda Long-Retention ISI (~10–20% Expanding Interval)';
    rawOffsets = [
      0,
      1,
      Math.floor(0.15 * T),
      Math.floor(0.35 * T),
      Math.floor(0.65 * T),
      T - 1,
    ];
  } else {
    horizonCategory = 'extended';
    horizonLabel = `Extended Horizon (${T} Days)`;
    cepedaOptimalIsiRatio = 'Cepeda Extended-Retention ISI (~8–15% Expanding Interval)';
    rawOffsets = [
      0,
      1,
      4,
      12,
      Math.floor(0.35 * T),
      Math.floor(0.68 * T),
      T - 1,
    ];
  }

  // Apply Collision Guard: strictly unique, ascending dates (shift colliding days forward by +1 day)
  const guardedOffsets = enforceAscendingCollisionGuard(rawOffsets);

  const sessions: ScheduledSessionBlueprint[] = guardedOffsets.map((offset, idx) => {
    const prevOffset = idx === 0 ? 0 : guardedOffsets[idx - 1];
    const gapDays = idx === 0 ? 0 : offset - prevOffset;
    const scheduledDate = addCalendarDays(startDate, offset);
    const { stageName, cognitiveGoal } = resolveStageMetadata(
      idx,
      guardedOffsets.length,
      horizonCategory === 'ultra_short'
    );

    return {
      sessionNumber: idx + 1,
      stageName,
      scheduledDate,
      dayOffset: offset,
      gapDays,
      cognitiveGoal,
    };
  });

  return {
    totalDays: T,
    horizonCategory,
    horizonLabel,
    isCompressedWarning,
    warningMessage,
    cepedaOptimalIsiRatio,
    sessions,
  };
}

