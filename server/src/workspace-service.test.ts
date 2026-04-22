import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createLearningTopic,
  exportXmindFile,
  openWorkspace,
  recordLearningTurn,
  refineKnowledgeMap
} from "./workspace-service.js";
import { KNOWLEDGE_BASE_DIR } from "./config.js";

async function resetKnowledgeBase() {
  await fs.rm(KNOWLEDGE_BASE_DIR, { recursive: true, force: true });
}

test("recordLearningTurn is idempotent for the same client turn id", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "数据分析练习",
    description: "我想学习招聘漏斗指标、分析工具和复盘方法，现在最卡在怎么解释指标变化。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });
  assert.ok(workspace.session);
  assert.ok(workspace.currentPrompt);
  assert.ok(workspace.goalClarity);

  const first = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: workspace.currentPrompt!.question,
    answer: "招聘漏斗是把候选人从投递到入职的过程拆成多个阶段，并观察每个阶段的转化。",
    turnClientId: "turn-1"
  });
  const second = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: workspace.currentPrompt!.question,
    answer: "招聘漏斗是把候选人从投递到入职的过程拆成多个阶段，并观察每个阶段的转化。",
    turnClientId: "turn-1"
  });

  assert.equal(first.turn.id, second.turn.id);
  assert.equal(second.workspace.recentTurns.length, 1);
  assert.equal(first.turn.question, workspace.currentPrompt!.question);
  assert.ok(first.workspace.latestFeedback);
});

test("refineKnowledgeMap merge keeps a single surviving node", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "招聘运营",
    description: "我想补招聘运营里的岗位画像和渠道复盘。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });
  const sessionId = workspace.session!.id;
  await recordLearningTurn({
    topicId: topic.id,
    sessionId,
    question: workspace.currentPrompt!.question,
    answer: "岗位画像用于明确人才画像、能力要求和业务场景。",
    turnClientId: "turn-a"
  });
  await recordLearningTurn({
    topicId: topic.id,
    sessionId,
    question: "岗位画像的作用是什么？",
    answer: "岗位画像帮助统一用人标准，也帮助渠道筛选更准确。",
    turnClientId: "turn-b"
  });
  const refreshed = await openWorkspace({ topicId: topic.id, sessionId });
  const duplicateIds = Object.values(refreshed.graph!.nodes)
    .filter((node) => node.title.includes("岗位画像"))
    .map((node) => node.id);

  const merged = await refineKnowledgeMap({
    topicId: topic.id,
    sessionId,
    action: "merge",
    nodeIds: duplicateIds
  });

  const mergedCount = Object.values(merged.graph.nodes).filter((node) => node.title.includes("岗位画像")).length;
  assert.equal(mergedCount, 1);
});

test("exportXmindFile creates a real xmind file on disk", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "招聘数据分析",
    description: "我想学招聘分析里的漏斗、渠道和转化诊断。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });
  await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: workspace.currentPrompt!.question,
    answer: "先分阶段看转化率，再结合岗位、渠道和面试官维度定位流失点。",
    turnClientId: "turn-export"
  });

  const result = await exportXmindFile({
    topicId: topic.id,
    sessionId: workspace.session!.id
  });

  const stat = await fs.stat(result.exportStatus.path);
  assert.ok(stat.isFile());
  assert.equal(path.extname(result.exportStatus.path), ".xmind");
});

test("recordLearningTurn returns coaching feedback and advances to the next question", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "招聘运营",
    description: "我想系统学习招聘运营的指标、工具和分析方法，用在周报和复盘汇报里。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });
  const firstPrompt = workspace.currentPrompt;

  assert.ok(firstPrompt);
  assert.ok(workspace.goalClarity);
  assert.ok(workspace.goalClarity!.clarificationQuestions.length > 0);

  const result = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: firstPrompt!.question,
    answer:
      "招聘运营的核心目标是让招聘过程更高效也更稳定。它不只是安排流程，还要通过指标、协同机制和复盘去提升招聘质量。",
    turnClientId: "turn-feedback"
  });

  assert.ok(result.workspace.latestFeedback);
  assert.equal(result.turn.question, firstPrompt!.question);
  assert.notEqual(result.workspace.currentPrompt?.question, firstPrompt!.question);
});

