import {
  ChunkScope,
  ConceptCluster,
  HorizonCategory,
  ScheduledSessionBlueprint,
  SpacingScheduleResult,
  StudyMode,
} from '../types/study';

export type CognitiveStageNumber = 1 | 2 | 3 | 4 | 5;

export interface StageGuidanceMeta {
  stageNumber: CognitiveStageNumber;
  shortTitle: string;
  badgeLabel: string;
  sectionHeader: string;
  guidanceBanner: string;
  inputPlaceholder: string;
}

export const STAGE_GUIDANCE_CONFIG: Record<CognitiveStageNumber, StageGuidanceMeta> = {
  1: {
    stageNumber: 1,
    shortTitle: 'Schema Mapping',
    badgeLabel: 'Stage 1 • Structural Blueprint',
    sectionHeader: 'Stage 1: Structural Schema & Concept Mapping Tasks',
    guidanceBanner:
      'Build your high-level mental blueprint. Without looking at your source materials, list the main categories, define how the core components connect, and trace the overall structure or workflow. Focus on big-picture organization rather than minor details.',
    inputPlaceholder:
      'Outline the main categories, key components, and how they connect...',
  },
  2: {
    stageNumber: 2,
    shortTitle: 'Closed-Book Free Recall',
    badgeLabel: 'Stage 2 • Memory Retrieval',
    sectionHeader: 'Stage 2: Core Concept Retrieval Prompts',
    guidanceBanner:
      "Retrieve foundational facts and definitions directly from memory. For each prompt below, write out everything you can recall in your own words without consulting notes. Don't worry about perfection—forcing your brain to reconstruct the details strengthens the memory trace.",
    inputPlaceholder:
      'Write everything you recall about this concept from memory...',
  },
  3: {
    stageNumber: 3,
    shortTitle: 'Elaborative Interrogation',
    badgeLabel: 'Stage 3 • Causal Reasoning',
    sectionHeader: "Stage 3: Causal Analysis & 'Why/How' Prompts",
    guidanceBanner:
      "Explain the underlying mechanisms and cause-and-effect relationships. Don't just state what happens—explain WHY a principle works the way it does, HOW one step drives the next, and how closely related concepts differ from one another.",
    inputPlaceholder:
      "Explain the 'why' and 'how' behind this mechanism, including cause-and-effect links...",
  },
  4: {
    stageNumber: 4,
    shortTitle: 'Application & Edge Cases',
    badgeLabel: 'Stage 4 • Applied Diagnostics',
    sectionHeader: 'Stage 4: Scenario Application & Problem-Solving Tasks',
    guidanceBanner:
      'Put your knowledge to work in a realistic scenario. Analyze the situation or edge case presented in each prompt, diagnose what is happening, predict the outcome if a variable changes, and justify your recommended solution.',
    inputPlaceholder:
      'Diagnose the scenario, apply the relevant principles, and explain your solution...',
  },
  5: {
    stageNumber: 5,
    shortTitle: 'Mastery Verification',
    badgeLabel: 'Stage 5 • Feynman Synthesis',
    sectionHeader: 'Stage 5: Comprehensive Synthesis & Mastery Challenge',
    guidanceBanner:
      'Demonstrate complete, exam-ready mastery. Synthesize multiple concepts from across the entire unit into a clear, rigorous explanation—as if you were teaching the topic to an intelligent peer or answering a comprehensive essay question.',
    inputPlaceholder:
      'Deliver a complete, well-structured synthesis connecting all key concepts...',
  },
};

export function normalizeStageName(stageName: string): string {
  if (/initial encoding\s*&\s*schema mapping/i.test(stageName)) {
    return 'Stage 1: Schema Mapping';
  }
  return stageName;
}

