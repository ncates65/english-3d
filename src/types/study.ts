export type SyncMode = 'google_calendar' | 'google_tasks' | 'ics_download';

export type HorizonCategory =
  | 'ultra_short'
  | 'short'
  | 'medium'
  | 'long'
  | 'extended';

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

export interface RecallAttempt {
  id: number;
  sessionId: number;
  userResponseText: string;
  aiScore: number;
  strengths: string[];
  missingConcepts: string[];
  correctiveFeedback: string;
  followUpQuestion: string;
  createdAt: string;
}

export interface GradeRecallEvaluation {
  masteryScore: number;
  accuratePoints: string[];
  missedOrInaccurateConcepts: string[];
  coachFeedback: string;
  socraticFollowUpQuestion: string;
  recommendAdaptiveExtraSession: boolean;
}

export interface StudySession {
  id: number;
  planId: number;
  sessionNumber: number;
  stageName: string;
  scheduledDate: string; // YYYY-MM-DD
  dayOffset: number;
  gapDays: number;
  cognitiveGoal: string;
  prompts: string[];
  verificationChecklist: string[];
  status: 'pending' | 'completed';
  masteryScore: number | null;
  calendarEventId?: string | null;
  completedAt?: string | null;
  attempts?: RecallAttempt[];
}

export interface StudyPlan {
  id: number;
  userEmail: string;
  topicTitle: string;
  executiveSummary: string;
  coreConcepts: CoreConcept[];
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
  stageName: string;
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

