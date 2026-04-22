import fs from "node:fs/promises";
import path from "node:path";
import type {
  AnswerRoleProfileQuestionInput,
  AnswerRoleProfileQuestionResult,
  ClarificationAnswer,
  ClarificationQuestion,
  CreateRoleProfileDraftInput,
  FinalizeRoleProfileInput,
  FinalizeRoleProfileResult,
  OpenRoleProfileWorkspaceInput,
  RoleProfileCard,
  RoleProfileDraft,
  RoleProfileField,
  RoleProfileWorkspaceState,
  ScreeningGuide,
  SearchKeywordCluster,
  SearchStrategy
} from "../../shared/contracts.js";
import { ROLE_PROFILE_DIR } from "./config.js";
import { createId, nowIso, uniqueStrings } from "./utils.js";

interface RoleProfileFile {
  draft: RoleProfileDraft;
  answers: ClarificationAnswer[];
}

function draftFilePath(draftId: string): string {
  return path.join(ROLE_PROFILE_DIR, `${draftId}.json`);
}

async function ensureRoleProfileDir(): Promise<void> {
  await fs.mkdir(ROLE_PROFILE_DIR, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureRoleProfileDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function cleanText(value?: string): string {
  return value?.trim() ?? "";
}

function cleanList(values?: string[]): string[] {
  return uniqueStrings(
    (values ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function defaultDraft(input: CreateRoleProfileDraftInput = {}): RoleProfileDraft {
  const now = nowIso();
  return {
    id: createId("role-profile"),
    targetRole: cleanText(input.targetRole) || "待明确岗位",
    businessContext: cleanText(input.businessContext),
    coreResponsibilities: cleanList(input.coreResponsibilities),
    mustHaves: cleanList(input.mustHaves),
    niceToHaves: cleanList(input.niceToHaves),
    riskConstraints: cleanList(input.riskConstraints),
    currentStage: cleanText(input.currentStage),
    notes: cleanText(input.notes),
    status: "draft",
    createdAt: now,
    updatedAt: now
  };
}

function roleAliases(role: string): string[] {
  const normalized = role.toLowerCase();
  if (normalized.includes("产品经理")) {
    return ["产品经理", "高级产品经理", "产品负责人", "平台产品经理", "业务产品经理"];
  }
  if (normalized.includes("招聘")) {
    return ["招聘经理", "招聘负责人", "招聘运营", "人才获取经理"];
  }
  if (normalized.includes("运营")) {
    return ["运营经理", "用户运营", "增长运营", "业务运营"];
  }
  return uniqueStrings([role, `${role}负责人`, `高级${role}`]).filter(Boolean);
}

function listToBoolean(terms: string[]): string {
  const cleaned = uniqueStrings(terms.map((item) => item.trim()).filter(Boolean));
  if (!cleaned.length) {
    return "";
  }
  return `(${cleaned.map((item) => `"${item}"`).join(" OR ")})`;
}

function missingFieldLabels(draft: RoleProfileDraft): string[] {
  const missing: string[] = [];
  if (!draft.businessContext) {
    missing.push("业务背景还不够清楚");
  }
  if (!draft.currentStage) {
    missing.push("团队阶段与岗位场景还没讲清");
  }
  if (!draft.coreResponsibilities.length) {
    missing.push("核心职责还没有拆到可执行");
  }
  if (!draft.mustHaves.length) {
    missing.push("必须项还没有明确");
  }
  if (!draft.riskConstraints.length) {
    missing.push("风险项还没有明确");
  }
  return missing;
}

function buildQuestions(draft: RoleProfileDraft): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];

  if (!draft.businessContext) {
    questions.push({
      id: "clarify-business-context",
      field: "businessContext",
      question: `这个「${draft.targetRole}」最核心的业务任务是什么？它服务的是哪类产品、团队或业务目标？`,
      rationale: "先讲清业务背景，后续搜索和判断口径才能一致。",
      placeholder: "例如：服务 B 端 SaaS 产品团队，核心目标是提升复杂流程产品的交付效率和业务落地率。"
    });
  }

  if (!draft.currentStage) {
    questions.push({
      id: "clarify-current-stage",
      field: "currentStage",
      question: `这个岗位处在什么阶段？更偏 0-1、增长期、成熟优化，还是组织协同复杂的存量阶段？`,
      rationale: "同样的岗位名称，不同阶段需要的人完全不一样。",
      placeholder: "例如：业务已过 0-1，进入多团队协同和流程优化阶段。"
    });
  }

  if (!draft.coreResponsibilities.length) {
    questions.push({
      id: "clarify-core-responsibilities",
      field: "coreResponsibilities",
      question: `如果只保留 3 件最重要的事，这个岗位入职后必须真正负责推进哪些核心职责？`,
      rationale: "先把职责边界说清，才能避免搜索时混进相似但不匹配的人。",
      placeholder: "每行一条，例如：负责复杂产品需求拆解；推进跨团队方案落地；建立需求优先级机制。"
    });
  }

  if (!draft.mustHaves.length) {
    questions.push({
      id: "clarify-must-haves",
      field: "mustHaves",
      question: `有哪些是不能妥协的必须项？请尽量写成可验证的经历、能力或证据，而不是抽象评价。`,
      rationale: "必须项需要能在简历和访谈里被验证。",
      placeholder: "每行一条，例如：有 B 端产品经验；做过复杂流程设计；有跨团队推进落地案例。"
    });
  }

  if (!draft.niceToHaves.length) {
    questions.push({
      id: "clarify-nice-to-haves",
      field: "niceToHaves",
      question: `哪些属于加分项而不是门槛？如果没有这些经验，但核心匹配，是否也可以继续看？`,
      rationale: "把加分项和必须项分开，能避免筛选时过早误杀。",
      placeholder: "每行一条，例如：做过工作台类产品；有数据分析习惯；能搭建流程判断框架。"
    });
  }

  if (!draft.riskConstraints.length) {
    questions.push({
      id: "clarify-risk-constraints",
      field: "riskConstraints",
      question: `你最怕招错成什么样的人？哪些风险出现就算其他条件不错，也不应该推进？`,
      rationale: "风险项决定后续初筛和面试中的淘汰信号。",
      placeholder: "每行一条，例如：只做过标准化功能；没有复杂场景取舍案例；缺少跨团队推进证据。"
    });
  }

  return questions;
}

function parseAnswerByField(field: RoleProfileField, answer: string): Partial<RoleProfileDraft> {
  const trimmed = answer.trim();
  const listValue = trimmed
    .split(/\r?\n|[；;]+/g)
    .map((item) => item.replace(/^[\-\d\.\s、]+/, "").trim())
    .filter(Boolean);

  switch (field) {
    case "coreResponsibilities":
      return { coreResponsibilities: cleanList(listValue) };
    case "mustHaves":
      return { mustHaves: cleanList(listValue) };
    case "niceToHaves":
      return { niceToHaves: cleanList(listValue) };
    case "riskConstraints":
      return { riskConstraints: cleanList(listValue) };
    case "businessContext":
      return { businessContext: trimmed };
    case "currentStage":
      return { currentStage: trimmed };
    case "targetRole":
      return { targetRole: trimmed || "待明确岗位" };
    case "notes":
      return { notes: trimmed };
    default:
      return {};
  }
}

function buildClarityScore(draft: RoleProfileDraft): number {
  let score = 20;
  if (draft.targetRole && draft.targetRole !== "待明确岗位") {
    score += 10;
  }
  if (draft.businessContext) {
    score += 18;
  }
  if (draft.currentStage) {
    score += 12;
  }
  score += Math.min(draft.coreResponsibilities.length, 3) * 10;
  score += Math.min(draft.mustHaves.length, 3) * 8;
  score += Math.min(draft.niceToHaves.length, 3) * 4;
  score += Math.min(draft.riskConstraints.length, 3) * 6;
  return Math.min(score, 100);
}

function buildClaritySummary(score: number, missingFields: string[]): string {
  if (score >= 88 && !missingFields.length) {
    return "岗位画像已经足够清晰，可以进入人才搜索和初筛口径阶段。";
  }
  if (score >= 68) {
    return "岗位画像已经有主体结构，但还需要补齐少数关键口径，避免搜索时误入相似人选。";
  }
  return "当前画像仍偏模糊，先把业务背景、职责边界和风险项讲清，后面的搜索才会稳定。";
}

function buildProfileCard(draft: RoleProfileDraft, readyForSearch: boolean): RoleProfileCard {
  const summary = [
    draft.businessContext || "业务背景待补充",
    draft.currentStage ? `当前阶段：${draft.currentStage}` : "阶段信息待补充",
    draft.coreResponsibilities.length ? `核心职责聚焦 ${draft.coreResponsibilities.slice(0, 3).join("、")}` : "职责边界待补充"
  ].join("。");

  return {
    summary,
    targetRole: draft.targetRole,
    businessContext: draft.businessContext || "待补充",
    currentStage: draft.currentStage || "待补充",
    coreResponsibilities: draft.coreResponsibilities,
    mustHaves: draft.mustHaves,
    niceToHaves: draft.niceToHaves,
    riskConstraints: draft.riskConstraints,
    readyForSearch
  };
}

function buildKeywordClusters(draft: RoleProfileDraft): SearchKeywordCluster[] {
  const clusters: SearchKeywordCluster[] = [
    {
      label: "目标岗位",
      terms: roleAliases(draft.targetRole)
    }
  ];

  if (draft.coreResponsibilities.length) {
    clusters.push({
      label: "职责关键词",
      terms: draft.coreResponsibilities.slice(0, 6)
    });
  }

  if (draft.mustHaves.length) {
    clusters.push({
      label: "必须项证据",
      terms: draft.mustHaves.slice(0, 6)
    });
  }

  if (draft.businessContext) {
    clusters.push({
      label: "业务场景",
      terms: uniqueStrings(
        draft.businessContext
          .split(/[，。；,]/g)
          .map((item) => item.trim())
          .filter((item) => item.length >= 2)
          .slice(0, 6)
      )
    });
  }

  return clusters.filter((cluster) => cluster.terms.length);
}

function buildSearchStrategy(draft: RoleProfileDraft): SearchStrategy {
  const keywordClusters = buildKeywordClusters(draft);
  const alternativeTitles = roleAliases(draft.targetRole);
  const roleClause = listToBoolean(alternativeTitles);
  const mustClause = listToBoolean(draft.mustHaves.slice(0, 4));
  const responsibilityClause = listToBoolean(draft.coreResponsibilities.slice(0, 4));
  const booleanParts = [roleClause, mustClause, responsibilityClause].filter(Boolean);

  return {
    keywordClusters,
    alternativeTitles,
    booleanQuery: booleanParts.length ? booleanParts.join(" AND ") : `"${draft.targetRole}"`,
    recommendedSources: [
      "优先看与你业务阶段接近的同类公司/团队",
      "先搜能体现必须项证据的公开简历或项目表述",
      "对跨团队协同要求高的岗位，优先关注有复杂推进案例的人"
    ],
    evidenceChecks: [
      "必须项是否能在经历描述里被直接验证",
      "职责关键词是否对应真实 owner 角色，而不是旁观参与",
      "风险项是否在简历或面试中有明显反证"
    ]
  };
}

function buildScreeningGuide(draft: RoleProfileDraft): ScreeningGuide {
  return {
    prioritySignals: draft.mustHaves.length
      ? draft.mustHaves.map((item) => `简历中出现可验证证据：${item}`)
      : ["优先选择职责边界清晰、经历可验证的人选"],
    eliminationSignals: draft.riskConstraints.length
      ? draft.riskConstraints.map((item) => `出现以下风险直接降权或淘汰：${item}`)
      : ["如果风险项未定义，先不要做强淘汰判断"],
    graySignals: draft.niceToHaves.length
      ? draft.niceToHaves.map((item) => `没有也可继续看，但若具备会明显加分：${item}`)
      : ["加分项尚未补充，默认不作为淘汰标准"]
  };
}

async function listDraftFiles(): Promise<RoleProfileFile[]> {
  await ensureRoleProfileDir();
  const entries = await fs.readdir(ROLE_PROFILE_DIR, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJsonFile<RoleProfileFile>(path.join(ROLE_PROFILE_DIR, entry.name)))
  );
  return files.filter((item): item is RoleProfileFile => Boolean(item));
}

async function listDrafts(): Promise<RoleProfileDraft[]> {
  const files = await listDraftFiles();
  return files
    .map((item) => item.draft)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function loadDraftFile(draftId: string): Promise<RoleProfileFile> {
  const file = await readJsonFile<RoleProfileFile>(draftFilePath(draftId));
  if (!file) {
    throw new Error(`Role profile draft not found: ${draftId}`);
  }
  return file;
}

async function saveDraftFile(file: RoleProfileFile): Promise<void> {
  await writeJsonFile(draftFilePath(file.draft.id), file);
}

function readyForSearch(draft: RoleProfileDraft): boolean {
  return Boolean(
    draft.businessContext &&
      draft.currentStage &&
      draft.coreResponsibilities.length &&
      draft.mustHaves.length &&
      draft.riskConstraints.length
  );
}

async function buildWorkspaceState(draftId?: string): Promise<RoleProfileWorkspaceState> {
  const drafts = await listDrafts();
  const selected = draftId ? drafts.find((item) => item.id === draftId) ?? null : drafts[0] ?? null;
  if (!selected) {
    return {
      draft: null,
      availableDrafts: [],
      clarityScore: 0,
      claritySummary: "先创建一份岗位画像草稿，系统再开始帮你追问和标准化。",
      missingFields: [],
      pendingQuestions: [],
      currentQuestion: null,
      answers: [],
      profileCard: null,
      searchStrategy: null,
      screeningGuide: null,
      readyForSearch: false
    };
  }

  const file = await loadDraftFile(selected.id);
  const missingFields = missingFieldLabels(file.draft);
  const pendingQuestions = buildQuestions(file.draft);
  const clarityScore = buildClarityScore(file.draft);
  const isReady = readyForSearch(file.draft);

  return {
    draft: file.draft,
    availableDrafts: drafts,
    clarityScore,
    claritySummary: buildClaritySummary(clarityScore, missingFields),
    missingFields,
    pendingQuestions,
    currentQuestion: pendingQuestions[0] ?? null,
    answers: [...file.answers].reverse(),
    profileCard: buildProfileCard(file.draft, isReady),
    searchStrategy: buildSearchStrategy(file.draft),
    screeningGuide: buildScreeningGuide(file.draft),
    readyForSearch: isReady
  };
}

export async function ensureRoleProfileDirectories(): Promise<void> {
  await ensureRoleProfileDir();
}

export async function openRoleProfileWorkspace(
  input: OpenRoleProfileWorkspaceInput = {}
): Promise<RoleProfileWorkspaceState> {
  await ensureRoleProfileDirectories();
  return buildWorkspaceState(input.draftId);
}

export async function createRoleProfileDraft(
  input: CreateRoleProfileDraftInput = {}
): Promise<RoleProfileWorkspaceState> {
  await ensureRoleProfileDirectories();
  const draft = defaultDraft(input);
  await saveDraftFile({
    draft,
    answers: []
  });
  return buildWorkspaceState(draft.id);
}

export async function answerRoleProfileQuestion(
  input: AnswerRoleProfileQuestionInput
): Promise<AnswerRoleProfileQuestionResult> {
  const file = await loadDraftFile(input.draftId);
  const question = buildQuestions(file.draft).find((item) => item.id === input.questionId);
  if (!question) {
    throw new Error("当前问题已失效，请刷新工作台后重试。");
  }

  const patch = parseAnswerByField(question.field, input.answer);
  const updatedDraft: RoleProfileDraft = {
    ...file.draft,
    ...patch,
    status: readyForSearch({ ...file.draft, ...patch } as RoleProfileDraft) ? "ready" : "draft",
    updatedAt: nowIso()
  };
  const answer: ClarificationAnswer = {
    id: createId("clarification-answer"),
    questionId: question.id,
    field: question.field,
    question: question.question,
    answer: input.answer.trim(),
    createdAt: nowIso()
  };

  await saveDraftFile({
    draft: updatedDraft,
    answers: [...file.answers, answer]
  });

  return {
    workspace: await buildWorkspaceState(updatedDraft.id)
  };
}

export async function finalizeRoleProfile(
  input: FinalizeRoleProfileInput
): Promise<FinalizeRoleProfileResult> {
  const file = await loadDraftFile(input.draftId);
  const updatedDraft: RoleProfileDraft = {
    ...file.draft,
    status: readyForSearch(file.draft) ? "ready" : "draft",
    updatedAt: nowIso()
  };
  await saveDraftFile({
    draft: updatedDraft,
    answers: file.answers
  });
  return {
    workspace: await buildWorkspaceState(updatedDraft.id)
  };
}
