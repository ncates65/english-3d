export type SyncMode = 'google_calendar' | 'google_tasks' | 'ics_download';

export type HorizonCategory =
  | 'ultra_short'
  | 'short'
  | 'medium'
  | 'long'
  | 'extended';

export type StudyMode = 'deepening' | 'spiral_chunking';

export type RecalibrationResolutionMode =
  | 'auto'
  | 'extend_7_days'
  | 'final_sprint_today';

export type RecalibrationTier =
  | 'tier1_shifted'
  | 'tier2_compressed'
  | 'tier3_extended'
  | 'tier3_final_sprint'
  | 'deadline_squeeze'
  | 'no_pending_sessions';

export interface ChunkScope {
  new: string[];
  review: string[];
}

export interface ConceptCluster {
  cluster_id: string;
  title: string;
  key_concepts: string[];
}

export interface CanonicalBlueprint {
  topicTitle?: string;
  executiveSummary?: string;
  estimatedFirstPassMinutes?: number;
  learningObjectives?: string[];
  coreConcepts?: CoreConcept[];
  conceptClusters?: ConceptCluster[];
  relationships?: string[];
  misconceptionsOrTraps?: string[];
  extractedSourceDigest?: string;
}

export interface UserAccount {
  id: number;
  email: string | null;
  displayName: string;
  googleId?: string | null;
  isGuest: boolean;
  guestToken?: string | null;
}

export interface CoreConcept {
  id: string;
  title: string;
  summary: string;
  connections: string;
}

export interface SourceLink {
  url: string;
  title: string;
  status: 'harvested' | 'unreachable' | 'pending';
}

export interface UploadedFilePayload {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  base64Data: string;
}

export interface StudyWindowConfig {
  startHour: string; // e.g., "09:00"
  endHour: string;   // e.g., "17:00"
  durationMinutes: number; // default 30
  syncMode: SyncMode;
}

export interface SessionPromptItem {
  prompt_text: string;
  chunk_tag?: string;
  expected_rubric_points: string[];
}

export interface RecallAttempt {
  id: number;
  sessionId: number;
  userResponseText: string;
  aiScore: number;
  strengths: string[];
  whatYouNailed?: string[];
  missingConcepts: string[];
  missingToReview?: string[];
  correctiveFeedback: string;
  cognitiveStageCheck?: string;
  followUpQuestion: string;
  createdAt: string;
}

export interface GradeRecallEvaluation {
  masteryScore: number;
  accuratePoints: string[];
  whatYouNailed?: string[];
  cognitiveStageCheck: string;
  missedOrInaccurateConcepts: string[];
  missingToReview?: string[];
  coachFeedback: string;
  socraticFollowUpQuestion: string;
  recommendAdaptiveExtraSession: boolean;
}

export interface StudySession {
  id: number;
  planId: number;
  userId?: number | null;
  sessionNumber: number;
  stageNumber: number;
  stageName: string;
  stageKey?: string;
  scheduledDate: string; // YYYY-MM-DD
  originalScheduledDate?: string | null;
  dayOffset: number;
  gapDays: number;
  cognitiveGoal: string;
  chunkScope?: ChunkScope | null;
  continuityHook?: string;
  prompts: string[];
  promptItems?: SessionPromptItem[];
  verificationChecklist: string[];
  status: 'pending' | 'completed' | 'merged';
  mergedIntoSessionId?: number | null;
  recalibrationCount?: number;
  masteryScore: number | null;
  calendarEventId?: string | null;
  completedAt?: string | null;
  attempts?: RecallAttempt[];
}

export interface StudyPlan {
  id: number;
  userId?: number | null;
  userEmail: string;
  topicTitle: string;
  studyMode?: StudyMode;
  targetChunkCount?: number;
  studyWindowMinutes?: number;
  executiveSummary: string;
  coreConcepts: CoreConcept[];
  blueprint?: CanonicalBlueprint | null;
  sourceLinks: SourceLink[];
  extractedContextCache: string;
  startDate: string;
  masterByDate: string;
  createdAt: string;
  sessions: StudySession[];
  studyWindow?: StudyWindowConfig;
}

export interface ScheduledSessionBlueprint {
  sessionNumber: number;
  stageNumber: number;
  stageName: string;
  stageKey?: string;
  subAngle?: string;
  scheduledDate: string;
  dayOffset: number;
  gapDays: number;
  cognitiveGoal: string;
}

export interface SpacingScheduleResult {
  totalDays: number;
  horizonCategory: HorizonCategory;
  horizonLabel: string;
  isCompressedWarning: boolean;
  warningMessage: string | null;
  cepedaOptimalIsiRatio: string;
  sessions: ScheduledSessionBlueprint[];
}
