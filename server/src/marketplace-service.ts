import fs from "node:fs/promises";
import path from "node:path";
import type {
  EmployeeProfile,
  JobProfile,
  MatchByEmployeeInput,
  MatchByJobInput,
  MatchResult,
  MatchSourceType,
  MarketplaceOverview,
  MarketplaceWorkspaceState,
  MobilityIntent,
  MovementRecord,
  NormalizeEmployeeProfileInput,
  NormalizeJobProfileInput,
  OpenMarketplaceWorkspaceInput,
  PerformanceLevel,
  PotentialLevel,
  ReviewDecision,
  ReviewDecisionType,
  ReviewMatchInput
} from "../../shared/contracts.js";
import { MARKETPLACE_DIR } from "./config.js";
import { clampText, createId, nowIso, uniqueStrings } from "./utils.js";

const EMPLOYEES_FILE = "employees.json";
const JOBS_FILE = "jobs.json";
const MOVEMENT_HISTORY_FILE = "movement-history.json";
const REVIEWS_FILE = "reviews.json";

const LEVEL_ORDER: Record<string, number> = {
  P4: 4,
  P5: 5,
  P6: 6,
  P7: 7,
  M1: 8,
  M2: 9
};

const CITY_LIST = ["北京", "上海", "深圳", "广州", "杭州"];

type EmployeeSeedTemplate = {
  org: string;
  currentRole: string;
  jobFamily: string;
  skills: string[];
  projectTags: string[];
  industryTags: string[];
  certifications: string[];
  preferredFunctions: string[];
  preferredCities: string[];
  resumeText: string;
  managerComment: string;
  trainingHistory: string[];
  constraints: string[];
  performanceLevels: PerformanceLevel[];
  potentialLevels: PotentialLevel[];
  mobilityIntents: MobilityIntent[];
  levels: string[];
};

function marketplacePath(filename: string): string {
  return path.join(MARKETPLACE_DIR, filename);
}

