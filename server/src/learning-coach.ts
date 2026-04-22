import type {
  GoalClarity,
  LearningPrompt,
  TeachingFeedback
} from "../../shared/contracts.js";
import { createId, clampText, uniqueStrings } from "./utils.js";

function detectDomain(topicTitle: string, goalDetail: string): "recruiting-ops" | "data-analysis" | "general" {
  const combined = `${topicTitle} ${goalDetail}`.toLowerCase();
  if (/(招聘|recruit|候选人|offer|入职|渠道|面试|招聘运营)/i.test(combined)) {
    return "recruiting-ops";
  }
  if (/(分析|sql|excel|python|bi|指标|数据)/i.test(combined)) {
    return "data-analysis";
  }
  return "general";
}

export function analyzeGoalClarity(topicTitle: string, goalDetail: string): GoalClarity {
  const detail = goalDetail.trim();
  const missingPoints: string[] = [];
  const knownPoints: string[] = [];
  let score = 35;

  if (detail.length >= 18) {
    score += 15;
    knownPoints.push("你已经给了一个相对完整的学习描述。");
  } else {
    missingPoints.push("你想解决的具体问题还不够明确。");
  }

  if (/(指标|工具|方法|流程|案例|复盘|漏斗|分析)/.test(detail)) {
    score += 15;
    knownPoints.push("你已经指出了想学的内容类型。");
  } else {
    missingPoints.push("你还没说清想优先学指标、工具、方法还是实战。");
  }

  if (/(现在|目前|卡|薄弱|不会|难点|问题)/.test(detail)) {
    score += 15;
    knownPoints.push("你已经透露了当前卡点。");
  } else {
    missingPoints.push("你还没说明你现在最容易卡住的地方。");
  }

  if (/(工作|实战|项目|汇报|复盘|应用|场景)/.test(detail)) {
    score += 10;
    knownPoints.push("你提到了应用场景。");
  } else {
    missingPoints.push("你还没说明学完后要把它用在什么场景里。");
  }

  score = Math.min(95, score);

  return {
    score,
    summary:
      score >= 70
        ? `你的学习目标已经比较清楚，接下来可以直接进入追问式学习。`
        : `你的目标还不够聚焦，我建议先补清“优先学什么、现在卡在哪、学完要用来做什么”。`,
    knownPoints,
    missingPoints,
    clarificationQuestions: uniqueStrings([
      `你现在最想先补的是 ${topicTitle} 里的哪一块：概念、指标、工具、方法，还是案例？`,
      `如果明天就要把 ${topicTitle} 用到工作里，你最怕被问住的问题是什么？`,
      `你更想达到什么结果：能解释清楚、能自己分析、还是能做汇报？`
    ])
  };
}

function promptTemplatePool(domain: "recruiting-ops" | "data-analysis" | "general", topicTitle: string) {
  if (domain === "recruiting-ops") {
    return [
      {
        intent: "definition",
        difficulty: "warmup" as const,
        question: `${topicTitle} 的核心目标是什么？它和单纯的招聘执行有什么区别？`,
        expectedFocus: ["目标", "职责边界", "价值"]
      },
      {
        intent: "metrics",
        difficulty: "core" as const,
        question: `${topicTitle} 的核心指标有哪些？你会先看哪几个指标判断工作是否有效？`,
        expectedFocus: ["漏斗指标", "效率指标", "质量指标"]
      },
      {
        intent: "tools",
        difficulty: "core" as const,
        question: `${topicTitle} 常用的数据分析工具有哪些？各自适合解决什么问题？`,
        expectedFocus: ["Excel", "SQL", "BI", "ATS"]
      },
      {
        intent: "methods",
        difficulty: "core" as const,
        question: `${topicTitle} 里常见的数据分析方法有哪些？比如你会怎样拆解招聘漏斗或做渠道复盘？`,
        expectedFocus: ["漏斗分析", "分层对比", "趋势分析", "归因"]
      },
      {
        intent: "scenario",
        difficulty: "challenge" as const,
        question: `如果某个招聘渠道简历很多但入职很少，你会怎样定位问题？`,
        expectedFocus: ["分段定位", "转化率", "渠道质量", "假设验证"]
      },
      {
        intent: "mistakes",
        difficulty: "challenge" as const,
        question: `${topicTitle} 最容易出现哪些分析误区？`,
        expectedFocus: ["口径混乱", "样本偏差", "只看总量不看分层"]
      }
    ];
  }

  if (domain === "data-analysis") {
    return [
      {
        intent: "definition",
        difficulty: "warmup" as const,
        question: `${topicTitle} 最核心的分析目标是什么？`,
        expectedFocus: ["目标", "问题定义", "业务价值"]
      },
      {
        intent: "metrics",
        difficulty: "core" as const,
        question: `做 ${topicTitle} 时，你会先定义哪些指标和口径？`,
        expectedFocus: ["指标", "分子分母", "口径"]
      },
      {
        intent: "tools",
        difficulty: "core" as const,
        question: `${topicTitle} 常用哪些工具？Excel、SQL、Python、BI 各自什么时候用？`,
        expectedFocus: ["工具选择", "适用场景"]
      },
      {
        intent: "methods",
        difficulty: "core" as const,
        question: `${topicTitle} 里常用的分析方法有哪些？`,
        expectedFocus: ["趋势", "分层", "漏斗", "对比"]
      },
      {
        intent: "scenario",
        difficulty: "challenge" as const,
        question: `如果你发现一个指标突然恶化，你会怎样验证是真问题还是口径问题？`,
        expectedFocus: ["验证", "排查", "反证"]
      }
    ];
  }

  return [
    {
      intent: "definition",
      difficulty: "warmup" as const,
      question: `如果要向别人介绍 ${topicTitle}，你会怎么解释它的核心概念？`,
      expectedFocus: ["定义", "核心概念"]
    },
    {
      intent: "structure",
      difficulty: "core" as const,
      question: `${topicTitle} 由哪些关键模块或步骤组成？`,
      expectedFocus: ["结构", "步骤", "模块"]
    },
    {
      intent: "mistakes",
      difficulty: "challenge" as const,
      question: `学习 ${topicTitle} 时最常见的误区有哪些？`,
      expectedFocus: ["误区", "纠偏"]
    }
  ];
}