export function resolveStageNumber(session: {
  stageNumber?: number;
  stageKey?: string;
  stageName: string;
  sessionNumber: number;
}): CognitiveStageNumber {
  if (
    typeof session.stageNumber === 'number' &&
    session.stageNumber >= 1 &&
    session.stageNumber <= 5
  ) {
    return session.stageNumber as CognitiveStageNumber;
  }

  const keyLower = (session.stageKey || '').toLowerCase();
  if (keyLower) {
    if (
      keyLower.includes('sprint') ||
      keyLower.includes('mastery') ||
      keyLower.includes('feynman')
    ) {
      return 5;
    }
    if (
      keyLower.includes('application') ||
      keyLower.includes('edge_cases') ||
      keyLower.includes('booster')
    ) {
      return 4;
    }
    if (keyLower.includes('elaborative')) {
      return 3;
    }
    if (
      keyLower.includes('recall_elaboration') ||
      keyLower.includes('free_recall') ||
      keyLower.includes('closed_book')
    ) {
      return 2;
    }
    if (keyLower.includes('schema')) {
      return 1;
    }
  }

  const lower = (session.stageName || '').toLowerCase();
  if (
    lower.includes('stage 5') ||
    lower.includes('mastery verification') ||
    lower.includes('feynman') ||
    lower.includes('sprint') ||
    lower.includes('final stage')
  ) {
    return 5;
  }
  if (
    lower.includes('stage 4') ||
    lower.includes('application') ||
    lower.includes('edge case') ||
    lower.includes('booster')
  ) {
    return 4;
  }
  if (lower.includes('stage 3') || lower.includes('elaborative')) {
    return 3;
  }
  if (
    lower.includes('stage 2') ||
    lower.includes('free recall') ||
    lower.includes('closed-book')
  ) {
    return 2;
  }
  if (lower.includes('stage 1') || lower.includes('schema mapping')) {
    return 1;
  }

  const clamped = Math.max(1, Math.min(5, session.sessionNumber || 1));
  return clamped as CognitiveStageNumber;
}

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

export interface StageSkeletonSlot {
  stage_number: CognitiveStageNumber;
  stage_key: string;
  stage_name: string;
  sub_angle: string;
  cognitive_goal: string;
}

/**
 * Deterministic Stage Compression Mapping (mirrored cleanly with `api/spacing_helpers.php`).
 */
