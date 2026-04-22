import fs from "node:fs/promises";
import path from "node:path";
import type {
  CreateTopicInput,
  KnowledgeGraph,
  KnowledgeNode,
  StudySession,
  TopicManifest,
  TurnCapture
} from "../../shared/contracts.js";
import { DEFAULT_GOAL_SUGGESTIONS, TOPICS_DIR } from "./config.js";
import { analyzeGoalClarity, createPromptQueue } from "./learning-coach.js";
import type { SessionFile, TopicFile } from "./types.js";
import { createId, formatDate, nowIso, slugify, uniqueStrings } from "./utils.js";

function topicDir(topicId: string): string {
  return path.join(TOPICS_DIR, topicId);
}

function topicFilePath(topicId: string): string {
  return path.join(topicDir(topicId), "topic.json");
}

function graphFilePath(topicId: string): string {
  return path.join(topicDir(topicId), "graph.json");
}

function sessionJsonPath(topicId: string, sessionId: string): string {
  return path.join(topicDir(topicId), "sessions", `${sessionId}.json`);
}

function sessionMarkdownPath(topicId: string, sessionId: string, startedAt: string): string {
  return path.join(topicDir(topicId), "sessions", `${formatDate(startedAt)}-${sessionId}.md`);
}

function exportsDir(topicId: string): string {
  return path.join(topicDir(topicId), "exports");
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
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
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createRootNode(topicId: string, title: string, summary: string): KnowledgeNode {
  return {
    id: `root:${topicId}`,
    parentId: null,
    title,
    summary,
    evidenceTurnIds: [],
    children: []
  };
}

function starterChild(title: string, parentId: string): KnowledgeNode {
  const id = createId("seed");
  return {
    id,
    parentId,
    title,
    summary: `${title} 是后续学习时可以继续补充的问题域。`,
    evidenceTurnIds: [],
    children: []
  };
}

function buildStarterGraph(topicId: string, title: string): KnowledgeGraph {
  const root = createRootNode(topicId, title, "围绕该主题持续进行问答、总结与知识树沉淀。");
  const nodes: Record<string, KnowledgeNode> = {
    [root.id]: root
  };
  const starters = ["核心概念", "关键流程", "常见指标", "常见误区"].map((item) =>
    starterChild(item, root.id)
  );

  for (const node of starters) {
    nodes[node.id] = node;
    root.children.push(node.id);
  }

  return {
    topicId,
    rootId: root.id,
    nodes,
    updatedAt: nowIso()
  };
}

function normalizeTurnCapture(raw: TurnCapture): TurnCapture {
  return {
    id: raw.id,
    clientTurnId: raw.clientTurnId,
    question: raw.question,
    answer: raw.answer,
    summary: raw.summary,
    keyPoints: raw.keyPoints ?? [],
    misconceptions: raw.misconceptions ?? [],
    reviewItems: raw.reviewItems ?? [],
    answerQuality: raw.answerQuality ?? "partial",
    coachReply: raw.coachReply ?? "这是旧版学习记录，后续新一轮回答会自动补齐新的教学反馈。",
    blindSpots: raw.blindSpots ?? [],
    suggestedAnswer: raw.suggestedAnswer ?? [],
    nextQuestion: "nextQuestion" in raw ? raw.nextQuestion ?? null : null,
    createdAt: raw.createdAt
  };
}

function normalizeSessionFile(topic: TopicManifest, raw: SessionFile): SessionFile {
  const goalDetail = raw.session.goalDetail ?? topic.description;
  const session: StudySession = {
    ...raw.session,
    goalDetail
  };

  return {
    session,
    turns: (raw.turns ?? []).map((turn) => normalizeTurnCapture(turn)),
    goalClarity:
      "goalClarity" in raw && raw.goalClarity
        ? raw.goalClarity
        : analyzeGoalClarity(topic.title, goalDetail),
    promptQueue:
      "promptQueue" in raw && Array.isArray(raw.promptQueue)
        ? raw.promptQueue
        : createPromptQueue(topic.title, goalDetail),
    latestFeedback: "latestFeedback" in raw ? raw.latestFeedback ?? null : null
  };
}

function renderSessionMarkdown(topic: TopicManifest, session: StudySession, turns: TurnCapture[]): string {
  const lines: string[] = [
    `# ${topic.title} 学习纪要`,
    "",
    `- 会话 ID：${session.id}`,
    `- 学习目标：${session.goal}`,
    `- 学习背景：${session.goalDetail}`,
    `- 开始时间：${session.startedAt}`,
    `- 最近更新：${session.lastTurnAt}`,
    "",
    "## 学习轮次"
  ];

  if (!turns.length) {
    lines.push("", "当前还没有问答内容。");
    return lines.join("\n");
  }

  for (const turn of turns) {
    lines.push(
      "",
      `### ${turn.createdAt}`,
      "",
      `**问题**`,
      "",
      turn.question,
      "",
      `**回答**`,
      "",
      turn.answer,
      "",
      `**总结**`,
      "",
      turn.summary,
      "",
      `**知识点**`,
      "",
      ...turn.keyPoints.map((item) => `- ${item}`)
    );

    if (turn.misconceptions.length) {
      lines.push("", `**易错点**`, "", ...turn.misconceptions.map((item) => `- ${item}`));
    }

    if (turn.reviewItems.length) {
      lines.push("", `**复习提示**`, "", ...turn.reviewItems.map((item) => `- ${item}`));
    }

    lines.push(
      "",
      `**教练反馈**`,
      "",
      turn.coachReply,
      "",
      `**回答质量**`,
      "",
      turn.answerQuality
    );

    if ((turn.blindSpots ?? []).length) {
      lines.push("", `**盲区提醒**`, "", ...turn.blindSpots.map((item) => `- ${item}`));
    }

    if ((turn.suggestedAnswer ?? []).length) {
      lines.push("", `**建议回答骨架**`, "", ...turn.suggestedAnswer.map((item) => `- ${item}`));
    }

    if (turn.nextQuestion) {
      lines.push("", `**下一题**`, "", turn.nextQuestion);
    }
  }

  return lines.join("\n");
}

async function persistSessionMarkdown(topic: TopicManifest, sessionFile: SessionFile): Promise<void> {
  const filePath = sessionMarkdownPath(topic.id, sessionFile.session.id, sessionFile.session.startedAt);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, renderSessionMarkdown(topic, sessionFile.session, sessionFile.turns), "utf8");
}