async function ensureMarketplaceDir(): Promise<void> {
  await fs.mkdir(MARKETPLACE_DIR, { recursive: true });
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
  await ensureMarketplaceDir();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function cleanText(value?: string): string {
  return value?.trim() ?? "";
}

function cleanList(values?: string[]): string[] {
  return uniqueStrings((values ?? []).map((item) => item.trim()).filter(Boolean));
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").trim();
}

function fuzzyIncludes(left: string, right: string): boolean {
  const normalizedLeft = normalizeToken(left);
  const normalizedRight = normalizeToken(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function firstMatching(items: string[], targets: string[]): string[] {
  return uniqueStrings(
    targets.filter((target) =>
      items.some((item) => fuzzyIncludes(item, target))
    )
  );
}

function extractLines(value: string): string[] {
  return uniqueStrings(
    value
      .split(/\r?\n|[；;]+/g)
      .map((line) => line.replace(/^[\-\d\.\s、]+/, "").trim())
      .filter((line) => line.length >= 2)
  );
}

function inferJobFamily(text: string): string {
  if (/(人才发展|继任|人才盘点|任职资格)/.test(text)) {
    return "人才发展";
  }
  if (/(组织发展|od|组织设计)/i.test(text)) {
    return "组织发展";
  }
  if (/(学习发展|培训|学习项目)/.test(text)) {
    return "学习发展";
  }
  if (/(招聘|雇主品牌|猎聘)/.test(text)) {
    return "招聘";
  }
  if (/(hrbp|人力业务伙伴)/i.test(text)) {
    return "HRBP";
  }
  if (/(人效|分析|数据)/.test(text)) {
    return "人效分析";
  }
  if (/(产品)/.test(text)) {
    return "产品";
  }
  if (/(运营)/.test(text)) {
    return "运营";
  }
  return "综合人力";
}

function inferDept(jobFamily: string): string {
  switch (jobFamily) {
    case "人才发展":
    case "组织发展":
      return "人才与组织发展部";
    case "学习发展":
      return "学习发展中心";
    case "招聘":
      return "招聘与雇主品牌部";
    case "HRBP":
      return "人力资源业务伙伴部";
    case "人效分析":
      return "人力数据与效能部";
    case "产品":
      return "内部产品平台部";
    case "运营":
      return "业务运营中心";
    default:
      return "人才中台项目组";
  }
}

function inferLocation(text: string): string {
  return CITY_LIST.find((city) => text.includes(city)) ?? "北京";
}

function inferLevelRange(text: string): { min: string; max: string } {
  if (/(m1|经理|负责人)/i.test(text)) {
    return { min: "P7", max: "M1" };
  }
  if (/(高级|资深|leader)/i.test(text)) {
    return { min: "P6", max: "P7" };
  }
  return { min: "P5", max: "P6" };
}

function buildKeywords(parts: string[]): string[] {
  return uniqueStrings(
    parts
      .flatMap((part) => part.split(/[，。,:：/]/g))
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  ).slice(0, 8);
}

function fileIntegrityScore(employee: EmployeeProfile): number {
  let score = 100;
  if (!employee.managerComment) {
    score -= 15;
  }
  if (!employee.trainingHistory.length) {
    score -= 10;
  }
  if (!employee.resumeText) {
    score -= 20;
  }
  return Math.max(score, 45);
}

function baseIntentScore(intent: MobilityIntent): number {
  switch (intent) {
    case "active":
      return 88;
    case "open":
      return 72;
    case "steady":
      return 46;
    default:
      return 60;
  }
}

function levelScore(employeeLevel: string, minLevel: string, maxLevel: string): number {
  const employeeRank = LEVEL_ORDER[employeeLevel] ?? 6;
  const minRank = LEVEL_ORDER[minLevel] ?? 5;
  const maxRank = LEVEL_ORDER[maxLevel] ?? 7;
  if (employeeRank >= minRank && employeeRank <= maxRank) {
    return 100;
  }
  if (Math.abs(employeeRank - minRank) <= 1 || Math.abs(employeeRank - maxRank) <= 1) {
    return 78;
  }
  return 54;
}

function findPrecedent(
  employee: EmployeeProfile,
  job: JobProfile,
  movementHistory: MovementRecord[]
): MovementRecord | null {
  return (
    movementHistory.find((record) => {
      const sameSource =
        fuzzyIncludes(record.fromRole, employee.currentRole) || fuzzyIncludes(record.fromFamily, employee.jobFamily);
      const sameTarget =
        fuzzyIncludes(record.toRole, job.title) || fuzzyIncludes(record.toFamily, job.jobFamily);
      return sameSource && sameTarget;
    }) ?? null
  );
}

function buildMatchId(sourceType: MatchSourceType, sourceId: string, targetId: string): string {
  return `${sourceType}__${sourceId}__${targetId}`;
}

function parseMatchId(matchId: string): { sourceType: MatchSourceType; sourceId: string; targetId: string } {
  const [sourceType, sourceId, targetId] = matchId.split("__");
  if ((sourceType !== "job" && sourceType !== "employee") || !sourceId || !targetId) {
    throw new Error("Invalid match id.");
  }
  return { sourceType, sourceId, targetId };
}

function employeeEvidence(employee: EmployeeProfile): string[] {
  return [
    employee.currentRole,
    employee.jobFamily,
    ...employee.skills,
    ...employee.projectTags,
    ...employee.industryTags,
    ...employee.certifications,
    ...employee.preferredFunctions,
    ...employee.preferredCities,
    ...employee.trainingHistory,
    employee.resumeText,
    employee.managerComment
  ].filter(Boolean);
}

function jobEvidence(job: JobProfile): string[] {
  return [
    job.title,
    job.jobFamily,
    ...job.responsibilities,
    ...job.mustHaves,
    ...job.niceToHaves,
    ...job.keywords
  ].filter(Boolean);
}

function scoreEmployeeForJob(
  employee: EmployeeProfile,
  job: JobProfile,
  movementHistory: MovementRecord[]
): MatchResult {
  const evidence = employeeEvidence(employee);
  const skillTargets = uniqueStrings([...job.mustHaves, ...job.keywords]);
  const experienceTargets = uniqueStrings([...job.responsibilities, ...job.niceToHaves]);
  const matchedSkills = firstMatching(evidence, skillTargets);
  const matchedExperience = firstMatching(evidence, experienceTargets);
  const missingMustHaves = job.mustHaves.filter((item) => !evidence.some((evidenceItem) => fuzzyIncludes(evidenceItem, item)));
  const familyMatch =
    fuzzyIncludes(employee.jobFamily, job.jobFamily) ||
    employee.preferredFunctions.some((item) => fuzzyIncludes(item, job.jobFamily) || fuzzyIncludes(item, job.title));
  const cityMatch =
    !employee.preferredCities.length ||
    employee.preferredCities.some((city) => fuzzyIncludes(city, job.location));
  const precedent = findPrecedent(employee, job, movementHistory);
  const experienceBase =
    Math.round((matchedExperience.length / Math.max(experienceTargets.length, 1)) * 55) +
    (familyMatch ? 20 : 0) +
    Math.round(levelScore(employee.level, job.levelRange.min, job.levelRange.max) * 0.2) +
    (precedent ? 10 : 0);
  const skillScore = Math.min(
    100,
    Math.round((matchedSkills.length / Math.max(skillTargets.length, 1)) * 85) + (familyMatch ? 10 : 0)
  );
  let intentScore = baseIntentScore(employee.mobilityIntent);
  if (employee.preferredFunctions.some((item) => fuzzyIncludes(item, job.title) || fuzzyIncludes(item, job.jobFamily))) {
    intentScore += 10;
  }
  if (cityMatch) {
    intentScore += 6;
  } else {
    intentScore -= 18;
  }
  const experienceScore = Math.min(100, Math.max(48, experienceBase));
  const completenessPenalty = Math.round((100 - fileIntegrityScore(employee)) * 0.12);
  const gapPenalty = missingMustHaves.length * 3;
  const constraintPenalty = employee.constraints.some((item) => fuzzyIncludes(item, job.location) || fuzzyIncludes(item, "不考虑异地")) ? 10 : 0;
  const overallScore = Math.max(
    34,
    Math.min(
      98,
      Math.round(skillScore * 0.48 + experienceScore * 0.32 + Math.max(intentScore, 20) * 0.2) -
        completenessPenalty -
        gapPenalty -
        constraintPenalty
    )
  );

  const reasons = uniqueStrings(
    [
      matchedSkills.length
        ? `关键标签命中 ${matchedSkills.slice(0, 3).join("、")}`
        : "",
      matchedExperience.length
        ? `项目经历贴近 ${matchedExperience.slice(0, 2).join("、")}`
        : "",
      familyMatch ? `当前职能与目标岗位序列相邻，迁移成本较低` : "",
      precedent ? `历史样本中已有类似流动案例：${precedent.fromRole} -> ${precedent.toRole}` : ""
    ].filter(Boolean)
  ).slice(0, 4);

  const risks = uniqueStrings(
    [
      missingMustHaves.length ? `还缺少明确证据：${missingMustHaves.slice(0, 2).join("、")}` : "",
      cityMatch ? "" : `地点偏好与岗位地点不完全一致，需确认 ${job.location} 到岗意愿`,
      employee.mobilityIntent === "steady" ? "当前流动意愿偏稳，建议先确认窗口期" : "",
      fileIntegrityScore(employee) < 80 ? "人才画像信息不完整，建议补充经理评价或培训记录" : "",
      levelScore(employee.level, job.levelRange.min, job.levelRange.max) < 80 ? "级别略有偏差，需要额外确认岗位期望" : ""
    ].filter(Boolean)
  ).slice(0, 4);

  const gapItems = uniqueStrings(
    [
      ...missingMustHaves,
      !cityMatch ? `确认是否接受 ${job.location} 办公` : ""
    ].filter(Boolean)
  ).slice(0, 4);

  const nextAction =
    overallScore >= 84
      ? "建议进入优先沟通，先验证风险项与到岗时间。"
      : overallScore >= 72
        ? "建议由 HR 做一轮校准沟通，再决定是否推进业务面。"
        : "建议保留为备选，等待更多证据或后续岗位。";

  return {
    matchId: buildMatchId("job", job.jobId, employee.employeeId),
    sourceType: "job",
    sourceId: job.jobId,
    sourceLabel: job.title,
    targetId: employee.employeeId,
    targetLabel: employee.name,
    overallScore,
    skillScore,
    experienceScore,
    intentScore: Math.max(20, Math.min(100, intentScore)),
    reasons,
    risks,
    gapItems,
    nextAction
  };
}

function scoreJobsForEmployee(
  employee: EmployeeProfile,
  jobs: JobProfile[],
  movementHistory: MovementRecord[]
): MatchResult[] {
  return jobs
    .map((job) => {
      const result = scoreEmployeeForJob(employee, job, movementHistory);
      return {
        ...result,
        matchId: buildMatchId("employee", employee.employeeId, job.jobId),
        sourceType: "employee" as const,
        sourceId: employee.employeeId,
        sourceLabel: employee.name,
        targetId: job.jobId,
        targetLabel: job.title
      };
    })
    .sort((left, right) => right.overallScore - left.overallScore || right.skillScore - left.skillScore);
}

function buildOverview(
  employees: EmployeeProfile[],
  jobs: JobProfile[],
  movementHistory: MovementRecord[]
): MarketplaceOverview {
  const highConfidenceCount = jobs
    .map((job) => employees.map((employee) => scoreEmployeeForJob(employee, job, movementHistory).overallScore))
    .flat()
    .filter((score) => score >= 84).length;

  return {
    employeeCount: employees.length,
    jobCount: jobs.length,
    movementCount: movementHistory.length,
    activeMobilityCount: employees.filter((employee) => employee.mobilityIntent === "active").length,
    highConfidenceCount,
    readyJobCount: jobs.filter((job) => job.mustHaves.length >= 3 && job.responsibilities.length >= 3).length
  };
}

function employeeTemplates(): EmployeeSeedTemplate[] {
  return [
    {
      org: "组织与人才发展部",
      currentRole: "人才发展经理",
      jobFamily: "人才发展",
      skills: ["人才盘点", "胜任力建模", "梯队建设", "项目推动", "干部发展"],
      projectTags: ["干部盘点项目", "关键岗位继任", "内部流动试点"],
      industryTags: ["保险", "金融"],
      certifications: ["人才测评师"],
      preferredFunctions: ["人才发展", "组织发展"],
      preferredCities: ["北京", "上海"],
      resumeText: "负责集团人才盘点、干部发展和内部流动机制建设，能把业务需求转成发展项目。",
      managerComment: "项目推动稳定，能把复杂口径整理成业务方能理解的方案。",
      trainingHistory: ["继任计划设计", "内部教练认证"],
      constraints: [],
      performanceLevels: ["high", "high", "solid", "high"],
      potentialLevels: ["high", "high", "medium", "high"],
      mobilityIntents: ["open", "open", "steady", "active"],
      levels: ["P6", "P6", "P7", "P7"]
    },
    {
      org: "招聘与雇主品牌部",
      currentRole: "招聘经理",
      jobFamily: "招聘",
      skills: ["岗位画像", "面试官校准", "人才映射", "招聘流程优化", "跨团队协同"],
      projectTags: ["校招招聘项目", "内部流动试点", "招聘数据复盘"],
      industryTags: ["保险", "互联网"],
      certifications: ["面试官认证"],
      preferredFunctions: ["人才发展", "招聘管理", "组织发展"],
      preferredCities: ["北京", "杭州"],
      resumeText: "长期负责核心岗位招聘和招聘运营优化，也参与内部人才流动试点与岗位画像标准化。",
      managerComment: "业务理解强，善于与业务经理做需求澄清，适合承担跨部门项目。",
      trainingHistory: ["人才盘点工作坊", "胜任力面试训练"],
      constraints: [],
      performanceLevels: ["high", "solid", "solid", "high"],
      potentialLevels: ["high", "medium", "medium", "high"],
      mobilityIntents: ["active", "open", "steady", "active"],
      levels: ["P6", "P6", "P7", "P7"]
    },
    {
      org: "招聘与雇主品牌部",
      currentRole: "招聘运营经理",
      jobFamily: "招聘",
      skills: ["招聘数据分析", "流程设计", "项目管理", "渠道运营", "系统落地"],
      projectTags: ["招聘中台优化", "内部推荐机制", "需求流转治理"],
      industryTags: ["保险", "零售"],
      certifications: ["项目管理认证"],
      preferredFunctions: ["招聘运营", "人效分析", "人才发展"],
      preferredCities: ["上海", "北京"],
      resumeText: "负责招聘流程与系统优化，搭建数据看板，也参与内部推荐和流动规则设计。",
      managerComment: "数据敏感度高，适合在流程型岗位里承担 owner 角色。",
      trainingHistory: ["People Analytics 基础", "流程改进训练"],
      constraints: ["短期不考虑高频出差"],
      performanceLevels: ["solid", "high", "solid", "high"],
      potentialLevels: ["medium", "high", "medium", "high"],
      mobilityIntents: ["open", "active", "steady", "open"],
      levels: ["P5", "P6", "P6", "P7"]
    },
    {
      org: "学习发展中心",
      currentRole: "学习发展专家",
      jobFamily: "学习发展",
      skills: ["培养项目设计", "课程运营", "讲师管理", "学习路径设计", "效果评估"],
      projectTags: ["管培生项目", "领导力课程", "学习地图搭建"],
      industryTags: ["保险", "消费"],
      certifications: ["培训师认证"],
      preferredFunctions: ["学习发展", "人才发展"],
      preferredCities: ["北京", "广州"],
      resumeText: "负责培养项目和学习路径设计，擅长把抽象能力要求落成训练动作和评估方案。",
      managerComment: "方案表达清晰，适合与人才发展团队联动做培养机制。",
      trainingHistory: ["领导力项目设计", "培训效果评估"],
      constraints: [],
      performanceLevels: ["solid", "high", "solid", "high"],
      potentialLevels: ["medium", "high", "medium", "high"],
      mobilityIntents: ["open", "open", "steady", "active"],
      levels: ["P5", "P6", "P6", "P7"]
    },
    {
      org: "人才与组织发展部",
      currentRole: "组织发展经理",
      jobFamily: "组织发展",
      skills: ["组织诊断", "岗位体系设计", "任职资格", "变革推动", "人才盘点"],
      projectTags: ["组织诊断项目", "岗位体系升级", "干部任职资格"],
      industryTags: ["金融", "保险"],
      certifications: ["组织发展顾问认证"],
      preferredFunctions: ["组织发展", "人才发展", "HRBP"],
      preferredCities: ["北京", "深圳"],
      resumeText: "负责组织诊断、岗位体系和任职资格项目，也参与干部梯队和关键人才盘点。",
      managerComment: "抽象能力强，能把组织问题拆成结构化动作。",
      trainingHistory: ["组织设计实战", "任职资格体系"],
      constraints: [],
      performanceLevels: ["high", "solid", "high", "high"],
      potentialLevels: ["high", "medium", "high", "high"],
      mobilityIntents: ["open", "open", "steady", "active"],
      levels: ["P6", "P7", "P7", "M1"]
    },
    {
      org: "人力资源业务伙伴部",
      currentRole: "HRBP",
      jobFamily: "HRBP",
      skills: ["业务诊断", "人才盘点", "组织协同", "管理者辅导", "招聘协同"],
      projectTags: ["业务团队组织诊断", "关键岗位梯队", "干部辅导项目"],
      industryTags: ["保险", "医疗"],
      certifications: ["DISC 教练认证"],
      preferredFunctions: ["HRBP", "组织发展", "人才发展"],
      preferredCities: ["深圳", "北京"],
      resumeText: "深度支持业务团队，关注组织诊断、干部辅导和关键岗位人才盘点。",
      managerComment: "业务接口能力很强，适合承担复杂协同项目。",
      trainingHistory: ["业务伙伴训练营", "组织诊断方法"],
      constraints: ["希望优先保留在华南"],
      performanceLevels: ["high", "solid", "solid", "high"],
      potentialLevels: ["high", "medium", "medium", "high"],
      mobilityIntents: ["open", "steady", "open", "active"],
      levels: ["P6", "P6", "P7", "M1"]
    },
    {
      org: "人力数据与效能部",
      currentRole: "人效分析经理",
      jobFamily: "人效分析",
      skills: ["人力数据分析", "指标体系", "报表搭建", "人才供需分析", "流程优化"],
      projectTags: ["招聘漏斗分析", "编制治理项目", "人员结构分析"],
      industryTags: ["保险", "互联网"],
      certifications: ["数据分析认证"],
      preferredFunctions: ["人效分析", "招聘运营", "人才发展"],
      preferredCities: ["上海", "北京"],
      resumeText: "负责人才供需、编制和招聘效率分析，能把复杂问题转成可落地指标与看板。",
      managerComment: "逻辑清晰，适合支撑中台型场景和机制设计。",
      trainingHistory: ["SQL for HR", "分析故事化表达"],
      constraints: [],
      performanceLevels: ["solid", "high", "solid", "high"],
      potentialLevels: ["medium", "high", "medium", "high"],
      mobilityIntents: ["open", "active", "steady", "open"],
      levels: ["P5", "P6", "P6", "P7"]
    },
    {
      org: "业务运营中心",
      currentRole: "产品运营经理",
      jobFamily: "运营",
      skills: ["项目运营", "流程优化", "数据复盘", "跨团队推进", "内部平台需求"],
      projectTags: ["工作台优化", "业务流程梳理", "内部平台上线"],
      industryTags: ["保险", "互联网"],
      certifications: ["敏捷认证"],
      preferredFunctions: ["运营", "产品", "招聘运营"],
      preferredCities: ["广州", "北京"],
      resumeText: "负责内部平台与业务流程运营，擅长推动复杂流程落地和跨团队协同。",
      managerComment: "执行力强，但人才类项目经验相对少，需要场景补齐。",
      trainingHistory: ["流程治理训练营"],
      constraints: ["家庭原因短期不考虑异地"],
      performanceLevels: ["solid", "solid", "developing", "solid"],
      potentialLevels: ["medium", "medium", "emerging", "medium"],
      mobilityIntents: ["open", "steady", "steady", "active"],
      levels: ["P5", "P5", "P6", "P6"]
    }
  ];
}

function generateEmployees(): EmployeeProfile[] {
  const names = [
    "林岚", "周岚", "唐薇", "陈曦", "许晨", "沈宁", "孟遥", "韩青",
    "顾念", "梁恬", "袁可", "谢安", "苏冉", "高宁", "方颂", "叶青",
    "宋知", "许棠", "余玥", "白晨", "陆澄", "蒋一", "周璟", "郑熙",
    "周宁", "韩珂", "戴然", "赵禾", "周弈", "丁澈", "袁朵", "顾川"
  ];
  const templates = employeeTemplates();
  const employees: EmployeeProfile[] = [];
  let nameIndex = 0;

  for (const template of templates) {
    for (let variantIndex = 0; variantIndex < 4; variantIndex += 1) {
      const name = names[nameIndex] ?? `员工${nameIndex + 1}`;
      const now = nowIso();
      const currentRole =
        variantIndex === 3 && !/经理|专家/.test(template.currentRole)
          ? `高级${template.currentRole}`
          : template.currentRole;
      const trainingHistory =
        name === "袁朵" ? [] : template.trainingHistory.map((item, index) => (index === 0 ? item : `${item}${variantIndex + 1}`));
      const managerComment = name === "袁朵" ? "" : template.managerComment;
      const resumeText =
        name === "袁朵"
          ? "负责过内部平台流程优化，参与招聘运营支持。"
          : `${template.resumeText} 过去一年重点推动 ${template.projectTags[Math.min(variantIndex, template.projectTags.length - 1)]}。`;

      employees.push({
        employeeId: createId("employee"),
        name,
        org: template.org,
        currentRole,
        jobFamily: template.jobFamily,
        level: template.levels[variantIndex] ?? "P6",
        skills: template.skills,
        projectTags: uniqueStrings([...template.projectTags, variantIndex % 2 === 0 ? "跨团队项目推进" : "机制设计"]),
        industryTags: template.industryTags,
        certifications: template.certifications,
        performanceLevel: template.performanceLevels[variantIndex] ?? "solid",
        potentialLevel: template.potentialLevels[variantIndex] ?? "medium",
        mobilityIntent: template.mobilityIntents[variantIndex] ?? "open",
        preferredCities: uniqueStrings([...template.preferredCities, CITY_LIST[(nameIndex + variantIndex) % CITY_LIST.length]]),
        preferredFunctions: template.preferredFunctions,
        constraints: template.constraints,
        resumeText,
        managerComment,
        trainingHistory,
        createdAt: now,
        updatedAt: now
      });
      nameIndex += 1;
    }
  }

  return employees.slice(0, 32);
}

function generateJobs(): JobProfile[] {
  const now = nowIso();
  const seedJobs: Array<Omit<JobProfile, "jobId" | "createdAt" | "updatedAt">> = [
    {
      title: "人才发展岗",
      dept: "人才与组织发展部",
      jobFamily: "人才发展",
      levelRange: { min: "P6", max: "P7" },
      location: "北京",
      responsibilities: ["组织人才盘点与关键岗位梯队建设", "推动干部发展项目落地", "搭建内部流动与任职资格机制"],
      mustHaves: ["有人才盘点或胜任力建模经验", "能跨部门推进人才项目落地", "能把业务需求转成培养方案"],
      niceToHaves: ["有招聘或内部流动项目背景", "熟悉测评工具或干部评估"],
      keywords: ["人才盘点", "胜任力模型", "内部流动", "干部发展"],
      riskFlags: ["只做过单点培训运营", "缺少复杂项目推进案例"],
      headcount: 1,
      priority: "critical"
    },
    {
      title: "内部招聘运营经理",
      dept: "招聘与雇主品牌部",
      jobFamily: "招聘",
      levelRange: { min: "P6", max: "P7" },
      location: "上海",
      responsibilities: ["搭建内部岗位流转机制", "优化招聘流程与系统规则", "沉淀岗位画像与需求澄清标准"],
      mustHaves: ["熟悉招聘流程设计", "有项目管理与跨团队推进经验", "能用数据诊断流程问题"],
      niceToHaves: ["做过内部流动或推荐机制", "了解人才盘点口径"],
      keywords: ["招聘流程", "岗位画像", "系统优化", "数据诊断"],
      riskFlags: ["只有执行经验没有机制设计", "对业务需求理解浅"],
      headcount: 1,
      priority: "critical"
    },
    {
      title: "组织发展经理",
      dept: "人才与组织发展部",
      jobFamily: "组织发展",
      levelRange: { min: "P7", max: "M1" },
      location: "北京",
      responsibilities: ["开展组织诊断与岗位体系设计", "推动任职资格体系升级", "联动 HRBP 做干部发展策略"],
      mustHaves: ["有组织诊断或岗位体系项目经验", "能独立推进复杂变革项目", "有管理者沟通能力"],
      niceToHaves: ["做过人才盘点", "了解业务组织设计"],
      keywords: ["组织诊断", "岗位体系", "任职资格", "变革推动"],
      riskFlags: ["缺少复杂组织场景", "只做过标准化项目执行"],
      headcount: 1,
      priority: "planned"
    },
    {
      title: "HRBP 负责人",
      dept: "人力资源业务伙伴部",
      jobFamily: "HRBP",
      levelRange: { min: "P7", max: "M1" },
      location: "深圳",
      responsibilities: ["支持业务团队组织与人才议题", "推动干部盘点与关键人才保留", "联动招聘和培养资源"],
      mustHaves: ["有业务伙伴或组织支持经验", "能做干部和组织诊断", "能推动多方协同"],
      niceToHaves: ["了解保险业务", "做过人才发展项目"],
      keywords: ["业务伙伴", "干部盘点", "组织诊断", "人才保留"],
      riskFlags: ["不适应高频业务协同", "只偏后台项目"],
      headcount: 1,
      priority: "critical"
    },
    {
      title: "学习发展专家",
      dept: "学习发展中心",
      jobFamily: "学习发展",
      levelRange: { min: "P5", max: "P6" },
      location: "广州",
      responsibilities: ["设计关键人才培养项目", "搭建学习路径与课程地图", "评估培训效果并持续优化"],
      mustHaves: ["有培养项目设计经验", "能把能力要求拆成学习动作", "有运营落地能力"],
      niceToHaves: ["做过领导力项目", "熟悉学习数据分析"],
      keywords: ["学习路径", "培养项目", "培训评估", "课程运营"],
      riskFlags: ["只有课程执行经验", "不擅长方案设计"],
      headcount: 2,
      priority: "planned"
    },
    {
      title: "招聘经理",
      dept: "招聘与雇主品牌部",
      jobFamily: "招聘",
      levelRange: { min: "P6", max: "P7" },
      location: "北京",
      responsibilities: ["负责核心岗位招聘交付", "推动面试官校准与画像统一", "参与内部人才流动方案试点"],
      mustHaves: ["有核心岗位招聘经验", "能做需求澄清与岗位画像", "有跨团队协同推进经验"],
      niceToHaves: ["做过内部流动试点", "具备招聘数据分析意识"],
      keywords: ["核心岗位招聘", "岗位画像", "面试官校准", "人才流动"],
      riskFlags: ["只有渠道执行", "缺少业务对话能力"],
      headcount: 1,
      priority: "critical"
    },
    {
      title: "招聘数据分析经理",
      dept: "招聘与雇主品牌部",
      jobFamily: "人效分析",
      levelRange: { min: "P5", max: "P6" },
      location: "上海",
      responsibilities: ["搭建招聘漏斗与供需分析看板", "支持人才流动效果评估", "推动关键指标治理"],
      mustHaves: ["有人力或招聘数据分析经验", "能用数据解释业务问题", "有流程改进意识"],
      niceToHaves: ["熟悉 SQL 或 BI", "理解岗位画像与招聘流程"],
      keywords: ["人力数据", "供需分析", "漏斗看板", "指标治理"],
      riskFlags: ["只有报表输出没有诊断能力", "不理解业务场景"],
      headcount: 1,
      priority: "planned"
    },
    {
      title: "产品运营经理",
      dept: "业务运营中心",
      jobFamily: "运营",
      levelRange: { min: "P5", max: "P6" },
      location: "广州",
      responsibilities: ["负责内部平台运营与机制落地", "推动业务流程优化", "做跨团队项目复盘"],
      mustHaves: ["有内部平台或流程运营经验", "擅长项目推进", "能基于数据做复盘"],
      niceToHaves: ["做过人力系统项目", "懂需求收集与优先级"],
      keywords: ["内部平台", "流程运营", "项目复盘", "跨团队推进"],
      riskFlags: ["只做外部活动运营", "缺少复杂协同经验"],
      headcount: 1,
      priority: "pipeline"
    },
    {
      title: "B 端产品经理",
      dept: "内部产品平台部",
      jobFamily: "产品",
      levelRange: { min: "P6", max: "P7" },
      location: "杭州",
      responsibilities: ["负责内部人才平台需求设计", "抽象 HR 业务流程并产品化", "推动跨团队交付上线"],
      mustHaves: ["做过 B 端流程产品", "能做需求拆解和跨团队推动", "理解 HR 或组织管理场景"],
      niceToHaves: ["做过人才或招聘系统", "有数据分析意识"],
      keywords: ["B 端产品", "流程产品化", "人才平台", "需求拆解"],
      riskFlags: ["只有 C 端经验", "不熟悉复杂流程"],
      headcount: 1,
      priority: "critical"
    },
    {
      title: "人才盘点项目经理",
      dept: "人才与组织发展部",
      jobFamily: "人才发展",
      levelRange: { min: "P6", max: "P7" },
      location: "北京",
      responsibilities: ["推动年度人才盘点项目", "沉淀关键岗位画像与评估口径", "联动业务与 HRBP 形成行动计划"],
      mustHaves: ["有人才盘点或干部评估经验", "能做跨部门项目管理", "沟通表达清晰"],
      niceToHaves: ["熟悉测评工具", "有组织诊断经验"],
      keywords: ["人才盘点", "评估口径", "关键岗位画像", "项目管理"],
      riskFlags: ["缺少管理者对话能力", "只有执行没有项目 owner 经验"],
      headcount: 1,
      priority: "critical"
    },
    {
      title: "继任发展专家",
      dept: "人才与组织发展部",
      jobFamily: "人才发展",
      levelRange: { min: "P5", max: "P6" },
      location: "深圳",
      responsibilities: ["设计继任计划与关键岗位人才池", "跟踪培养动作与成长路径", "沉淀干部发展案例"],
      mustHaves: ["做过人才发展或培养项目", "理解关键岗位与梯队建设", "能做项目跟踪与复盘"],
      niceToHaves: ["有 HRBP 经验", "了解业务组织发展"],
      keywords: ["继任计划", "关键岗位", "人才池", "培养路径"],
      riskFlags: ["缺少人才项目经验", "只做培训执行"],
      headcount: 1,
      priority: "planned"
    },
    {
      title: "人效分析经理",
      dept: "人力数据与效能部",
      jobFamily: "人效分析",
      levelRange: { min: "P6", max: "P7" },
      location: "北京",
      responsibilities: ["建立人力供需预测与结构分析模型", "评估内部流动机制效果", "支持业务做人才决策"],
      mustHaves: ["有人效或人力数据分析经验", "能与业务沟通并解释结果", "具备指标体系设计能力"],
      niceToHaves: ["了解招聘与人才发展场景", "会做中台机制分析"],
      keywords: ["供需预测", "结构分析", "人力决策", "指标体系"],
      riskFlags: ["只会出数不会解释", "缺少业务协同"],
      headcount: 1,
      priority: "critical"
    }
  ];

  return seedJobs.map((job) => ({
    ...job,
    jobId: createId("job"),
    createdAt: now,
    updatedAt: now
  }));
}

function generateMovementHistory(): MovementRecord[] {
  const now = nowIso();
  const seedRecords: Array<Omit<MovementRecord, "movementId" | "createdAt">> = [
    {
      employeeName: "陈婧",
      fromRole: "招聘经理",
      toRole: "人才发展岗",
      fromFamily: "招聘",
      toFamily: "人才发展",
      note: "从岗位画像和面试官校准切入，成功转到内部人才发展项目。",
      outcome: "转岗后 6 个月成为核心项目 owner"
    },
    {
      employeeName: "顾晨",
      fromRole: "HRBP",
      toRole: "组织发展经理",
      fromFamily: "HRBP",
      toFamily: "组织发展",
      note: "借助组织诊断和干部辅导经验完成横向流动。",
      outcome: "承担组织诊断年度项目"
    },
    {
      employeeName: "林舟",
      fromRole: "学习发展专家",
      toRole: "继任发展专家",
      fromFamily: "学习发展",
      toFamily: "人才发展",
      note: "从培养项目设计延展到继任与人才池运营。",
      outcome: "沉淀关键岗位培养机制"
    },
    {
      employeeName: "周远",
      fromRole: "招聘运营经理",
      toRole: "招聘数据分析经理",
      fromFamily: "招聘",
      toFamily: "人效分析",
      note: "基于招聘看板和流程优化项目完成迁移。",
      outcome: "建立供需分析看板"
    },
    {
      employeeName: "唐悦",
      fromRole: "产品运营经理",
      toRole: "B 端产品经理",
      fromFamily: "运营",
      toFamily: "产品",
      note: "由内部平台流程运营转到流程产品化岗位。",
      outcome: "主导内部平台迭代"
    },
    {
      employeeName: "程宁",
      fromRole: "人才发展经理",
      toRole: "HRBP 负责人",
      fromFamily: "人才发展",
      toFamily: "HRBP",
      note: "利用干部发展和业务协同经验转向业务伙伴角色。",
      outcome: "成为区域组织与人才接口人"
    }
  ];

  return seedRecords.map((record) => ({
    ...record,
    movementId: createId("movement"),
    createdAt: now
  }));
}

async function ensureSeedData(): Promise<void> {
  await ensureMarketplaceDir();
  const [employees, jobs, movementHistory, reviews] = await Promise.all([
    readJsonFile<EmployeeProfile[]>(marketplacePath(EMPLOYEES_FILE)),
    readJsonFile<JobProfile[]>(marketplacePath(JOBS_FILE)),
    readJsonFile<MovementRecord[]>(marketplacePath(MOVEMENT_HISTORY_FILE)),
    readJsonFile<ReviewDecision[]>(marketplacePath(REVIEWS_FILE))
  ]);

  if (!employees) {
    await writeJsonFile(marketplacePath(EMPLOYEES_FILE), generateEmployees());
  }
  if (!jobs) {
    await writeJsonFile(marketplacePath(JOBS_FILE), generateJobs());
  }
  if (!movementHistory) {
    await writeJsonFile(marketplacePath(MOVEMENT_HISTORY_FILE), generateMovementHistory());
  }
  if (!reviews) {
    await writeJsonFile(marketplacePath(REVIEWS_FILE), []);
  }
}

async function loadEmployees(): Promise<EmployeeProfile[]> {
  return (await readJsonFile<EmployeeProfile[]>(marketplacePath(EMPLOYEES_FILE))) ?? [];
}

async function loadJobs(): Promise<JobProfile[]> {
  return (await readJsonFile<JobProfile[]>(marketplacePath(JOBS_FILE))) ?? [];
}

async function loadMovementHistory(): Promise<MovementRecord[]> {
  return (await readJsonFile<MovementRecord[]>(marketplacePath(MOVEMENT_HISTORY_FILE))) ?? [];
}

async function loadReviews(): Promise<ReviewDecision[]> {
  return (await readJsonFile<ReviewDecision[]>(marketplacePath(REVIEWS_FILE))) ?? [];
}

async function saveEmployees(employees: EmployeeProfile[]): Promise<void> {
  await writeJsonFile(marketplacePath(EMPLOYEES_FILE), employees);
}

async function saveJobs(jobs: JobProfile[]): Promise<void> {
  await writeJsonFile(marketplacePath(JOBS_FILE), jobs);
}

async function saveReviews(reviews: ReviewDecision[]): Promise<void> {
  await writeJsonFile(marketplacePath(REVIEWS_FILE), reviews);
}

function preferredDefaultJob(jobs: JobProfile[]): JobProfile | null {
  return jobs.find((job) => job.title === "人才发展岗") ?? jobs[0] ?? null;
}

function preferredDefaultEmployee(employees: EmployeeProfile[]): EmployeeProfile | null {
  return (
    employees.find((employee) => employee.currentRole === "招聘经理" && employee.mobilityIntent === "active") ??
    employees.find((employee) => employee.mobilityIntent === "active") ??
    employees[0] ??
    null
  );
}

async function buildWorkspaceState(
  selection: OpenMarketplaceWorkspaceInput = {},
  limit = 5
): Promise<MarketplaceWorkspaceState> {
  const [employees, jobs, movementHistory, reviewDecisions] = await Promise.all([
    loadEmployees(),
    loadJobs(),
    loadMovementHistory(),
    loadReviews()
  ]);

  const selectedJob =
    jobs.find((job) => job.jobId === selection.jobId) ??
    preferredDefaultJob(jobs);
  const selectedEmployee =
    employees.find((employee) => employee.employeeId === selection.employeeId) ??
    preferredDefaultEmployee(employees);

  const jobMatches = selectedJob
    ? employees
        .map((employee) => scoreEmployeeForJob(employee, selectedJob, movementHistory))
        .sort((left, right) => right.overallScore - left.overallScore || right.skillScore - left.skillScore)
        .slice(0, limit)
    : [];
  const employeeMatches = selectedEmployee ? scoreJobsForEmployee(selectedEmployee, jobs, movementHistory).slice(0, limit) : [];

  return {
    overview: buildOverview(employees, jobs, movementHistory),
    strategyHighlights: [
      "先把岗位和人才都标准化成统一画像，再进入匹配和排序环节。",
      "匹配结果输出原因、风险和差距项，支持 HR 与业务做协同判断。",
      "先以中台能力验证推荐价值，再逐步接入 HRIS、培训、绩效与审批流程。"
    ],
    employees,
    jobs,
    movementHistory,
    reviewDecisions: [...reviewDecisions].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    selectedJobId: selectedJob?.jobId ?? null,
    selectedEmployeeId: selectedEmployee?.employeeId ?? null,
    selectedJob: selectedJob ?? null,
    selectedEmployee: selectedEmployee ?? null,
    jobMatches,
    employeeMatches
  };
}

function normalizeJobInput(input: NormalizeJobProfileInput): Omit<JobProfile, "jobId" | "createdAt" | "updatedAt"> {
  const rawText = cleanText(input.rawText);
  const lines = extractLines(rawText);
  const mergedText = [input.title, input.dept, input.location, rawText].filter(Boolean).join("\n");
  const inferredFamily = inferJobFamily(mergedText);
  const inferredLevelRange = inferLevelRange(mergedText);
  const responsibilityLines = lines.filter((line) => /(负责|推动|搭建|设计|组织|联动|沉淀)/.test(line));
  const mustLines = lines.filter((line) => /(经验|能力|案例|熟悉|擅长|能够|能)/.test(line));
  const niceLines = lines.filter((line) => /(优先|加分|最好|更佳)/.test(line));

  const responsibilities = cleanList(
    responsibilityLines.length ? responsibilityLines.slice(0, 4) : lines.slice(0, 3)
  );
  const mustHaves = cleanList(
    mustLines.length ? mustLines.slice(0, 4) : lines.slice(0, 3).map((line) => `具备相关经验：${line}`)
  );
  const niceToHaves = cleanList(
    niceLines.length ? niceLines.slice(0, 3) : buildKeywords(lines.slice(2, 5)).map((item) => `有以下背景更好：${item}`)
  ).slice(0, 3);

  return {
    title: cleanText(input.title) || "新建内部岗位",
    dept: cleanText(input.dept) || inferDept(inferredFamily),
    jobFamily: inferredFamily,
    levelRange: {
      min: cleanText(input.levelMin) || inferredLevelRange.min,
      max: cleanText(input.levelMax) || inferredLevelRange.max
    },
    location: cleanText(input.location) || inferLocation(mergedText),
    responsibilities,
    mustHaves,
    niceToHaves,
    keywords: buildKeywords([cleanText(input.title), ...responsibilities, ...mustHaves]),
    riskFlags: cleanList([
      lines.find((line) => /(不适合|风险|避免)/.test(line)) ?? "",
      responsibilities.length < 3 ? "职责信息偏少，建议继续澄清业务场景" : "",
      mustHaves.length < 3 ? "必须项证据不够明确，后续可能影响排序稳定性" : ""
    ]),
    headcount: 1,
    priority: "critical"
  };
}

function normalizeEmployeeInput(
  input: NormalizeEmployeeProfileInput
): Omit<EmployeeProfile, "employeeId" | "createdAt" | "updatedAt"> {
  const rawText = cleanText(input.rawText);
  const lines = extractLines(rawText);
  const mergedText = [input.currentRole, input.org, rawText].filter(Boolean).join("\n");
  const inferredFamily = inferJobFamily(mergedText);
  const mobilityIntent: MobilityIntent = /(转岗|希望流动|主动寻找)/.test(rawText)
    ? "active"
    : /(开放|可考虑|愿意)/.test(rawText)
      ? "open"
      : "steady";
  const skills = cleanList(
    lines.filter((line) => /(擅长|负责|经验|能力|熟悉|做过)/.test(line)).slice(0, 5)
  );
  const preferredFunctions = cleanList(
    lines.filter((line) => /(希望|想转|偏好|感兴趣)/.test(line)).slice(0, 3)
  );

  return {
    name: cleanText(input.name) || "新建员工画像",
    org: cleanText(input.org) || inferDept(inferredFamily),
    currentRole: cleanText(input.currentRole) || `${inferredFamily}角色`,
    jobFamily: inferredFamily,
    level: /(p7|经理|负责人)/i.test(mergedText) ? "P7" : "P6",
    skills: skills.length ? skills : buildKeywords(lines).slice(0, 5),
    projectTags: buildKeywords(lines.slice(0, 4)),
    industryTags: ["保险"],
    certifications: [],
    performanceLevel: "solid",
    potentialLevel: "medium",
    mobilityIntent,
    preferredCities: [inferLocation(mergedText)],
    preferredFunctions: preferredFunctions.length ? preferredFunctions : [inferredFamily],
    constraints: /(不考虑异地)/.test(rawText) ? ["不考虑异地"] : [],
    resumeText: clampText(rawText || "暂无原始简历描述。", 320),
    managerComment: mobilityIntent === "active" ? "具备明确转岗意愿，建议优先核验能力证据。" : "",
    trainingHistory: /(培训|项目|课程)/.test(rawText) ? buildKeywords(lines.slice(0, 3)) : []
  };
}

export async function ensureMarketplaceDirectories(): Promise<void> {
  await ensureSeedData();
}

export async function openMarketplaceWorkspace(
  input: OpenMarketplaceWorkspaceInput = {}
): Promise<MarketplaceWorkspaceState> {
  await ensureSeedData();
  return buildWorkspaceState(input);
}

export async function normalizeJobProfile(
  input: NormalizeJobProfileInput
): Promise<{ workspace: MarketplaceWorkspaceState }> {
  await ensureSeedData();
  if (!cleanText(input.title) && !cleanText(input.rawText)) {
    throw new Error("请至少提供岗位标题或原始岗位描述。");
  }

  const jobs = await loadJobs();
  const now = nowIso();
  const normalized = normalizeJobInput(input);
  const job: JobProfile = {
    ...normalized,
    jobId: createId("job"),
    createdAt: now,
    updatedAt: now
  };
  await saveJobs([job, ...jobs]);

  return {
    workspace: await buildWorkspaceState({ jobId: job.jobId })
  };
}

export async function normalizeEmployeeProfile(
  input: NormalizeEmployeeProfileInput
): Promise<{ workspace: MarketplaceWorkspaceState }> {
  await ensureSeedData();
  if (!cleanText(input.name) && !cleanText(input.currentRole) && !cleanText(input.rawText)) {
    throw new Error("请至少提供员工姓名、当前岗位或原始人才描述。");
  }

  const employees = await loadEmployees();
  const now = nowIso();
  const normalized = normalizeEmployeeInput(input);
  const employee: EmployeeProfile = {
    ...normalized,
    employeeId: createId("employee"),
    createdAt: now,
    updatedAt: now
  };
  await saveEmployees([employee, ...employees]);

  return {
    workspace: await buildWorkspaceState({ employeeId: employee.employeeId })
  };
}

export async function matchByJob(input: MatchByJobInput): Promise<{ workspace: MarketplaceWorkspaceState }> {
  await ensureSeedData();
  const jobs = await loadJobs();
  const job = jobs.find((item) => item.jobId === input.jobId);
  if (!job) {
    throw new Error(`Job not found: ${input.jobId}`);
  }
  return {
    workspace: await buildWorkspaceState({ jobId: job.jobId }, input.limit ?? 5)
  };
}

export async function matchByEmployee(input: MatchByEmployeeInput): Promise<{ workspace: MarketplaceWorkspaceState }> {
  await ensureSeedData();
  const employees = await loadEmployees();
  const employee = employees.find((item) => item.employeeId === input.employeeId);
  if (!employee) {
    throw new Error(`Employee not found: ${input.employeeId}`);
  }
  return {
    workspace: await buildWorkspaceState({ employeeId: employee.employeeId }, input.limit ?? 5)
  };
}

export async function reviewMatch(input: ReviewMatchInput): Promise<{ workspace: MarketplaceWorkspaceState }> {
  await ensureSeedData();
  const { sourceType, sourceId, targetId } = parseMatchId(input.matchId);
  const reviews = await loadReviews();
  const decision: ReviewDecision = {
    matchId: input.matchId,
    reviewer: input.reviewer.trim(),
    decision: input.decision as ReviewDecisionType,
    comment: cleanText(input.comment),
    createdAt: nowIso()
  };
  await saveReviews([decision, ...reviews]);

  return {
    workspace: await buildWorkspaceState(
      sourceType === "job"
        ? { jobId: sourceId, employeeId: targetId }
        : { employeeId: sourceId, jobId: targetId }
    )
  };
}