export function buildStageSkeleton(sessionCount: number): StageSkeletonSlot[] {
  const n = Math.max(1, sessionCount);

  if (n === 1) {
    return [
      {
        stage_number: 5,
        stage_key: 'schema_recall_transfer_sprint',
        stage_name: 'Stage 5: Schema, Recall & Transfer Sprint',
        sub_angle: 'comprehensive_sprint',
        cognitive_goal:
          'Map macro pillars, execute rapid closed-book recall, and apply concepts to a synthesis challenge in one intensive sprint.',
      },
    ];
  }

  if (n === 2) {
    return [
      {
        stage_number: 1,
        stage_key: 'schema_recall_hybrid',
        stage_name: 'Stage 1: Schema Mapping & Recall Hybrid',
        sub_angle: 'schema_plus_core_facts',
        cognitive_goal:
          'Organize high-level architecture and retrieve foundational terms and core definitions from memory.',
      },
      {
        stage_number: 5,
        stage_key: 'elaboration_mastery_hybrid',
        stage_name: 'Stage 5: Elaboration & Mastery Verification',
        sub_angle: 'causal_teachback_synthesis',
        cognitive_goal:
          'Explain why/how causal mechanisms operate and synthesize the full topic cleanly as if teaching an intelligent peer.',
      },
    ];
  }

  if (n === 3) {
    return [
      {
        stage_number: 1,
        stage_key: 'schema_mapping',
        stage_name: 'Stage 1: Schema Mapping',
        sub_angle: 'macro_architecture',
        cognitive_goal:
          'Organize high-level structure, core categories, and causal or hierarchical relationships across the topic.',
      },
      {
        stage_number: 3,
        stage_key: 'elaborative_interrogation',
        stage_name: 'Stage 3: Elaborative Interrogation',
        sub_angle: 'why_how_causality',
        cognitive_goal:
          'Retrieve key terms while explaining why and how mechanisms operate and contrasting closely related concepts.',
      },
      {
        stage_number: 5,
        stage_key: 'application_mastery_hybrid',
        stage_name: 'Stage 5: Application & Mastery Verification',
        sub_angle: 'scenario_plus_synthesis',
        cognitive_goal:
          'Solve applied diagnostic cases and deliver a complete, gap-free mastery synthesis.',
      },
    ];
  }

  if (n === 4) {
    return [
      {
        stage_number: 1,
        stage_key: 'schema_mapping',
        stage_name: 'Stage 1: Schema Mapping',
        sub_angle: 'macro_architecture',
        cognitive_goal:
          'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
      },
      {
        stage_number: 2,
        stage_key: 'recall_elaboration_hybrid',
        stage_name: 'Stage 2: Closed-Book Recall & Elaboration',
        sub_angle: 'facts_plus_why_how',
        cognitive_goal:
          'Retrieve core definitions unassisted and explain why underlying mechanisms work as they do.',
      },
      {
        stage_number: 4,
        stage_key: 'application_edge_cases',
        stage_name: 'Stage 4: Application & Edge Cases',
        sub_angle: 'real_world_scenario',
        cognitive_goal:
          'Apply core principles to realistic scenarios, diagnostics, and boundary conditions without notes.',
      },
      {
        stage_number: 5,
        stage_key: 'mastery_verification',
        stage_name: 'Stage 5: Mastery Verification',
        sub_angle: 'feynman_synthesis',
        cognitive_goal:
          'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
      },
    ];
  }

  if (n === 5) {
    return [
      {
        stage_number: 1,
        stage_key: 'schema_mapping',
        stage_name: 'Stage 1: Schema Mapping',
        sub_angle: 'macro_architecture',
        cognitive_goal:
          'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
      },
      {
        stage_number: 2,
        stage_key: 'closed_book_free_recall',
        stage_name: 'Stage 2: Closed-Book Free Recall',
        sub_angle: 'uncued_core_retrieval',
        cognitive_goal:
          'Retrieve foundational concepts, definitions, and core facts directly from memory without consulting notes.',
      },
      {
        stage_number: 3,
        stage_key: 'elaborative_interrogation',
        stage_name: 'Stage 3: Elaborative Interrogation',
        sub_angle: 'why_how_causality',
        cognitive_goal:
          'Explain why and how mechanisms operate and contrast closely related concepts to deepen retrieval cues.',
      },
      {
        stage_number: 4,
        stage_key: 'application_edge_cases',
        stage_name: 'Stage 4: Application & Edge Cases',
        sub_angle: 'real_world_scenario',
        cognitive_goal:
          'Apply core principles to realistic scenarios, diagnostics, and boundary conditions without reference notes.',
      },
      {
        stage_number: 5,
        stage_key: 'mastery_verification',
        stage_name: 'Stage 5: Mastery Verification',
        sub_angle: 'feynman_synthesis',
        cognitive_goal:
          'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
      },
    ];
  }

  if (n === 6) {
    return [
      {
        stage_number: 1,
        stage_key: 'schema_mapping',
        stage_name: 'Stage 1: Schema Mapping',
        sub_angle: 'macro_architecture',
        cognitive_goal:
          'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
      },
      {
        stage_number: 2,
        stage_key: 'closed_book_free_recall',
        stage_name: 'Stage 2: Closed-Book Free Recall',
        sub_angle: 'uncued_core_retrieval',
        cognitive_goal:
          'Retrieve foundational concepts, definitions, and core facts directly from memory without consulting notes.',
      },
      {
        stage_number: 3,
        stage_key: 'elaborative_interrogation',
        stage_name: 'Stage 3: Elaborative Interrogation',
        sub_angle: 'compare_contrast',
        cognitive_goal:
          'Explain why and how mechanisms operate and contrast closely related concepts to deepen retrieval cues.',
      },
      {
        stage_number: 4,
        stage_key: 'application_core',
        stage_name: 'Stage 4: Core Application Practice',
        sub_angle: 'real_world_scenario',
        cognitive_goal:
          'Apply core mechanisms to realistic real-world scenarios and justify decisions without consulting notes.',
      },
      {
        stage_number: 4,
        stage_key: 'edge_cases_transfer',
        stage_name: 'Stage 4: Edge Cases & Transfer',
        sub_angle: 'boundary_test',
        cognitive_goal:
          'Stress-test understanding against boundary conditions, failure modes, and cross-topic transfer cases.',
      },
      {
        stage_number: 5,
        stage_key: 'mastery_verification',
        stage_name: 'Stage 5: Mastery Verification',
        sub_angle: 'feynman_synthesis',
        cognitive_goal:
          'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
      },
    ];
  }

  const m = n - 2;
  let s2Count = Math.max(1, Math.round(m * 0.2));
  let s3Count = Math.max(1, Math.round(m * 0.4));
  let s4Count = m - s2Count - s3Count;
  if (s4Count < 1) {
    let deficit = 1 - s4Count;
    const trim3 = Math.min(deficit, Math.max(0, s3Count - 1));
    s3Count -= trim3;
    deficit -= trim3;
    if (deficit > 0) {
      s2Count = Math.max(1, s2Count - deficit);
    }
    s4Count = Math.max(1, m - s2Count - s3Count);
  }

  const skeleton: StageSkeletonSlot[] = [
    {
      stage_number: 1,
      stage_key: 'schema_mapping',
      stage_name: 'Stage 1: Schema Mapping',
      sub_angle: 'macro_architecture',
      cognitive_goal:
        'Organize high-level structure, core categories, and causal or hierarchical relationships across the unit.',
    },
  ];

  const s2Angles = ['uncued_core_retrieval', 'terminology_constraints'];
  for (let i = 0; i < s2Count; i++) {
    skeleton.push({
      stage_number: 2,
      stage_key: 'closed_book_free_recall',
      stage_name: 'Stage 2: Closed-Book Free Recall',
      sub_angle: s2Angles[i % s2Angles.length],
      cognitive_goal:
        'Retrieve foundational concepts, definitions, and core facts directly from memory without consulting notes.',
    });
  }

  const s3Angles = ['uncued_brain_dump', 'compare_contrast', 'spot_misconception'];
  for (let i = 0; i < s3Count; i++) {
    const angle = s3Angles[i % s3Angles.length];
    skeleton.push({
      stage_number: 3,
      stage_key: 'elaborative_interrogation',
      stage_name:
        angle === 'compare_contrast'
          ? 'Stage 3: Elaborative Interrogation (Compare & Contrast)'
          : angle === 'spot_misconception'
            ? 'Stage 3: Elaborative Interrogation (Misconception Check)'
            : 'Stage 3: Elaborative Interrogation',
      sub_angle: angle,
      cognitive_goal:
        'Explain why and how mechanisms operate and contrast closely related concepts to deepen retrieval cues.',
    });
  }

  const s4Angles = ['real_world_scenario', 'feynman_teachback', 'boundary_test'];
  for (let i = 0; i < s4Count; i++) {
    const angle = s4Angles[i % s4Angles.length];
    skeleton.push({
      stage_number: 4,
      stage_key: 'application_edge_cases',
      stage_name:
        angle === 'feynman_teachback'
          ? 'Stage 4: Applied Feynman Teach-Back'
          : angle === 'boundary_test'
            ? 'Stage 4: Application & Boundary Tests'
            : 'Stage 4: Application & Edge Cases',
      sub_angle: angle,
      cognitive_goal:
        'Apply core principles to realistic scenarios, diagnostics, and boundary conditions without reference notes.',
    });
  }

  skeleton.push({
    stage_number: 5,
    stage_key: 'mastery_verification',
    stage_name: 'Stage 5: Mastery Verification',
    sub_angle: 'feynman_synthesis',
    cognitive_goal:
      'Synthesize the full topic with fluency, precision, and zero conceptual gaps as if teaching an intelligent peer.',
  });

  return skeleton;
}

