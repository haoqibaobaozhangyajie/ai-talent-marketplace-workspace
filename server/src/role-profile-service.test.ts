import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  answerRoleProfileQuestion,
  createRoleProfileDraft,
  finalizeRoleProfile,
  openRoleProfileWorkspace
} from "./role-profile-service.js";
import { ROLE_PROFILE_DIR } from "./config.js";

async function resetRoleProfiles() {
  await fs.rm(ROLE_PROFILE_DIR, { recursive: true, force: true });
}

test("createRoleProfileDraft returns a usable default workspace for empty input", async () => {
  await resetRoleProfiles();
  const workspace = await createRoleProfileDraft({});

  assert.ok(workspace.draft);
  assert.equal(workspace.draft!.targetRole, "待明确岗位");
  assert.ok(workspace.pendingQuestions.length >= 4);
  assert.equal(workspace.clarityScore > 0, true);
  assert.equal(workspace.readyForSearch, false);
});

test("minimal draft prioritizes business context, responsibilities, must-haves, and risks", async () => {
  await resetRoleProfiles();
  const workspace = await createRoleProfileDraft({
    targetRole: "产品经理"
  });

  const questionFields = workspace.pendingQuestions.map((item) => item.field);
  assert.deepEqual(questionFields.slice(0, 4), [
    "businessContext",
    "currentStage",
    "coreResponsibilities",
    "mustHaves"
  ]);
  assert.equal(questionFields.includes("riskConstraints"), true);
});

test("answerRoleProfileQuestion refreshes clarity and advances the next question", async () => {
  await resetRoleProfiles();
  const created = await createRoleProfileDraft({
    targetRole: "产品经理"
  });
  const firstQuestion = created.currentQuestion;

  assert.ok(created.draft);
  assert.ok(firstQuestion);

  const answered = await answerRoleProfileQuestion({
    draftId: created.draft!.id,
    questionId: firstQuestion!.id,
    answer: "服务 B 端产品团队，重点解决复杂流程效率和业务落地问题。"
  });

  assert.ok(answered.workspace.draft);
  assert.notEqual(answered.workspace.currentQuestion?.id, firstQuestion!.id);
  assert.equal(answered.workspace.draft!.businessContext.includes("B 端产品团队"), true);
  assert.equal(answered.workspace.clarityScore > created.clarityScore, true);
});

test("finalizeRoleProfile produces reusable profile, search strategy, and screening guide", async () => {
  await resetRoleProfiles();
  const created = await createRoleProfileDraft({
    targetRole: "产品经理",
    businessContext: "服务 B 端业务产品团队，处理复杂流程和跨部门协同。",
    currentStage: "业务已过 0-1，进入多团队协同和流程优化阶段。",
    coreResponsibilities: ["负责复杂需求拆解", "推动跨团队方案落地", "建立需求优先级机制"],
    mustHaves: ["有 B 端产品经验", "做过复杂流程设计", "有跨团队推进案例"],
    niceToHaves: ["做过工作台类产品", "有数据分析习惯"],
    riskConstraints: ["只做过标准化功能", "没有复杂场景取舍案例"],
    notes: "后续要接人才搜索与初筛。"
  });

  const finalized = await finalizeRoleProfile({
    draftId: created.draft!.id
  });
  const reopened = await openRoleProfileWorkspace({
    draftId: created.draft!.id
  });

  assert.equal(finalized.workspace.readyForSearch, true);
  assert.equal(finalized.workspace.draft?.status, "ready");
  assert.ok(finalized.workspace.profileCard);
  assert.ok(finalized.workspace.searchStrategy);
  assert.ok(finalized.workspace.screeningGuide);
  assert.match(finalized.workspace.searchStrategy!.booleanQuery, /AND/);
  assert.equal(reopened.readyForSearch, true);
});
