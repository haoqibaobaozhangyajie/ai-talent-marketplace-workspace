import { useEffect, useMemo, useState } from "react";
import type {
  EmployeeProfile,
  JobProfile,
  MarketplaceWorkspaceState,
  MatchResult,
  ReviewDecisionType
} from "@shared/contracts";

type AppMode = "widget" | "preview";
type MarketplaceTab = "overview" | "job" | "employee";

function detectMode(): AppMode {
  return window.__LEARNING_APP_MODE__ === "widget" ? "widget" : "preview";
}

function extractPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "structuredContent" in (value as Record<string, unknown>)) {
    return (value as { structuredContent: T }).structuredContent;
  }
  return value as T;
}

function isMarketplaceWorkspaceState(value: unknown): value is MarketplaceWorkspaceState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "overview" in (value as Record<string, unknown>) &&
      "movementHistory" in (value as Record<string, unknown>) &&
      "jobMatches" in (value as Record<string, unknown>)
  );
}

async function callPreviewApi<T>(endpoint: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(endpoint, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Request failed.");
  }
  return response.json() as Promise<T>;
}

async function invokeTool<T>(name: string, args: unknown): Promise<T> {
  const mode = detectMode();
  if (mode === "widget" && typeof window.openai?.callTool === "function") {
    const response = await window.openai.callTool(name, args);
    return extractPayload<T>(response);
  }

  switch (name) {
    case "open_marketplace_workspace":
      return callPreviewApi<T>("/api/dashboard/marketplace", undefined, "GET");
    case "normalize_job_profile":
      return callPreviewApi<{ workspace: T }>("/api/job-profile/normalize", args).then((payload) => payload.workspace);
    case "normalize_employee_profile":
      return callPreviewApi<{ workspace: T }>("/api/employee-profile/normalize", args).then((payload) => payload.workspace);
    case "match_by_job":
      return callPreviewApi<{ workspace: T }>("/api/match/by-job", args).then((payload) => payload.workspace);
    case "match_by_employee":
      return callPreviewApi<{ workspace: T }>("/api/match/by-employee", args).then((payload) => payload.workspace);
    case "review_match":
      return callPreviewApi<{ workspace: T }>("/api/match/review", args).then((payload) => payload.workspace);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function scoreTone(score: number): "high" | "mid" | "low" {
  if (score >= 84) {
    return "high";
  }
  if (score >= 72) {
    return "mid";
  }
  return "low";
}

function intentLabel(employee: EmployeeProfile): string {
  if (employee.mobilityIntent === "active") {
    return "主动流动";
  }
  if (employee.mobilityIntent === "open") {
    return "开放机会";
  }
  return "暂稳";
}

function priorityLabel(job: JobProfile): string {
  if (job.priority === "critical") {
    return "高优先级";
  }
  if (job.priority === "planned") {
    return "规划中";
  }
  return "储备池";
}

function decisionLabel(decision: ReviewDecisionType): string {
  if (decision === "approve") {
    return "通过";
  }
  if (decision === "hold") {
    return "观察";
  }
  return "淘汰";
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section className="marketplace-metric-card">
      <div className="insight-label">{label}</div>
      <div className="marketplace-metric-value">{value}</div>
      <div className="marketplace-metric-note">{note}</div>
    </section>
  );
}

function MatchCard({
  match,
  onReview
}: {
  match: MatchResult;
  onReview: (match: MatchResult, decision: ReviewDecisionType) => void;
}) {
  return (
    <section className="marketplace-match-card">
      <div className="marketplace-match-head">
        <div>
          <div className="marketplace-match-title">{match.targetLabel}</div>
          <div className="marketplace-match-note">{match.nextAction}</div>
        </div>
        <div className={`marketplace-score-pill ${scoreTone(match.overallScore)}`}>{match.overallScore}</div>
      </div>

      <div className="marketplace-score-grid">
        <div>
          <span>技能</span>
          <strong>{match.skillScore}</strong>
        </div>
        <div>
          <span>经历</span>
          <strong>{match.experienceScore}</strong>
        </div>
        <div>
          <span>意愿</span>
          <strong>{match.intentScore}</strong>
        </div>
      </div>

      <div className="role-output-grid marketplace-grid-tight">
        <section className="role-metric-card">
          <div className="insight-label">为什么匹配</div>
          <ul className="review-list compact">
            {match.reasons.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="role-metric-card">
          <div className="insight-label">风险与差距</div>
          <ul className="review-list compact">
            {[...match.risks, ...match.gapItems].slice(0, 4).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="marketplace-review-actions">
        <button className="primary-button" type="button" onClick={() => onReview(match, "approve")}>
          标记通过
        </button>
        <button className="ghost-button" type="button" onClick={() => onReview(match, "hold")}>
          标记观察
        </button>
        <button className="ghost-button" type="button" onClick={() => onReview(match, "reject")}>
          标记淘汰
        </button>
      </div>
    </section>
  );
}

export function MarketplaceApp() {
  const [mode] = useState<AppMode>(detectMode);
  const [workspace, setWorkspace] = useState<MarketplaceWorkspaceState | null>(() => {
    const initial = extractPayload<unknown>(window.openai?.toolOutput);
    return isMarketplaceWorkspaceState(initial) ? initial : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MarketplaceTab>("overview");

  const [jobRawText, setJobRawText] = useState(
    "人才发展岗\n北京\n负责年度人才盘点、关键岗位梯队建设和内部流动机制。\n要求有人才盘点或胜任力建模经验，能跨团队推进项目。\n有招聘或测评工具背景优先。"
  );
  const [employeeRawText, setEmployeeRawText] = useState(
    "周女士，现任招聘经理。\n负责岗位画像校准、人才映射和内部流动试点。\n希望转向人才发展方向，可接受北京。\n做过招聘数据复盘和关键岗位 mapping。"
  );
  const [reviewer, setReviewer] = useState("HRBP 评审");
  const [reviewComment, setReviewComment] = useState("建议先安排一轮业务校准沟通。");

  const selectedJobId = workspace?.selectedJobId;
  const selectedEmployeeId = workspace?.selectedEmployeeId;

  const activeCandidates = useMemo(
    () =>
      (workspace?.employees ?? [])
        .filter((employee) => employee.mobilityIntent !== "steady")
        .slice(0, 10),
    [workspace]
  );

  async function refreshWorkspace() {
    setLoading(true);
    setError(null);
    try {
      const next = await invokeTool<MarketplaceWorkspaceState>("open_marketplace_workspace", {});
      setWorkspace(next);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!workspace) {
      void refreshWorkspace();
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      const method = (payload as { method?: string }).method;
      if (method !== "ui/notifications/tool-result") {
        return;
      }
      const params = (payload as { params?: { structuredContent?: unknown } }).params;
      if (isMarketplaceWorkspaceState(params?.structuredContent)) {
        setWorkspace(params.structuredContent);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleSelectJob(jobId: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<MarketplaceWorkspaceState>("match_by_job", { jobId, limit: 5 });
      setWorkspace(result);
      setMobileTab("job");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectEmployee(employeeId: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<MarketplaceWorkspaceState>("match_by_employee", { employeeId, limit: 5 });
      setWorkspace(result);
      setMobileTab("employee");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNormalizeJob() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<MarketplaceWorkspaceState>("normalize_job_profile", {
        rawText: jobRawText
      });
      setWorkspace(result);
      setMobileTab("job");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNormalizeEmployee() {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<MarketplaceWorkspaceState>("normalize_employee_profile", {
        rawText: employeeRawText
      });
      setWorkspace(result);
      setMobileTab("employee");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(match: MatchResult, decision: ReviewDecisionType) {
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<MarketplaceWorkspaceState>("review_match", {
        matchId: match.matchId,
        reviewer,
        decision,
        comment: reviewComment
      });
      setWorkspace(result);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell role-profile-shell marketplace-shell">
      <header className="topbar role-topbar">
        <div>
          <div className="eyebrow">AI INTERNAL TALENT MARKETPLACE</div>
          <h1>内部人才市场中台</h1>
          <p>
            通过岗位画像、人才画像、双向匹配和人工判断，帮助企业在内部完成更高效的人才配置与流动协同。
          </p>
        </div>
        <div className="topbar-actions">
          <span className="mode-chip">{mode === "widget" ? "Widget Mode" : "Preview Mode"}</span>
          <button className="ghost-button" type="button" onClick={() => void refreshWorkspace()}>
            刷新数据
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="mobile-tabs">
        <button className={mobileTab === "overview" ? "active" : ""} onClick={() => setMobileTab("overview")} type="button">
          总览
        </button>
        <button className={mobileTab === "job" ? "active" : ""} onClick={() => setMobileTab("job")} type="button">
          岗找人
        </button>
        <button className={mobileTab === "employee" ? "active" : ""} onClick={() => setMobileTab("employee")} type="button">
          人找岗
        </button>
      </div>

      <div className="workspace-grid marketplace-grid">
        <section className={`panel role-panel marketplace-panel ${mobileTab !== "overview" ? "mobile-hidden" : ""}`}>
          <div className="panel-head">
            <div>
              <h2>中台总览</h2>
              <span>先看业务闭环，再看每条推荐怎么解释。</span>
            </div>
          </div>

          <div className="marketplace-metric-grid">
            <MetricCard
              label="人才画像"
              value={String(workspace?.overview.employeeCount ?? 0)}
              note="模拟员工画像"
            />
            <MetricCard label="内部岗位" value={String(workspace?.overview.jobCount ?? 0)} note="结构化岗位画像" />
            <MetricCard
              label="历史样本"
              value={String(workspace?.overview.movementCount ?? 0)}
              note="成功流动先例"
            />
            <MetricCard
              label="主动流动"
              value={String(workspace?.overview.activeMobilityCount ?? 0)}
              note="可优先沟通"
            />
            <MetricCard
              label="高置信匹配"
              value={String(workspace?.overview.highConfidenceCount ?? 0)}
              note="分数 >= 84"
            />
            <MetricCard
              label="就绪岗位"
              value={String(workspace?.overview.readyJobCount ?? 0)}
              note="职责和要求清晰"
            />
          </div>

          <section className="role-output-card accent">
            <div className="insight-label">设计原则</div>
            <ul className="review-list compact">
              {(workspace?.strategyHighlights ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="role-intake-card">
            <div className="insight-label">AI 标准化岗位</div>
            <textarea
              value={jobRawText}
              onChange={(event) => setJobRawText(event.target.value)}
              placeholder="贴一段岗位描述，系统会自动转成岗位画像并跑匹配。"
            />
            <button className="primary-button" type="button" onClick={handleNormalizeJob} disabled={loading}>
              生成岗位画像并匹配
            </button>
          </section>

          <section className="role-intake-card">
            <div className="insight-label">AI 标准化人才</div>
            <textarea
              value={employeeRawText}
              onChange={(event) => setEmployeeRawText(event.target.value)}
              placeholder="贴一段员工履历或转岗意向，系统会自动生成画像并推荐岗位。"
            />
            <button className="primary-button" type="button" onClick={handleNormalizeEmployee} disabled={loading}>
              生成人才画像并匹配
            </button>
          </section>

          <section className="role-intake-card">
            <div className="insight-label">人工判断口径</div>
            <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="评审人" />
            <textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder="本轮判断备注"
            />
          </section>
        </section>

        <section className={`panel role-panel marketplace-panel ${mobileTab !== "job" ? "mobile-hidden" : ""}`}>
          <div className="panel-head">
            <div>
              <h2>岗找人</h2>
              <span>先把岗位画像定清，再自动推荐 5 个内部候选人。</span>
            </div>
          </div>

          <section className="role-output-card accent">
            <div className="role-card-head">
              <div>
                <div className="role-card-title">{workspace?.selectedJob?.title ?? "暂无岗位"}</div>
                <div className="role-card-subtitle">
                  {(workspace?.selectedJob?.dept ?? "待选择部门")} · {(workspace?.selectedJob?.location ?? "待定地点")}
                </div>
              </div>
              {workspace?.selectedJob ? (
                <span className="role-status-chip ready">{priorityLabel(workspace.selectedJob)}</span>
              ) : null}
            </div>
            {workspace?.selectedJob ? (
              <>
                <p>
                  级别范围 {workspace.selectedJob.levelRange.min} - {workspace.selectedJob.levelRange.max}，重点职责：
                  {workspace.selectedJob.responsibilities.join("、")}。
                </p>
                <div className="tag-row">
                  {workspace.selectedJob.keywords.map((keyword) => (
                    <span className="focus-chip" key={keyword}>
                      {keyword}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-inline">请先选择一个岗位。</div>
            )}
          </section>

          <div className="marketplace-list-grid">
            {(workspace?.jobs ?? []).map((job) => (
              <button
                className={`topic-pill ${job.jobId === selectedJobId ? "active" : ""}`}
                key={job.jobId}
                onClick={() => void handleSelectJob(job.jobId)}
                type="button"
              >
                <strong>{job.title}</strong>
                <small>
                  {job.jobFamily} · {job.location} · {job.levelRange.min}-{job.levelRange.max}
                </small>
              </button>
            ))}
          </div>

          <div className="marketplace-match-stack">
            {(workspace?.jobMatches ?? []).map((match) => (
              <MatchCard key={match.matchId} match={match} onReview={handleReview} />
            ))}
          </div>
        </section>

        <section className={`panel role-panel marketplace-panel ${mobileTab !== "employee" ? "mobile-hidden" : ""}`}>
          <div className="panel-head">
            <div>
              <h2>人找岗</h2>
              <span>把员工发展意愿和既有经历一起纳入推荐。</span>
            </div>
          </div>

          <section className="role-output-card accent">
            <div className="role-card-head">
              <div>
                <div className="role-card-title">{workspace?.selectedEmployee?.name ?? "暂无员工"}</div>
                <div className="role-card-subtitle">
                  {workspace?.selectedEmployee?.currentRole ?? "待选择"} · {workspace?.selectedEmployee?.org ?? "待选择"}
                </div>
              </div>
              {workspace?.selectedEmployee ? (
                <span className={`marketplace-intent-pill ${workspace.selectedEmployee.mobilityIntent}`}>
                  {intentLabel(workspace.selectedEmployee)}
                </span>
              ) : null}
            </div>
            {workspace?.selectedEmployee ? (
              <>
                <p>
                  目标方向：{workspace.selectedEmployee.preferredFunctions.join("、")}；期望城市：
                  {workspace.selectedEmployee.preferredCities.join("、")}。
                </p>
                <div className="tag-row">
                  {workspace.selectedEmployee.skills.slice(0, 6).map((skill) => (
                    <span className="goal-chip static" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-inline">请先选择一个员工画像。</div>
            )}
          </section>

          <div className="marketplace-list-grid">
            {activeCandidates.map((employee) => (
              <button
                className={`topic-pill ${employee.employeeId === selectedEmployeeId ? "active" : ""}`}
                key={employee.employeeId}
                onClick={() => void handleSelectEmployee(employee.employeeId)}
                type="button"
              >
                <strong>{employee.name}</strong>
                <small>
                  {employee.currentRole} · {intentLabel(employee)}
                </small>
              </button>
            ))}
          </div>

          <div className="marketplace-match-stack">
            {(workspace?.employeeMatches ?? []).map((match) => (
              <MatchCard key={match.matchId} match={match} onReview={handleReview} />
            ))}
          </div>

          <section className="role-output-card">
            <div className="insight-label">人工判断记录</div>
            <ul className="review-list">
              {(workspace?.reviewDecisions ?? []).slice(0, 6).map((decision) => (
                <li key={`${decision.matchId}-${decision.createdAt}`}>
                  <strong>{decisionLabel(decision.decision)}</strong> · {decision.reviewer}
                  <div className="marketplace-history-note">{decision.comment || "未填写备注"}</div>
                </li>
              ))}
            </ul>
          </section>
        </section>
      </div>
    </div>
  );
}
