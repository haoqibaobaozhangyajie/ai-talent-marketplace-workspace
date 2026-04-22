export interface TopicManifest {
  id: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StudySession {
  id: string;
  topicId: string;
  goal: string;
  goalDetail: string;
  status: "active" | "archived";
  startedAt: string;
  lastTurnAt: string;
}

export interface GoalClarity {
  score: number;
  summary: string;
  knownPoints: string[];
  missingPoints: string[];
  clarificationQuestions: string[];
}

export interface LearningPrompt {
  id: string;
  question: string;
  intent: string;
  difficulty: "warmup" | "core" | "challenge";
  expectedFocus: string[];
}

export interface TeachingFeedback {
  answerQuality: "strong" | "partial" | "unclear";
  coachReply: string;
  highlights: string[];
  blindSpots: string[];
  suggestedAnswer: string[];
  nextStep: string;
}

export interface TurnCapture {
  id: string;
  clientTurnId: string;
  question: string;
  answer: string;
  summary: string;
  keyPoints: string[];
  misconceptions: string[];
  reviewItems: string[];
  answerQuality: TeachingFeedback["answerQuality"];
  coachReply: string;
  blindSpots: string[];
  suggestedAnswer: string[];
  nextQuestion: string | null;
  createdAt: string;
}

export interface KnowledgeNode {
  id: string;
  parentId: string | null;
  title: string;
  summary: string;
  evidenceTurnIds: string[];
  children: string[];
}

export interface KnowledgeGraph {
  topicId: string;
  rootId: string;
  nodes: Record<string, KnowledgeNode>;
  updatedAt: string;
}

export interface KnowledgeDelta {
  parentId: string;
  addedNodeIds: string[];
  updatedNodeIds: string[];
}

export interface ExportStatus {
  path: string;
  filename: string;
  nodeCount: number;
  exportedAt: string;
}

export interface WorkspaceState {
  topic: TopicManifest | null;
  session: StudySession | null;
  graph: KnowledgeGraph | null;
  recentTurns: TurnCapture[];
  goalClarity: GoalClarity | null;
  currentPrompt: LearningPrompt | null;
  promptQueue: LearningPrompt[];
  latestFeedback: TeachingFeedback | null;
  pendingReview: string[];
  exportStatus: ExportStatus | null;
  availableTopics: TopicManifest[];
  goalSuggestions: string[];
}

export interface RecordTurnResult {
  turn: TurnCapture;
  delta: KnowledgeDelta;
  workspace: WorkspaceState;
}

export interface RefineMapResult {
  graph: KnowledgeGraph;
  workspace: WorkspaceState;
}

export interface ExportXMindResult {
  exportStatus: ExportStatus;
  workspace: WorkspaceState;
}

export interface CreateTopicInput {
  title: string;
  description?: string;
  tags?: string[];
}

export interface OpenWorkspaceInput {
  topicId?: string;
  sessionId?: string;
}

export interface RecordLearningTurnInput {
  topicId: string;
  sessionId: string;
  question: string;
  answer: string;
  turnClientId: string;
}

export interface RefineKnowledgeMapInput {
  topicId: string;
  sessionId: string;
  action: "auto" | "merge" | "split" | "reparent";
  nodeIds?: string[];
  targetParentId?: string;
}

export interface ExportXMindInput {
  topicId: string;
  sessionId?: string;
  filename?: string;
}

export type JournalEntryType = "event" | "problem" | "emotion" | "highlight" | "idea" | "todo" | "free";

export interface JournalEntry {
  id: string;
  date: string;
  type: JournalEntryType;
  content: string;
  note: string;
  source: "manual" | "voice";
  createdAt: string;
}

export interface JournalDay {
  date: string;
  entries: JournalEntry[];
}

export interface CreateJournalEntryInput {
  date?: string;
  type: JournalEntryType;
  content: string;
  note?: string;
  source?: "manual" | "voice";
}

export type RoleProfileField =
  | "targetRole"
  | "businessContext"
  | "coreResponsibilities"
  | "mustHaves"
  | "niceToHaves"
  | "riskConstraints"
  | "currentStage"
  | "notes";

export interface RoleProfileDraft {
  id: string;
  targetRole: string;
  businessContext: string;
  coreResponsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  riskConstraints: string[];
  currentStage: string;
  notes: string;
  status: "draft" | "ready";
  createdAt: string;
  updatedAt: string;
}

export interface ClarificationQuestion {
  id: string;
  field: RoleProfileField;
  question: string;
  rationale: string;
  placeholder: string;
}

export interface ClarificationAnswer {
  id: string;
  questionId: string;
  field: RoleProfileField;
  question: string;
  answer: string;
  createdAt: string;
}

export interface RoleProfileCard {
  summary: string;
  targetRole: string;
  businessContext: string;
  currentStage: string;
  coreResponsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  riskConstraints: string[];
  readyForSearch: boolean;
}

export interface SearchKeywordCluster {
  label: string;
  terms: string[];
}

export interface SearchStrategy {
  keywordClusters: SearchKeywordCluster[];
  alternativeTitles: string[];
  booleanQuery: string;
  recommendedSources: string[];
  evidenceChecks: string[];
}

export interface ScreeningGuide {
  prioritySignals: string[];
  eliminationSignals: string[];
  graySignals: string[];
}

export interface RoleProfileWorkspaceState {
  draft: RoleProfileDraft | null;
  availableDrafts: RoleProfileDraft[];
  clarityScore: number;
  claritySummary: string;
  missingFields: string[];
  pendingQuestions: ClarificationQuestion[];
  currentQuestion: ClarificationQuestion | null;
  answers: ClarificationAnswer[];
  profileCard: RoleProfileCard | null;
  searchStrategy: SearchStrategy | null;
  screeningGuide: ScreeningGuide | null;
  readyForSearch: boolean;
}

export interface CreateRoleProfileDraftInput {
  targetRole?: string;
  businessContext?: string;
  coreResponsibilities?: string[];
  mustHaves?: string[];
  niceToHaves?: string[];
  riskConstraints?: string[];
  currentStage?: string;
  notes?: string;
}

export interface OpenRoleProfileWorkspaceInput {
  draftId?: string;
}

export interface AnswerRoleProfileQuestionInput {
  draftId: string;
  questionId: string;
  answer: string;
}

export interface FinalizeRoleProfileInput {
  draftId: string;
}

export interface AnswerRoleProfileQuestionResult {
  workspace: RoleProfileWorkspaceState;
}

export interface FinalizeRoleProfileResult {
  workspace: RoleProfileWorkspaceState;
}

export type PerformanceLevel = "high" | "solid" | "developing";
export type PotentialLevel = "high" | "medium" | "emerging";
export type MobilityIntent = "active" | "open" | "steady";
export type MatchSourceType = "job" | "employee";
export type ReviewDecisionType = "approve" | "hold" | "reject";

export interface LevelRange {
  min: string;
  max: string;
}

export interface EmployeeProfile {
  employeeId: string;
  name: string;
  org: string;
  currentRole: string;
  jobFamily: string;
  level: string;
  skills: string[];
  projectTags: string[];
  industryTags: string[];
  certifications: string[];
  performanceLevel: PerformanceLevel;
  potentialLevel: PotentialLevel;
  mobilityIntent: MobilityIntent;
  preferredCities: string[];
  preferredFunctions: string[];
  constraints: string[];
  resumeText: string;
  managerComment: string;
  trainingHistory: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JobProfile {
  jobId: string;
  title: string;
  dept: string;
  jobFamily: string;
  levelRange: LevelRange;
  location: string;
  responsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  keywords: string[];
  riskFlags: string[];
  headcount: number;
  priority: "critical" | "planned" | "pipeline";
  createdAt: string;
  updatedAt: string;
}

export interface MovementRecord {
  movementId: string;
  employeeName: string;
  fromRole: string;
  toRole: string;
  fromFamily: string;
  toFamily: string;
  note: string;
  outcome: string;
  createdAt: string;
}

export interface MatchResult {
  matchId: string;
  sourceType: MatchSourceType;
  sourceId: string;
  sourceLabel: string;
  targetId: string;
  targetLabel: string;
  overallScore: number;
  skillScore: number;
  experienceScore: number;
  intentScore: number;
  reasons: string[];
  risks: string[];
  gapItems: string[];
  nextAction: string;
}

export interface ReviewDecision {
  matchId: string;
  reviewer: string;
  decision: ReviewDecisionType;
  comment: string;
  createdAt: string;
}

export interface MarketplaceOverview {
  employeeCount: number;
  jobCount: number;
  movementCount: number;
  activeMobilityCount: number;
  highConfidenceCount: number;
  readyJobCount: number;
}

export interface MarketplaceWorkspaceState {
  overview: MarketplaceOverview;
  strategyHighlights: string[];
  employees: EmployeeProfile[];
  jobs: JobProfile[];
  movementHistory: MovementRecord[];
  reviewDecisions: ReviewDecision[];
  selectedJobId: string | null;
  selectedEmployeeId: string | null;
  selectedJob: JobProfile | null;
  selectedEmployee: EmployeeProfile | null;
  jobMatches: MatchResult[];
  employeeMatches: MatchResult[];
}

export interface OpenMarketplaceWorkspaceInput {
  jobId?: string;
  employeeId?: string;
}

export interface NormalizeJobProfileInput {
  title?: string;
  dept?: string;
  location?: string;
  levelMin?: string;
  levelMax?: string;
  rawText?: string;
}

export interface NormalizeEmployeeProfileInput {
  name?: string;
  currentRole?: string;
  org?: string;
  rawText?: string;
}

export interface MatchByJobInput {
  jobId: string;
  limit?: number;
}

export interface MatchByEmployeeInput {
  employeeId: string;
  limit?: number;
}

export interface ReviewMatchInput {
  matchId: string;
  reviewer: string;
  decision: ReviewDecisionType;
  comment?: string;
}

export interface MatchWorkspaceResult {
  workspace: MarketplaceWorkspaceState;
}