export function selectStudyMode(
  sessionCount: number,
  studyWindowMinutes: number,
  wordCount: number,
  conceptClusters: ConceptCluster[],
  estimatedFirstPassMinutes: number
): { mode: StudyMode; target_chunk_count: number } {
  if (sessionCount < 5) {
    return { mode: 'deepening', target_chunk_count: 1 };
  }

  const clusterCount = conceptClusters.length;
  const safeWindow = Math.max(10, studyWindowMinutes);
  const exceedsWindow = estimatedFirstPassMinutes > safeWindow * 1.5;
  const isBroad = clusterCount >= 3 || (clusterCount >= 2 && wordCount >= 2500);

  if (clusterCount >= 2 && (exceedsWindow || isBroad)) {
    const maxChunks = Math.min(4, sessionCount - 3);
    if (maxChunks >= 2) {
      return {
        mode: 'spiral_chunking',
        target_chunk_count: Math.min(clusterCount, maxChunks),
      };
    }
  }

  return { mode: 'deepening', target_chunk_count: 1 };
}

export function assignSpiralChunkScopes(
  sessionCount: number,
  studyMode: StudyMode,
  targetChunkCount: number
): Array<ChunkScope | null> {
  if (studyMode !== 'spiral_chunking' || targetChunkCount < 2 || sessionCount < 5) {
    return Array.from({ length: sessionCount }, () => null);
  }
  const labels = ['A', 'B', 'C', 'D'].slice(0, targetChunkCount);
  const result: Array<ChunkScope | null> = [];
  for (let i = 0; i < sessionCount; i++) {
    if (i === 0) {
      result.push({ new: [labels[0]], review: [] });
    } else if (i < targetChunkCount) {
      result.push({ new: [labels[i]], review: labels.slice(0, i) });
    } else if (i === sessionCount - 1) {
      result.push({ new: [], review: ['ALL'] });
    } else {
      result.push({ new: [], review: labels });
    }
  }
  return result;
}

