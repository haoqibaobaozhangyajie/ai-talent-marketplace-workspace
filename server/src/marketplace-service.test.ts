import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  matchByEmployee,
  matchByJob,
  normalizeEmployeeProfile,
  normalizeJobProfile,
  openMarketplaceWorkspace,
  reviewMatch
} from "./marketplace-service.js";
import { MARKETPLACE_DIR } from "./config.js";

async function resetMarketplace() {
  await fs.rm(MARKETPLACE_DIR, { recursive: true, force: true });
}

test("openMarketplaceWorkspace seeds a demo marketplace dataset", { concurrency: false }, async () => {
  await resetMarketplace();
  const workspace = await openMarketplaceWorkspace();

  assert.equal(workspace.overview.employeeCount, 32);
  assert.equal(workspace.overview.jobCount, 12);
  assert.equal(workspace.overview.movementCount, 6);
  assert.equal(workspace.selectedJob?.title, "人才发展岗");
  assert.ok(workspace.jobMatches.length > 0);
});

test("matchByJob returns explainable recommendations for the talent-development role", { concurrency: false }, async () => {
  await resetMarketplace();
  const workspace = await openMarketplaceWorkspace();
  const talentJob = workspace.jobs.find((job) => job.title === "人才发展岗");

  assert.ok(talentJob);

  const matched = await matchByJob({ jobId: talentJob!.jobId, limit: 5 });
  assert.equal(matched.workspace.jobMatches.length, 5);
  assert.equal(matched.workspace.jobMatches[0]!.overallScore >= matched.workspace.jobMatches[4]!.overallScore, true);
  assert.equal(matched.workspace.jobMatches.some((item) => item.reasons.length > 0), true);
});

test("matchByEmployee recommends internal roles for a recruiting manager with mobility intent", { concurrency: false }, async () => {
  await resetMarketplace();
  const workspace = await openMarketplaceWorkspace();
  const employee = workspace.employees.find(
    (item) => item.currentRole === "招聘经理" && item.mobilityIntent === "active"
  );

  assert.ok(employee);

  const matched = await matchByEmployee({ employeeId: employee!.employeeId, limit: 5 });
  const targetTitles = matched.workspace.employeeMatches.map((item) => item.targetLabel);

  assert.equal(targetTitles.includes("人才发展岗"), true);
  assert.equal(matched.workspace.employeeMatches[0]!.reasons.length > 0, true);
});

test("incomplete employee profiles surface uncertainty risks in matching", { concurrency: false }, async () => {
  await resetMarketplace();
  const workspace = await openMarketplaceWorkspace();
  const employee = workspace.employees.find((item) => item.name === "袁朵");

  assert.ok(employee);

  const matched = await matchByEmployee({ employeeId: employee!.employeeId, limit: 3 });
  assert.equal(
    matched.workspace.employeeMatches.some((item) =>
      item.risks.some((risk) => risk.includes("人才画像信息不完整"))
    ),
    true
  );
});

test("normalize endpoints append new records and reviewMatch persists a human decision", { concurrency: false }, async () => {
  await resetMarketplace();
  const initial = await openMarketplaceWorkspace();

  const jobNormalized = await normalizeJobProfile({
    rawText:
      "内部人才市场项目经理\n北京\n负责推动内部流动机制和岗位画像标准。\n要求有人才项目管理经验，能做跨团队推进。\n有招聘或人才发展背景优先。"
  });
  assert.equal(jobNormalized.workspace.overview.jobCount, initial.overview.jobCount + 1);

  const employeeNormalized = await normalizeEmployeeProfile({
    rawText:
      "李女士，现任招聘运营经理，参与内部流动试点和招聘数据分析，希望转向人才发展或组织发展岗位，可接受北京。"
  });
  assert.equal(employeeNormalized.workspace.overview.employeeCount, initial.overview.employeeCount + 1);

  const reviewed = await reviewMatch({
    matchId: employeeNormalized.workspace.employeeMatches[0]!.matchId,
    reviewer: "测试面试官",
    decision: "hold",
    comment: "建议补充项目 owner 证据。"
  });

  assert.equal(reviewed.workspace.reviewDecisions[0]?.reviewer, "测试面试官");
  assert.equal(reviewed.workspace.reviewDecisions[0]?.decision, "hold");
});