async function persistTopicFile(topicId: string, topicFile: TopicFile): Promise<void> {
  await writeJsonFile(topicFilePath(topicId), topicFile);
}

export async function ensureBaseDirectories(): Promise<void> {
  await ensureDir(TOPICS_DIR);
}

export async function listTopics(): Promise<TopicManifest[]> {
  await ensureBaseDirectories();
  const entries = await fs.readdir(TOPICS_DIR, { withFileTypes: true });
  const topics: TopicManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const topic = await readJsonFile<TopicFile>(topicFilePath(entry.name));
    if (topic) {
      topics.push(topic.manifest);
    }
  }

  return topics.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createTopic(input: CreateTopicInput): Promise<TopicManifest> {
  await ensureBaseDirectories();
  const now = nowIso();
  const topicId = `${slugify(input.title)}-${Date.now().toString(36)}`;
  const manifest: TopicManifest = {
    id: topicId,
    title: input.title.trim(),
    description: input.description?.trim() || "通过系统追问、反馈讲解和知识树沉淀来学会这个主题。",
    tags: uniqueStrings(input.tags ?? []),
    createdAt: now,
    updatedAt: now
  };

  const topicFile: TopicFile = {
    manifest,
    activeSession: null,
    lastExport: null
  };

  await ensureDir(path.join(topicDir(topicId), "sessions"));
  await ensureDir(exportsDir(topicId));
  await persistTopicFile(topicId, topicFile);
  await writeJsonFile(graphFilePath(topicId), buildStarterGraph(topicId, manifest.title));

  return manifest;
}

