import type {
  CreateTopicInput,
  ExportXMindInput,
  ExportXMindResult,
  KnowledgeGraph,
  OpenWorkspaceInput,
  RecordLearningTurnInput,
  RecordTurnResult,
  RefineKnowledgeMapInput,
  RefineMapResult,
  TurnCapture,
  WorkspaceState
} from "../../shared/contracts.js";
import { synthesizeTurn } from "./analysis.js";
import { DEFAULT_GOAL_SUGGESTIONS } from "./config.js";
import {
  createExportFilePath,
  createTopic,
  ensureActiveSession,
  ensureStarterTopic,
  listTopics,
  loadGraph,
  loadSession,
  loadTopicFile,
  saveGraph,
  saveSession,
  updateTopicActivity
} from "./knowledge-base.js";
import { advancePromptQueue, buildTeachingFeedback, createPromptQueue } from "./learning-coach.js";
import type { SessionFile } from "./types.js";
import { createId, nowIso, uniqueStrings } from "./utils.js";
import { exportGraphToXmind } from "./xmind-export.js";

function collectPendingReview(turns: TurnCapture[]): string[] {
  return uniqueStrings(turns.flatMap((turn) => turn.reviewItems)).slice(0, 8);
}

async function buildWorkspaceState(topicId?: string, sessionId?: string): Promise<WorkspaceState> {
  const topics = await listTopics();
  const topic = topics.find((item) => item.id === topicId) ?? topics[0] ?? (await ensureStarterTopic());
  const graph = await loadGraph(topic.id);
  const sessionFile = await ensureActiveSession(topic.id, sessionId);
  const topicFile = await loadTopicFile(topic.id);
  const recentTurns = sessionFile.turns.slice(-8).reverse();

  return {
    topic: topicFile.manifest,
    session: sessionFile.session,
    graph,
    recentTurns,
    goalClarity: sessionFile.goalClarity,
    currentPrompt: sessionFile.promptQueue[0] ?? null,
    promptQueue: sessionFile.promptQueue,
    latestFeedback: sessionFile.latestFeedback,
    pendingReview: collectPendingReview(recentTurns),
    exportStatus: topicFile.lastExport,
    availableTopics: topics.length ? topics : [topicFile.manifest],
    goalSuggestions: DEFAULT_GOAL_SUGGESTIONS
  };
}

function cloneGraph(graph: KnowledgeGraph): KnowledgeGraph {
  return JSON.parse(JSON.stringify(graph)) as KnowledgeGraph;
}

function mergeNodes(graph: KnowledgeGraph, nodeIds: string[]): KnowledgeGraph {
  const nextGraph = cloneGraph(graph);
  const validIds = nodeIds.filter((id) => id in nextGraph.nodes && id !== nextGraph.rootId);
  if (validIds.length < 2) {
    return nextGraph;
  }
  const [primaryId, ...others] = validIds;
  const primary = nextGraph.nodes[primaryId];

  for (const nodeId of others) {
    const node = nextGraph.nodes[nodeId];
    primary.summary = uniqueStrings([primary.summary, node.summary]).join(" ");
    primary.evidenceTurnIds = uniqueStrings([...primary.evidenceTurnIds, ...node.evidenceTurnIds]);
    for (const childId of node.children) {
      nextGraph.nodes[childId].parentId = primaryId;
      if (!primary.children.includes(childId)) {
        primary.children.push(childId);
      }
    }
    const parent = node.parentId ? nextGraph.nodes[node.parentId] : null;
    if (parent) {
      parent.children = parent.children.filter((childId) => childId !== nodeId);
    }
    delete nextGraph.nodes[nodeId];
  }

  nextGraph.updatedAt = nowIso();
  return nextGraph;
}