function intentPriority(goalDetail: string): LearningPrompt["intent"][] {
  const detail = goalDetail.toLowerCase();
  const priorities: LearningPrompt["intent"][] = [];

  if (/(指标|口径|转化|效率|质量)/i.test(detail)) {
    priorities.push("metrics");
  }
  if (/(工具|excel|sql|bi|ats|python)/i.test(detail)) {
    priorities.push("tools");
  }
  if (/(方法|漏斗|复盘|分析|排查|归因)/i.test(detail)) {
    priorities.push("methods", "scenario");
  }
  if (/(误区|问题|踩坑)/i.test(detail)) {
    priorities.push("mistakes");
  }
  if (/(概念|定义|区别|基础|入门)/i.test(detail)) {
    priorities.push("definition");
  }

  priorities.push("definition", "metrics", "tools", "methods", "scenario", "mistakes", "structure");
  return uniqueStrings(priorities);
}

export function createPromptQueue(topicTitle: string, goalDetail: string): LearningPrompt[] {
  const domain = detectDomain(topicTitle, goalDetail);
  const priority = intentPriority(goalDetail);
  return promptTemplatePool(domain, topicTitle)
    .sort((left, right) => priority.indexOf(left.intent) - priority.indexOf(right.intent))
    .map((item) => ({
      id: createId("prompt"),
      ...item
    }));
}

function expectedAnswerSkeleton(prompt: LearningPrompt): string[] {
  switch (prompt.intent) {
    case "definition":
      return ["先说清定义", "再说清它解决什么问题", "最后说明和相近概念的区别"];
    case "metrics":
      return ["按数量、效率、质量三个层面拆指标", "说明每个指标反映什么", "讲清口径"];
    case "tools":
      return ["列出 2-4 个工具", "说明各自适用场景", "不要只报名字"];
    case "methods":
      return ["先说分析框架", "再说怎么落到数据表", "最后举一个例子"];
    case "scenario":
      return ["先拆阶段", "再看分层", "最后提出验证动作"];
    case "mistakes":
      return ["点出典型误区", "说明为什么错", "给出纠偏思路"];
    default:
      return ["给出结构化回答", "尽量结合例子说明"];
  }
}