export async function ensureStarterTopic(): Promise<TopicManifest> {
  const existing = await listTopics();
  if (existing.length) {
    return existing[0];
  }

  return createTopic({
    title: "招聘运营基础",
    description: "从岗位画像、渠道运营到漏斗复盘的招聘运营学习知识库。",
    tags: ["招聘", "运营", "学习"]
  });
}

export async function loadTopicFile(topicId: string): Promise<TopicFile> {
  const topic = await readJsonFile<TopicFile>(topicFilePath(topicId));
  if (!topic) {
    throw new Error(`Topic not found: ${topicId}`);
  }
  return topic;
}

export async function loadGraph(topicId: string): Promise<KnowledgeGraph> {
  const graph = await readJsonFile<KnowledgeGraph>(graphFilePath(topicId));
  if (!graph) {
    throw new Error(`Graph not found for topic: ${topicId}`);
  }
  return graph;
}

export async function saveGraph(graph: KnowledgeGraph): Promise<void> {
  await writeJsonFile(graphFilePath(graph.topicId), graph);
}

export async function loadSession(topicId: string, sessionId: string): Promise<SessionFile | null> {
  const raw = await readJsonFile<SessionFile>(sessionJsonPath(topicId, sessionId));
  if (!raw) {
    return null;
  }
  const topicFile = await loadTopicFile(topicId);
  return normalizeSessionFile(topicFile.manifest, raw);
}

export async function saveSession(topic: TopicManifest, sessionFile: SessionFile): Promise<void> {
  await writeJsonFile(sessionJsonPath(topic.id, sessionFile.session.id), sessionFile);
  await persistSessionMarkdown(topic, sessionFile);
}

export async function ensureActiveSession(topicId: string, preferredSessionId?: string): Promise<SessionFile> {
  const topicFile = await loadTopicFile(topicId);

  if (preferredSessionId) {
    const preferred = await loadSession(topicId, preferredSessionId);
    if (preferred) {
      topicFile.activeSession = preferred.session;
      await persistTopicFile(topicId, topicFile);
      return preferred;
    }
  }

  if (topicFile.activeSession) {
    const active = await loadSession(topicId, topicFile.activeSession.id);
    if (active) {
      return active;
    }
  }

  const now = nowIso();
  const session: StudySession = {
    id: createId("session"),
    topicId,
    goal: DEFAULT_GOAL_SUGGESTIONS[0],
    goalDetail: topicFile.manifest.description,
    status: "active",
    startedAt: now,
    lastTurnAt: now
  };
  const goalClarity = analyzeGoalClarity(topicFile.manifest.title, session.goalDetail);
  const sessionFile: SessionFile = {
    session,
    turns: [],
    goalClarity,
    promptQueue: createPromptQueue(topicFile.manifest.title, session.goalDetail),
    latestFeedback: null
  };
  topicFile.activeSession = session;
  topicFile.manifest.updatedAt = now;
  await persistTopicFile(topicId, topicFile);
  await saveSession(topicFile.manifest, sessionFile);
  return sessionFile;
}

export async function updateTopicActivity(
  topicId: string,
  updater: (topicFile: TopicFile) => TopicFile
): Promise<TopicFile> {
  const current = await loadTopicFile(topicId);
  const next = updater(current);
  await persistTopicFile(topicId, next);
  return next;
}

export function createExportFilePath(topicId: string, filename?: string): string {
  const safeName = filename?.trim() || `${topicId}-${new Date().toISOString().replace(/[:.]/g, "-")}.xmind`;
  return path.join(exportsDir(topicId), safeName.endsWith(".xmind") ? safeName : `${safeName}.xmind`);
}
