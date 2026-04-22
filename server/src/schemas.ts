import { z } from "zod";

export const openWorkspaceSchema = {
  topicId: z.string().optional(),
  sessionId: z.string().optional()
};

export const createTopicSchema = {
  title: z.string().min(1).max(60),
  description: z.string().max(240).optional(),
  tags: z.array(z.string().min(1).max(24)).max(8).optional()
};

export const recordTurnSchema = {
  topicId: z.string().min(1),
  sessionId: z.string().min(1),
  question: z.string().min(1).max(1000),
  answer: z.string().min(1).max(4000),
  turnClientId: z.string().min(1).max(100)
};

export const refineMapSchema = {
  topicId: z.string().min(1),
  sessionId: z.string().min(1),
  action: z.enum(["auto", "merge", "split", "reparent"]),
  nodeIds: z.array(z.string()).optional(),
  targetParentId: z.string().optional()
};

export const exportXmindSchema = {
  topicId: z.string().min(1),
  sessionId: z.string().optional(),
  filename: z.string().max(120).optional()
};

const profileListItemSchema = z.string().min(1).max(120);

export const openRoleProfileWorkspaceSchema = {
  draftId: z.string().optional()
};

export const createRoleProfileDraftSchema = {
  targetRole: z.string().max(80).optional(),
  businessContext: z.string().max(1000).optional(),
  coreResponsibilities: z.array(profileListItemSchema).max(12).optional(),
  mustHaves: z.array(profileListItemSchema).max(12).optional(),
  niceToHaves: z.array(profileListItemSchema).max(12).optional(),
  riskConstraints: z.array(profileListItemSchema).max(12).optional(),
  currentStage: z.string().max(200).optional(),
  notes: z.string().max(1000).optional()
};

export const answerRoleProfileQuestionSchema = {
  draftId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().min(1).max(2000)
};

export const finalizeRoleProfileSchema = {
  draftId: z.string().min(1)
};

export const openMarketplaceWorkspaceSchema = {
  jobId: z.string().optional(),
  employeeId: z.string().optional()
};

export const normalizeJobProfileSchema = {
  title: z.string().max(80).optional(),
  dept: z.string().max(80).optional(),
  location: z.string().max(40).optional(),
  levelMin: z.string().max(12).optional(),
  levelMax: z.string().max(12).optional(),
  rawText: z.string().min(1).max(4000).optional()
};

export const normalizeEmployeeProfileSchema = {
  name: z.string().max(60).optional(),
  currentRole: z.string().max(80).optional(),
  org: z.string().max(80).optional(),
  rawText: z.string().min(1).max(4000).optional()
};

export const matchByJobSchema = {
  jobId: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional()
};

export const matchByEmployeeSchema = {
  employeeId: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional()
};

export const reviewMatchSchema = {
  matchId: z.string().min(1),
  reviewer: z.string().min(1).max(40),
  decision: z.enum(["approve", "hold", "reject"]),
  comment: z.string().max(300).optional()
};