function focusPattern(focus: string): RegExp {
  switch (focus) {
    case "目标":
      return /(目标|目的是|核心目标|为了|解决)/;
    case "职责边界":
      return /(职责边界|边界|区别|不只是|不仅是|不只是执行|不只是安排)/;
    case "价值":
      return /(价值|作用|意义|收益|帮助)/;
    case "漏斗指标":
      return /(漏斗指标|转化率|各阶段|漏斗|投递到面试|面试到offer|offer到入职)/i;
    case "效率指标":
      return /(效率指标|时长|周期|效率|招聘周期|响应速度)/i;
    case "质量指标":
      return /(质量指标|质量|入职|留存|通过率|匹配度)/i;
    case "Excel":
      return /(excel|透视表|数据透视)/i;
    case "SQL":
      return /(sql|查询|取数)/i;
    case "BI":
      return /(bi|看板|dashboard|仪表盘)/i;
    case "ATS":
      return /(ats|招聘系统|系统)/i;
    case "漏斗分析":
      return /(漏斗分析|漏斗|转化)/i;
    case "分层对比":
      return /(分层对比|分层|对比|拆分维度)/i;
    case "趋势分析":
      return /(趋势分析|趋势|环比|同比)/i;
    case "归因":
      return /(归因|原因分析|定位原因)/i;
    case "分段定位":
      return /(分段定位|分段|阶段定位|逐段排查)/i;
    case "转化率":
      return /(转化率|转化)/i;
    case "渠道质量":
      return /(渠道质量|渠道效果|渠道表现)/i;
    case "假设验证":
      return /(假设验证|验证|假设|排查)/i;
    case "口径混乱":
      return /(口径混乱|口径不一致|定义不一致)/i;
    case "样本偏差":
      return /(样本偏差|样本不足|偏差)/i;
    case "只看总量不看分层":
      return /(只看总量|不看分层|总量|分层)/i;
    default:
      return new RegExp(focus.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function coverageCount(answer: string, expectedFocus: string[]): number {
  return expectedFocus.filter((item) => focusPattern(item).test(answer)).length;
}

function missingFocusItems(answer: string, expectedFocus: string[]): string[] {
  return expectedFocus.filter((item) => !focusPattern(item).test(answer));
}

export function buildTeachingFeedback(
  topicTitle: string,
  prompt: LearningPrompt,
  answer: string
): TeachingFeedback {
  const trimmed = answer.trim();
  const focusHits = coverageCount(trimmed, prompt.expectedFocus);
  const multiSentence = trimmed.split(/[。！？!?;；]/).filter(Boolean).length >= 2;
  let answerQuality: TeachingFeedback["answerQuality"] = "unclear";

  if ((trimmed.length >= 80 && focusHits >= 2 && multiSentence) || (trimmed.length >= 120 && focusHits >= 1)) {
    answerQuality = "strong";
  } else if (trimmed.length >= 45) {
    answerQuality = "partial";
  }

  const skeleton = expectedAnswerSkeleton(prompt);
  const blindSpots =
    answerQuality === "strong"
      ? []
      : uniqueStrings([
          ...missingFocusItems(trimmed, prompt.expectedFocus).map((item) => `还没有明确覆盖「${item}」`),
          trimmed.length < 50 ? "回答还偏短，结构不够完整。" : ""
        ].filter(Boolean));

  const highlights = uniqueStrings([
    trimmed.length >= 50 ? "你已经开始用自己的话组织答案了。" : "",
    focusHits >= 1 ? "你已经触碰到关键点。" : "",
    multiSentence ? "你的回答开始具备结构。" : ""
  ].filter(Boolean));

  const teachingHint =
    prompt.intent === "definition"
      ? `这个问题最好的讲法是：先说 ${topicTitle} 的目标，再划清和执行动作的边界，最后说明它为什么能提升业务结果。`
      : prompt.intent === "metrics"
        ? `这类题不要只报指标名字，最好按数量、效率、质量三层去讲，并补一句每个指标的判断价值。`
        : prompt.intent === "tools"
          ? `工具题的关键不是列名单，而是说清每个工具解决什么问题，比如 Excel 做快分析，SQL 做取数，BI 做持续看板。`
          : prompt.intent === "methods"
            ? `方法题最好带框架感，比如先拆漏斗，再做分层对比，再看趋势和归因，不要只说“我会分析一下”。`
            : prompt.intent === "scenario"
              ? `场景题最好表现出排查顺序：先分段定位，再看转化率和分层，最后用假设验证收口。`
              : `误区题最好说清“为什么容易错”和“怎么纠偏”，这样更像真的会用。`;

  const coachReply =
    answerQuality === "strong"
      ? `这轮回答已经不错了。${teachingHint} 接下来你可以把 ${topicTitle} 的这个问题再往“指标、方法、案例”三个层面说得更完整。`
      : answerQuality === "partial"
        ? `你已经答到了一部分，但还没有把这个问题真正讲透。${teachingHint} 我建议你再补清“定义、口径、场景”这几个角度。`
        : `这轮回答还比较模糊。没关系，这正是学习价值所在。${teachingHint} 我先帮你把这个问题的标准思路搭起来。`;

  return {
    answerQuality,
    coachReply,
    highlights: highlights.length ? highlights : ["你已经开始暴露出真正需要补的盲区了。"],
    blindSpots,
    suggestedAnswer: skeleton.map((item) => clampText(item, 36)),
    nextStep:
      answerQuality === "strong"
        ? "继续进入下一题，保持结构化表达。"
        : `先按这几个骨架重组答案：${skeleton.join("；")}`
  };
}

export function advancePromptQueue(
  queue: LearningPrompt[],
  feedback: TeachingFeedback
): LearningPrompt[] {
  if (!queue.length) {
    return [];
  }

  const [, ...rest] = queue;
  if (feedback.answerQuality === "strong") {
    return rest;
  }

  const current = queue[0];
  const normalizedQuestion = current.question.replace(/^(换个更具体的角度再回答一次：)+/u, "").trim();
  const followUp: LearningPrompt = {
    id: createId("prompt"),
    question: `换个更具体的角度再回答一次：${normalizedQuestion}`,
    intent: current.intent,
    difficulty: "core",
    expectedFocus: current.expectedFocus
  };

  return [followUp, ...rest];
}
