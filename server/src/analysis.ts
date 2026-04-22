import type { KnowledgeDelta, KnowledgeGraph } from "../../shared/contracts.js";
import { createId, clampText, normalizeTitle, splitSentences, uniqueStrings } from "./utils.js";

interface TurnSynthesis {
  summary: string;
  keyPoints: string[];
  misconceptions: string[];
  reviewItems: string[];
  graph: KnowledgeGraph;
  delta: KnowledgeDelta;
}

const MISCONCEPTION_PATTERN =
  /(不是|不要|误区|避免|切忌|错误|陷阱|误以为|not |avoid|mistake|wrong)/i;

function extractQuestionFocus(question: string): string | null {
  const patterns = [
    /什么是(.+?)(?:[？?]|$)/,
    /如何(.+?)(?:[？?]|$)/,
    /怎么(.+?)(?:[？?]|$)/,
    /怎样(.+?)(?:[？?]|$)/,
    /(.+?)的核心是什么/,
    /what is (.+?)(?:\?|$)/i,
    /how to (.+?)(?:\?|$)/i
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) {
      return clampText(match[1].trim(), 18);
    }
  }

  const cleaned = question.replace(/[？?]/g, "").trim();
  return cleaned ? clampText(cleaned, 18) : null;
}

function sentenceToNodeTitle(sentence: string): string {
  const cleaned = sentence
    .replace(/^[\-\d、.\s]+/, "")
    .replace(/^(首先|其次|最后|另外|同时|通常|一般来说)\s*/u, "")
    .trim();

  const boundary = cleaned.search(/[，,:：]/);
  const segment = boundary > 0 ? cleaned.slice(0, boundary) : cleaned;
  return clampText(segment || cleaned, 18);
}

function findParentId(graph: KnowledgeGraph, question: string, answer: string): string {
  const combined = `${question} ${answer}`;
  const candidates = Object.values(graph.nodes).filter((node) => node.id !== graph.rootId);
  let best = graph.rootId;
  let score = 0;

  for (const node of candidates) {
    const normalized = normalizeTitle(node.title);
    if (!normalized) {
      continue;
    }

    if (normalizeTitle(combined).includes(normalized) && normalized.length > score) {
      best = node.id;
      score = normalized.length;
    }
  }

  return best;
}

function mergeNodeSummary(current: string, incoming: string): string {
  if (!incoming.trim()) {
    return current;
  }
  if (!current.trim()) {
    return clampText(incoming, 200);
  }
  if (current.includes(incoming)) {
    return current;
  }

  return clampText(`${current} ${incoming}`, 240);
}

function ensureChild(graph: KnowledgeGraph, parentId: string, childId: string): void {
  const parent = graph.nodes[parentId];
  if (!parent.children.includes(childId)) {
    parent.children.push(childId);
  }
}

function collectNodeTitles(question: string, keyPoints: string[]): string[] {
  const titles: string[] = [];
  const focus = extractQuestionFocus(question);
  if (focus) {
    titles.push(focus);
  }

  for (const keyPoint of keyPoints) {
    const title = sentenceToNodeTitle(keyPoint);
    if (title) {
      titles.push(title);
    }
  }

  return uniqueStrings(titles).slice(0, 4);
}

export function synthesizeTurn(
  graph: KnowledgeGraph,
  question: string,
  answer: string,
  turnId: string
): TurnSynthesis {
  const answerSentences = splitSentences(answer);
  const questionFocus = extractQuestionFocus(question);
  const summary = clampText(
    answerSentences[0] ?? questionFocus ?? "本轮围绕该主题进行了学习沉淀。",
    120
  );
  const keyPoints = uniqueStrings(
    (answerSentences.length ? answerSentences : splitSentences(question)).map((item) =>
      clampText(item, 80)
    )
  ).slice(0, 4);
  const misconceptions = keyPoints.filter((item) => MISCONCEPTION_PATTERN.test(item)).slice(0, 3);
  const reviewItems = uniqueStrings(
    [
      questionFocus ? `复述 ${questionFocus} 的核心逻辑。` : "",
      ...keyPoints.slice(0, 3).map((item) => `尝试不用原文解释：${item}`),
      ...misconceptions.map((item) => `避免误区：${item}`)
    ].filter(Boolean)
  ).slice(0, 5);

  const nextGraph: KnowledgeGraph = {
    ...graph,
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => [
        id,
        {
          ...node,
          children: [...node.children],
          evidenceTurnIds: [...node.evidenceTurnIds]
        }
      ])
    )
  };

  const parentId = findParentId(nextGraph, question, answer);
  const titles = collectNodeTitles(question, keyPoints);
  const addedNodeIds: string[] = [];
  const updatedNodeIds: string[] = [];

  for (const title of titles) {
    const existing = Object.values(nextGraph.nodes).find(
      (node) => normalizeTitle(node.title) === normalizeTitle(title)
    );

    if (existing) {
      existing.summary = mergeNodeSummary(existing.summary, summary);
      if (!existing.evidenceTurnIds.includes(turnId)) {
        existing.evidenceTurnIds.push(turnId);
      }
      updatedNodeIds.push(existing.id);
      continue;
    }

    const nodeId = createId("node");
    nextGraph.nodes[nodeId] = {
      id: nodeId,
      parentId,
      title,
      summary,
      evidenceTurnIds: [turnId],
      children: []
    };
    ensureChild(nextGraph, parentId, nodeId);
    addedNodeIds.push(nodeId);
  }

  nextGraph.updatedAt = new Date().toISOString();

  return {
    summary,
    keyPoints,
    misconceptions,
    reviewItems,
    graph: nextGraph,
    delta: {
      parentId,
      addedNodeIds,
      updatedNodeIds: uniqueStrings(updatedNodeIds)
    }
  };
}