function splitNode(graph: KnowledgeGraph, nodeIds: string[]): KnowledgeGraph {
  const nextGraph = cloneGraph(graph);
  const nodeId = nodeIds[0];
  const node = nodeId ? nextGraph.nodes[nodeId] : undefined;
  if (!node) {
    return nextGraph;
  }

  const pieces = node.summary
    .split(/[。！？!?;；]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  for (const piece of pieces) {
    const childId = createId("split");
    nextGraph.nodes[childId] = {
      id: childId,
      parentId: node.id,
      title: piece.slice(0, 16),
      summary: piece,
      evidenceTurnIds: [...node.evidenceTurnIds],
      children: []
    };
    node.children.push(childId);
  }

  nextGraph.updatedAt = nowIso();
  return nextGraph;
}

function reparentNodes(graph: KnowledgeGraph, nodeIds: string[], targetParentId?: string): KnowledgeGraph {
  const nextGraph = cloneGraph(graph);
  const targetId = targetParentId && nextGraph.nodes[targetParentId] ? targetParentId : nextGraph.rootId;

  for (const nodeId of nodeIds) {
    const node = nextGraph.nodes[nodeId];
    if (!node || node.id === nextGraph.rootId) {
      continue;
    }
    if (node.parentId && nextGraph.nodes[node.parentId]) {
      nextGraph.nodes[node.parentId].children = nextGraph.nodes[node.parentId].children.filter(
        (childId) => childId !== node.id
      );
    }
    node.parentId = targetId;
    if (!nextGraph.nodes[targetId].children.includes(node.id)) {
      nextGraph.nodes[targetId].children.push(node.id);
    }
  }

  nextGraph.updatedAt = nowIso();
  return nextGraph;
}

function autoRefine(graph: KnowledgeGraph): KnowledgeGraph {
  const titleMap = new Map<string, string[]>();
  for (const node of Object.values(graph.nodes)) {
    if (node.id === graph.rootId) {
      continue;
    }
    const key = node.title.toLowerCase().replace(/\s+/g, "");
    const bucket = titleMap.get(key) ?? [];
    bucket.push(node.id);
    titleMap.set(key, bucket);
  }

  let nextGraph = cloneGraph(graph);
  for (const ids of titleMap.values()) {
    if (ids.length > 1) {
      nextGraph = mergeNodes(nextGraph, ids);
    }
  }

  return nextGraph;
}

export async function openWorkspace(input: OpenWorkspaceInput = {}): Promise<WorkspaceState> {
  await ensureStarterTopic();
  return buildWorkspaceState(input.topicId, input.sessionId);
}

export async function createLearningTopic(input: CreateTopicInput) {
  return createTopic(input);
}

export async function recordLearningTurn(input: RecordLearningTurnInput): Promise<RecordTurnResult> {
  const topicFile = await loadTopicFile(input.topicId);
  const graph = await loadGraph(input.topicId);
  const sessionFile =
    (await loadSession(input.topicId, input.sessionId)) ?? (await ensureActiveSession(input.topicId, input.sessionId));
  const duplicate = sessionFile.turns.find((turn) => turn.clientTurnId === input.turnClientId);

  if (duplicate) {
    return {
      turn: duplicate,
      delta: {
        parentId: graph.rootId,
        addedNodeIds: [],
        updatedNodeIds: []
      },
      workspace: await buildWorkspaceState(input.topicId, sessionFile.session.id)
    };
  }

  const promptQueue = sessionFile.promptQueue.length
    ? sessionFile.promptQueue
    : createPromptQueue(topicFile.manifest.title, sessionFile.session.goalDetail);
  const currentPrompt = promptQueue[0];
  const question = currentPrompt?.question ?? input.question.trim();
  const feedback = currentPrompt
    ? buildTeachingFeedback(topicFile.manifest.title, currentPrompt, input.answer)
    : {
        answerQuality: "partial" as const,
        coachReply: "这轮内容已经记录，我建议下一轮继续用结构化方式回答。",
        highlights: ["内容已被记录到知识树。"],
        blindSpots: [],
        suggestedAnswer: ["先讲概念", "再讲结构", "最后讲例子"],
        nextStep: "继续下一题。"
      };
  const turnId = createId("turn");
  const nextPromptQueue = advancePromptQueue(promptQueue, feedback);
  const synthesized = synthesizeTurn(graph, question, input.answer, turnId);
  const createdAt = nowIso();
  const turn: TurnCapture = {
    id: turnId,
    clientTurnId: input.turnClientId,
    question,
    answer: input.answer.trim(),
    summary: synthesized.summary,
    keyPoints: synthesized.keyPoints,
    misconceptions: synthesized.misconceptions,
    reviewItems: synthesized.reviewItems,
    answerQuality: feedback.answerQuality,
    coachReply: feedback.coachReply,
    blindSpots: feedback.blindSpots,
    suggestedAnswer: feedback.suggestedAnswer,
    nextQuestion: nextPromptQueue[0]?.question ?? null,
    createdAt
  };

  const nextSessionFile: SessionFile = {
    session: {
      ...sessionFile.session,
      lastTurnAt: createdAt
    },
    turns: [...sessionFile.turns, turn],
    goalClarity: sessionFile.goalClarity,
    promptQueue: nextPromptQueue,
    latestFeedback: feedback
  };

  await saveGraph(synthesized.graph);
  await saveSession(topicFile.manifest, nextSessionFile);
  await updateTopicActivity(input.topicId, (current) => ({
    ...current,
    manifest: {
      ...current.manifest,
      updatedAt: createdAt
    },
    activeSession: nextSessionFile.session
  }));

  return {
    turn,
    delta: synthesized.delta,
    workspace: await buildWorkspaceState(input.topicId, nextSessionFile.session.id)
  };
}

export async function refineKnowledgeMap(input: RefineKnowledgeMapInput): Promise<RefineMapResult> {
  const current = await loadGraph(input.topicId);
  const nodeIds = input.nodeIds ?? [];
  let nextGraph = current;

  switch (input.action) {
    case "auto":
      nextGraph = autoRefine(current);
      break;
    case "merge":
      nextGraph = mergeNodes(current, nodeIds);
      break;
    case "split":
      nextGraph = splitNode(current, nodeIds);
      break;
    case "reparent":
      nextGraph = reparentNodes(current, nodeIds, input.targetParentId);
      break;
  }

  await saveGraph(nextGraph);
  await updateTopicActivity(input.topicId, (topicFile) => ({
    ...topicFile,
    manifest: {
      ...topicFile.manifest,
      updatedAt: nowIso()
    }
  }));

  return {
    graph: nextGraph,
    workspace: await buildWorkspaceState(input.topicId, input.sessionId)
  };
}

export async function exportXmindFile(input: ExportXMindInput): Promise<ExportXMindResult> {
  const graph = await loadGraph(input.topicId);
  const topicFile = await loadTopicFile(input.topicId);
  const exportStatus = await exportGraphToXmind(graph, createExportFilePath(input.topicId, input.filename));
  await updateTopicActivity(input.topicId, (current) => ({
    ...current,
    manifest: {
      ...current.manifest,
      updatedAt: exportStatus.exportedAt
    },
    lastExport: exportStatus
  }));

  return {
    exportStatus,
    workspace: await buildWorkspaceState(input.topicId, input.sessionId ?? topicFile.activeSession?.id)
  };
}
