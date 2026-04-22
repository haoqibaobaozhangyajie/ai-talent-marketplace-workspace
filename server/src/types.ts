import type {
  ExportStatus,
  GoalClarity,
  LearningPrompt,
  StudySession,
  TeachingFeedback,
  TopicManifest,
  TurnCapture
} from "../../shared/contracts.js";

export interface TopicFile {
  manifest: TopicManifest;
  activeSession: StudySession | null;
  lastExport: ExportStatus | null;
}

export interface SessionFile {
  session: StudySession;
  turns: TurnCapture[];
  goalClarity: GoalClarity;
  promptQueue: LearningPrompt[];
  latestFeedback: TeachingFeedback | null;
}