test("strong answers advance to the next intent instead of repeating the same prompt", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "招聘运营进阶",
    description: "我想系统学习招聘运营的指标、工具和分析方法，用在周报和复盘汇报里。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });
  const firstIntent = workspace.currentPrompt?.intent;

  const result = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: workspace.currentPrompt!.question,
    answer:
      "招聘运营的目标，是让招聘目标能够被稳定交付，并让过程更高效。它的职责边界不只是执行招聘动作，还包括设计流程、看指标、做复盘和推动协同。它的价值在于同时提升招聘效率、招聘质量和组织协同的可预测性。",
    turnClientId: "turn-strong-progress"
  });

  assert.equal(result.turn.answerQuality, "strong");
  assert.notEqual(result.workspace.currentPrompt?.intent, firstIntent);
});

test("follow-up prompts do not recursively duplicate their leading prefix", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "多轮追问",
    description: "我想学习招聘运营的核心概念。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });

  const first = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: workspace.currentPrompt!.question,
    answer: "它是帮助招聘推进的，也会看数据和流程。",
    turnClientId: "turn-followup-1"
  });
  const second = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: first.workspace.currentPrompt!.question,
    answer: "它是帮助招聘推进的，也会看数据和流程。",
    turnClientId: "turn-followup-2"
  });

  assert.match(first.workspace.currentPrompt!.question, /^换个更具体的角度再回答一次：/);
  assert.match(second.workspace.currentPrompt!.question, /^换个更具体的角度再回答一次：/);
  assert.doesNotMatch(second.workspace.currentPrompt!.question, /换个更具体的角度再回答一次：换个更具体的角度再回答一次：/);
});

test("goal detail reprioritizes the first prompt toward the requested learning focus", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "招聘运营专题",
    description: "我最想先补招聘运营里的指标口径和渠道复盘方法。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });

  assert.equal(workspace.currentPrompt?.intent, "metrics");
});

test("legacy turns without coaching fields remain writable after normalization", async () => {
  await resetKnowledgeBase();
  const topic = await createLearningTopic({
    title: "兼容性测试",
    description: "我想学习招聘运营的基础概念。"
  });
  const workspace = await openWorkspace({ topicId: topic.id });
  const sessionPath = path.join(
    KNOWLEDGE_BASE_DIR,
    "topics",
    topic.id,
    "sessions",
    `${workspace.session!.id}.json`
  );
  const sessionJson = JSON.parse(await fs.readFile(sessionPath, "utf8")) as {
    session: unknown;
    turns: Array<Record<string, unknown>>;
  };

  sessionJson.turns.push({
    id: "legacy-turn",
    clientTurnId: "legacy-turn",
    question: "什么是招聘运营？",
    answer: "它是帮助招聘推进的。",
    summary: "它是帮助招聘推进的。",
    keyPoints: ["它是帮助招聘推进的。"],
    misconceptions: [],
    reviewItems: [],
    createdAt: "2026-03-22T00:00:00.000Z"
  });

  await fs.writeFile(sessionPath, JSON.stringify(sessionJson, null, 2), "utf8");

  const reopened = await openWorkspace({ topicId: topic.id, sessionId: workspace.session!.id });
  assert.equal(reopened.recentTurns.length, 1);

  const result = await recordLearningTurn({
    topicId: topic.id,
    sessionId: workspace.session!.id,
    question: reopened.currentPrompt!.question,
    answer: "招聘运营的目标是让招聘流程更稳定、更高效。",
    turnClientId: "new-turn-after-legacy"
  });

  assert.equal(result.workspace.recentTurns.length, 2);
});