export function computeExpandingOffsets(count: number, maxSpanDays: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const span = Math.max(0, maxSpanDays);
  const offsets: number[] = [0];
  for (let i = 1; i < count; i++) {
    const ratio = i / (count - 1);
    offsets.push(Math.round(span * Math.pow(ratio, 1.45)));
  }
  for (let i = 1; i < count; i++) {
    if (offsets[i] <= offsets[i - 1]) {
      offsets[i] = offsets[i - 1] + 1;
    }
  }
  if (span >= count - 1) {
    if (offsets[count - 1] > span) {
      offsets[count - 1] = span;
    }
    for (let i = count - 2; i >= 1; i--) {
      if (offsets[i] >= offsets[i + 1]) {
        offsets[i] = Math.max(i, offsets[i + 1] - 1);
      }
    }
  }
  return offsets;
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

  const guardedOffsets = enforceAscendingCollisionGuard(rawOffsets);
  const stageSkeleton = buildStageSkeleton(guardedOffsets.length);

  const sessions: ScheduledSessionBlueprint[] = guardedOffsets.map((offset, idx) => {
    const prevOffset = idx === 0 ? 0 : guardedOffsets[idx - 1];
    const gapDays = idx === 0 ? 0 : offset - prevOffset;
    const scheduledDate = addCalendarDays(startDate, offset);
    const slot = stageSkeleton[idx] || stageSkeleton[stageSkeleton.length - 1];

    return {
      sessionNumber: idx + 1,
      stageNumber: slot.stage_number,
      stageName: slot.stage_name,
      stageKey: slot.stage_key,
      subAngle: slot.sub_angle,
      scheduledDate,
      dayOffset: offset,
      gapDays,
      cognitiveGoal: slot.cognitive_goal,
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
