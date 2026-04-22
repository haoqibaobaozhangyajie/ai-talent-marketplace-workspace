import { useEffect, useMemo, useState } from "react";
import type {
  CreateRoleProfileDraftInput,
  RoleProfileCard,
  RoleProfileWorkspaceState,
  ScreeningGuide,
  SearchStrategy
} from "@shared/contracts";

type AppMode = "widget" | "preview";
type RoleProfileTab = "intake" | "clarify" | "output";

function detectMode(): AppMode {
  return window.__LEARNING_APP_MODE__ === "widget" ? "widget" : "preview";
}

function extractPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "structuredContent" in (value as Record<string, unknown>)) {
    return (value as { structuredContent: T }).structuredContent;
  }
  return value as T;
}

function isRoleProfileWorkspaceState(value: unknown): value is RoleProfileWorkspaceState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "availableDrafts" in (value as Record<string, unknown>) &&
      "clarityScore" in (value as Record<string, unknown>) &&
      "pendingQuestions" in (value as Record<string, unknown>)
  );
}

async function callPreviewApi<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
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
    case "open_role_profile_workspace":
      return callPreviewApi<T>("/api/role-profile/workspace", args);
    case "create_role_profile_draft":
      return callPreviewApi<T>("/api/role-profile/drafts", args);
    case "answer_role_profile_question":
      return callPreviewApi<T>("/api/role-profile/answer", args);
    case "finalize_role_profile":
      return callPreviewApi<T>("/api/role-profile/finalize", args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ListCard({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <section className={`role-output-card ${accent ? "accent" : ""}`}>
      <div className="insight-label">{title}</div>
      {items.length ? (
        <ul className="review-list compact">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="empty-inline">当前还没有沉淀出内容。</div>
      )}
    </section>
  );
}

function ProfileSummary({ profileCard }: { profileCard: RoleProfileCard | null }) {
  if (!profileCard) {
    return (
      <section className="role-output-card accent">
        <div className="insight-label">标准岗位画像</div>
        <div className="empty-inline">先创建草稿，系统才会开始沉淀标准岗位画像。</div>
      </section>
    );
  }

  return (
    <section className="role-output-card accent">
      <div className="insight-label">标准岗位画像</div>
      <div className="role-card-head">
        <div>
          <div className="role-card-title">{profileCard.targetRole}</div>
          <div className="role-card-subtitle">{profileCard.readyForSearch ? "已达到可搜索状态" : "仍在澄清中"}</div>
        </div>
        <span className={`role-status-chip ${profileCard.readyForSearch ? "ready" : "draft"}`}>
          {profileCard.readyForSearch ? "可进入搜索" : "继续补口径"}
        </span>
      </div>
      <p>{profileCard.summary}</p>
      <div className="role-output-grid">
        <ListCard title="核心职责" items={profileCard.coreResponsibilities} />
        <ListCard title="必须项" items={profileCard.mustHaves} />
        <ListCard title="加分项" items={profileCard.niceToHaves} />
        <ListCard title="风险项" items={profileCard.riskConstraints} />
      </div>
    </section>
  );
}

function SearchStrategyCard({ strategy }: { strategy: SearchStrategy | null }) {
  if (!strategy) {
    return null;
  }

  return (
    <section className="role-output-card">
      <div className="insight-label">搜索策略</div>
      <div className="role-output-grid">
        <section className="role-metric-card">
          <div className="clarity-title">关键词簇</div>
          <div className="cluster-stack">
            {strategy.keywordClusters.map((cluster) => (
              <div key={cluster.label} className="cluster-card">
                <strong>{cluster.label}</strong>
                <div className="tag-row">
                  {cluster.terms.map((term) => (
                    <span className="focus-chip" key={`${cluster.label}-${term}`}>
                      {term}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="role-metric-card">
          <div className="clarity-title">替代称谓</div>
          <div className="tag-row">
            {strategy.alternativeTitles.map((term) => (
              <span className="goal-chip static" key={term}>
                {term}
              </span>
            ))}
          </div>
        </section>
      </div>
      <section className="role-query-card">
        <div className="clarity-title">布尔检索式</div>
        <code>{strategy.booleanQuery}</code>
      </section>
      <div className="role-output-grid">
        <ListCard title="建议来源" items={strategy.recommendedSources} />
        <ListCard title="验证要点" items={strategy.evidenceChecks} />
      </div>
    </section>
  );
}

function ScreeningGuideCard({ guide }: { guide: ScreeningGuide | null }) {
  if (!guide) {
    return null;
  }
  return (
    <section className="role-output-card">
      <div className="insight-label">初筛标准</div>
      <div className="role-output-grid">
        <ListCard title="优先信号" items={guide.prioritySignals} />
        <ListCard title="淘汰信号" items={guide.eliminationSignals} accent />
        <ListCard title="灰区项" items={guide.graySignals} />
      </div>
    </section>
  );
}

export function RoleProfileApp() {
  const [mode] = useState<AppMode>(detectMode);
  const [workspace, setWorkspace] = useState<RoleProfileWorkspaceState | null>(() => {
    const initial = extractPayload<unknown>(window.openai?.toolOutput);
    return isRoleProfileWorkspaceState(initial) ? initial : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<RoleProfileTab>("intake");

  const [targetRole, setTargetRole] = useState("产品经理");
  const [businessContext, setBusinessContext] = useState("");
  const [currentStage, setCurrentStage] = useState("");
  const [notes, setNotes] = useState("");
  const [coreResponsibilitiesText, setCoreResponsibilitiesText] = useState("");
  const [mustHavesText, setMustHavesText] = useState("");
  const [niceToHavesText, setNiceToHavesText] = useState("");
  const [riskConstraintsText, setRiskConstraintsText] = useState("");
  const [questionAnswer, setQuestionAnswer] = useState("");

  const currentDraftId = workspace?.draft?.id;
  const readinessLabel = useMemo(() => {
    if (!workspace?.draft) {
      return "等待草稿";
    }
    return workspace.readyForSearch ? "可进入人才搜索" : "先统一搜索口径";
  }, [workspace]);

  async function refreshWorkspace(draftId?: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await invokeTool<RoleProfileWorkspaceState>("open_role_profile_workspace", { draftId });
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
      const structured = params?.structuredContent;
      if (isRoleProfileWorkspaceState(structured)) {
        setWorkspace(structured);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleCreateDraft() {
    setLoading(true);
    setError(null);
    try {
      const payload: CreateRoleProfileDraftInput = {
        targetRole,
        businessContext,
        currentStage,
        notes,
        coreResponsibilities: linesToList(coreResponsibilitiesText),
        mustHaves: linesToList(mustHavesText),
        niceToHaves: linesToList(niceToHavesText),
        riskConstraints: linesToList(riskConstraintsText)
      };
      const next = await invokeTool<RoleProfileWorkspaceState>("create_role_profile_draft", payload);
      setWorkspace(next);
      setMobileTab("clarify");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAnswerQuestion() {
    if (!workspace?.draft || !workspace.currentQuestion) {
      setError("当前没有需要回答的追问。");
      return;
    }
    if (!questionAnswer.trim()) {
      setError("先回答当前这道澄清问题。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await invokeTool<RoleProfileWorkspaceState>("answer_role_profile_question", {
        draftId: workspace.draft.id,
        questionId: workspace.currentQuestion.id,
        answer: questionAnswer
      });
      setWorkspace(next);
      setQuestionAnswer("");
      setMobileTab("output");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFinalize() {
    if (!workspace?.draft) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await invokeTool<RoleProfileWorkspaceState>("finalize_role_profile", {
        draftId: workspace.draft.id
      });
      setWorkspace(next);
      setMobileTab("output");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell role-profile-shell">
      <header className="topbar role-topbar">
        <div>
          <div className="eyebrow">Role Profile Workspace</div>
          <h1>把模糊用人需求，澄清成可搜索的人才画像</h1>
          <p>这一步先不直接搜人。我们先统一业务背景、职责边界、必须项和风险项，再把结果交给下游的人才搜索与初筛环节。</p>
        </div>
        <div className="topbar-actions">
          <span className="mode-chip">{mode === "widget" ? "ChatGPT Widget" : "Preview Web"}</span>
          <button className="ghost-button" type="button" onClick={() => void refreshWorkspace(currentDraftId)}>
            刷新工作台
          </button>
        </div>
      </header>

      <div className="mobile-tabs">
        {[
          ["intake", "需求输入"],
          ["clarify", "AI 追问"],
          ["output", "标准画像"]
        ].map(([id, label]) => (
          <button
            key={id}
            className={mobileTab === id ? "active" : ""}
            onClick={() => setMobileTab(id as RoleProfileTab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="workspace-grid role-workspace-grid">
        <section className={`panel role-panel ${mobileTab === "intake" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <h2>模糊需求输入</h2>
            <span>{workspace?.availableDrafts.length ?? 0} 份草稿</span>
          </div>

          <div className="role-intake-card">
            <div className="section-intro">
              <strong>先把你现在知道的部分说出来。</strong>
              <p>哪怕只知道岗位名称、业务方向和最怕招错什么，也足够开始。</p>
            </div>

            <label className="role-field">
              <span>目标岗位</span>
              <input value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="例如：产品经理" />
            </label>

            <label className="role-field">
              <span>业务背景</span>
              <textarea
                value={businessContext}
                onChange={(event) => setBusinessContext(event.target.value)}
                placeholder="例如：负责 B 端产品团队，要解决复杂流程效率与跨团队协同问题。"
              />
            </label>

            <label className="role-field">
              <span>业务阶段 / 团队场景</span>
              <input
                value={currentStage}
                onChange={(event) => setCurrentStage(event.target.value)}
                placeholder="例如：业务过了 0-1，正在做多团队协同与流程优化。"
              />
            </label>

            <label className="role-field">
              <span>核心职责（每行一条，可先粗写）</span>
              <textarea
                value={coreResponsibilitiesText}
                onChange={(event) => setCoreResponsibilitiesText(event.target.value)}
                placeholder={"例如：负责复杂需求拆解\n推动跨团队方案落地\n建立需求优先级机制"}
              />
            </label>

            <label className="role-field">
              <span>必须项（每行一条）</span>
              <textarea
                value={mustHavesText}
                onChange={(event) => setMustHavesText(event.target.value)}
                placeholder={"例如：有 B 端产品经验\n做过复杂流程设计\n有跨团队推进案例"}
              />
            </label>

            <label className="role-field">
              <span>加分项（每行一条）</span>
              <textarea
                value={niceToHavesText}
                onChange={(event) => setNiceToHavesText(event.target.value)}
                placeholder={"例如：做过工作台类产品\n有数据分析习惯"}
              />
            </label>

            <label className="role-field">
              <span>风险项（每行一条）</span>
              <textarea
                value={riskConstraintsText}
                onChange={(event) => setRiskConstraintsText(event.target.value)}
                placeholder={"例如：只做过标准化功能\n没有复杂场景取舍案例"}
              />
            </label>

            <label className="role-field">
              <span>补充说明</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="例如：这次先服务人才搜索，希望产出的口径能继续流向初筛和面试。"
              />
            </label>

            <div className="editor-actions">
              <button className="primary-button" type="button" onClick={handleCreateDraft} disabled={loading}>
                创建岗位画像草稿
              </button>
            </div>
          </div>

          <div className="topic-list role-draft-list">
            {(workspace?.availableDrafts ?? []).map((draft) => (
              <button
                className={`topic-pill ${draft.id === currentDraftId ? "active" : ""}`}
                key={draft.id}
                onClick={() => void refreshWorkspace(draft.id)}
                type="button"
              >
                <span>{draft.targetRole}</span>
                <small>{draft.status === "ready" ? "已可搜索" : "继续澄清中"}</small>
              </button>
            ))}
          </div>
        </section>

        <section className={`panel role-panel ${mobileTab === "clarify" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <h2>AI 追问与澄清</h2>
            <span>{readinessLabel}</span>
          </div>

          <div className="goal-clarity-card role-clarity-card">
            <div className="goal-clarity-head">
              <div>
                <div className="insight-label">画像清晰度</div>
                <div className="goal-score">{workspace?.clarityScore ?? 0}/100</div>
              </div>
              <div className="goal-score-note">{workspace?.draft?.targetRole ?? "等待岗位"}</div>
            </div>
            <p>{workspace?.claritySummary ?? "先创建草稿，系统会开始判断画像缺口。"}</p>
            {(workspace?.missingFields ?? []).length ? (
              <div className="clarity-block">
                <div className="clarity-title">还没讲清的地方</div>
                <ul className="review-list compact">
                  {workspace!.missingFields.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="prompt-card role-question-card">
            <div className="prompt-topline">
              <span className="prompt-badge">当前追问</span>
              <span className="prompt-hint">目标不是聊天，而是逐步补齐后续搜索和筛选需要的判断口径。</span>
            </div>
            <h3>{workspace?.currentQuestion?.question ?? "当前没有待回答追问，可以直接生成标准岗位画像。"}</h3>
            {workspace?.currentQuestion ? (
              <>
                <div className="clarity-title">{workspace.currentQuestion.rationale}</div>
                <label className="role-field">
                  <span>你的回答</span>
                  <textarea
                    value={questionAnswer}
                    onChange={(event) => setQuestionAnswer(event.target.value)}
                    placeholder={workspace.currentQuestion.placeholder}
                  />
                </label>
                <div className="editor-actions">
                  <button className="primary-button" type="button" onClick={handleAnswerQuestion} disabled={loading}>
                    提交这一轮澄清
                  </button>
                  <button className="ghost-button" type="button" onClick={handleFinalize} disabled={loading}>
                    直接生成当前画像
                  </button>
                </div>
              </>
            ) : (
              <div className="editor-actions">
                <button className="primary-button" type="button" onClick={handleFinalize} disabled={loading || !workspace?.draft}>
                  生成标准岗位画像
                </button>
              </div>
            )}
          </div>

          <div className="turn-stream">
            <div className="stream-head">最近澄清记录</div>
            {(workspace?.answers ?? []).length ? (
              workspace!.answers.map((answer) => (
                <article className="turn-card" key={answer.id}>
                  <div className="turn-meta">
                    <div className="turn-time">{answer.createdAt}</div>
                    <span className="quality-badge partial">{answer.field}</span>
                  </div>
                  <h3>{answer.question}</h3>
                  <p>{answer.answer}</p>
                </article>
              ))
            ) : (
              <div className="empty-state">这里会记录每一轮澄清，方便之后继续复用到搜索和面试环节。</div>
            )}
          </div>
        </section>

        <section className={`panel role-panel ${mobileTab === "output" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <h2>标准画像与搜索包</h2>
            <span>{workspace?.readyForSearch ? "已可下游复用" : "仍建议继续补齐"}</span>
          </div>

          <ProfileSummary profileCard={workspace?.profileCard ?? null} />
          <SearchStrategyCard strategy={workspace?.searchStrategy ?? null} />
          <ScreeningGuideCard guide={workspace?.screeningGuide ?? null} />
        </section>
      </main>
    </div>
  );
}
