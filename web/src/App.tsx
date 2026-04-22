import { useEffect, useMemo, useState } from "react";
import type {
  CreateTopicInput,
  ExportXMindResult,
  KnowledgeGraph,
  KnowledgeNode,
  LearningPrompt,
  RecordTurnResult,
  RefineMapResult,
  TopicManifest,
  TurnCapture,
  WorkspaceState
} from "@shared/contracts";

type AppMode = "widget" | "preview";
type MobileTab = "topics" | "study" | "insights";

const GOAL_FALLBACK = "通过问题把盲区问出来，再一轮轮教会你。";

function detectMode(): AppMode {
  return window.__LEARNING_APP_MODE__ === "widget" ? "widget" : "preview";
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  return Boolean(
    value &&
      typeof value === "object" &&
      "availableTopics" in (value as Record<string, unknown>) &&
      "recentTurns" in (value as Record<string, unknown>)
  );
}

function extractPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "structuredContent" in (value as Record<string, unknown>)) {
    return (value as { structuredContent: T }).structuredContent;
  }
  return value as T;
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
    const message = await response.text();
    throw new Error(message || "Request failed.");
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
    case "open_learning_workspace":
      return callPreviewApi<T>("/api/workspace", args);
    case "create_learning_topic":
      return callPreviewApi<T>("/api/topics", args);
    case "record_learning_turn":
      return callPreviewApi<T>("/api/turns", args);
    case "refine_knowledge_map":
      return callPreviewApi<T>("/api/refine", args);
    case "export_xmind_file":
      return callPreviewApi<T>("/api/export", args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function collectRootChildren(graph: KnowledgeGraph | null): KnowledgeNode[] {
  if (!graph) {
    return [];
  }
  return graph.nodes[graph.rootId].children.map((childId) => graph.nodes[childId]);
}

function renderTreeNode(graph: KnowledgeGraph, nodeId: string) {
  const node = graph.nodes[nodeId];
  return (
    <li key={node.id} className="tree-node">
      <div className="tree-card">
        <div className="tree-title">{node.title}</div>
        <div className="tree-summary">{node.summary || "待补充总结"}</div>
      </div>
      {node.children.length > 0 ? (
        <ul className="tree-children">{node.children.map((childId) => renderTreeNode(graph, childId))}</ul>
      ) : null}
    </li>
  );
}

function TopicPill({
  topic,
  active,
  onClick
}: {
  topic: TopicManifest;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`topic-pill ${active ? "active" : ""}`} onClick={onClick} type="button">
      <span>{topic.title}</span>
      <small>{topic.tags.join(" / ") || "学习主题"}</small>
    </button>
  );
}

function answerQualityLabel(turn: TurnCapture): string {
  switch (turn.answerQuality) {
    case "strong":
      return "答得比较扎实";
    case "partial":
      return "答到一半";
    default:
      return "还比较模糊";
  }
}

function difficultyLabel(prompt: LearningPrompt | null | undefined) {
  switch (prompt?.difficulty) {
    case "warmup":
      return "热身题";
    case "core":
      return "核心题";
    case "challenge":
      return "追问题";
    default:
      return "当前题";
  }
}

export function App() {
  const [mode] = useState<AppMode>(detectMode);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(() => {
    const initial = extractPayload<unknown>(window.openai?.toolOutput);
    return isWorkspaceState(initial) ? initial : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [newTopicTitle, setNewTopicTitle] = useState("");
  const [newTopicDescription, setNewTopicDescription] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("study");

  const selectedTopicId = workspace?.topic?.id;
  const rootChildren = useMemo(() => collectRootChildren(workspace?.graph ?? null), [workspace]);

  async function refreshWorkspace(topicId?: string) {
    setLoading(true);
    setError(null);
    try {
      const nextWorkspace = await invokeTool<WorkspaceState>("open_learning_workspace", {
        topicId: topicId ?? workspace?.topic?.id,
        sessionId: workspace?.session?.id
      });
      setWorkspace(nextWorkspace);
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
      if (!structured || typeof structured !== "object") {
        return;
      }

      const maybeWorkspace = (structured as { workspace?: WorkspaceState }).workspace;
      if (maybeWorkspace && isWorkspaceState(maybeWorkspace)) {
        setWorkspace(maybeWorkspace);
        return;
      }
      if (isWorkspaceState(structured)) {
        setWorkspace(structured);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleCreateTopic() {
    if (!newTopicTitle.trim()) {
      setError("请先输入主题名称。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const topic = await invokeTool<TopicManifest>("create_learning_topic", {
        title: newTopicTitle,
        description: newTopicDescription || undefined,
        tags: []
      } satisfies CreateTopicInput);
      setNewTopicTitle("");
      setNewTopicDescription("");
      await refreshWorkspace(topic.id);
      setMobileTab("study");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordTurn() {
    if (!workspace?.topic || !workspace.session) {
      setError("当前还没有激活的学习主题。");
      return;
    }
    if (!answer.trim()) {
      setError("先回答当前这道题。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<RecordTurnResult>("record_learning_turn", {
        topicId: workspace.topic.id,
        sessionId: workspace.session.id,
        question: workspace.currentPrompt?.question ?? workspace.session.goal,
        answer,
        turnClientId: `client-${Date.now()}`
      });
      setWorkspace(result.workspace);
      setAnswer("");
      setMobileTab("insights");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefine(action: "auto" | "merge" | "split" | "reparent") {
    if (!workspace?.topic || !workspace.session) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<RefineMapResult>("refine_knowledge_map", {
        topicId: workspace.topic.id,
        sessionId: workspace.session.id,
        action
      });
      setWorkspace(result.workspace);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    if (!workspace?.topic || !workspace.session) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invokeTool<ExportXMindResult>("export_xmind_file", {
        topicId: workspace.topic.id,
        sessionId: workspace.session.id
      });
      setWorkspace(result.workspace);
      setMobileTab("insights");
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Learning Coach Workspace</div>
          <h1>系统发问，你来回答，答完我再教你</h1>
          <p>这不是记笔记表单，而是一位会追问、会指出盲区、会把知识沉淀成知识树和 XMind 的学习教练。</p>
        </div>
        <div className="topbar-actions">
          <span className="mode-chip">{mode === "widget" ? "ChatGPT Widget" : "Preview Web"}</span>
          <button className="ghost-button" onClick={() => void refreshWorkspace()} type="button">
            刷新工作台
          </button>
        </div>
      </header>

      <div className="mobile-tabs">
        {[
          ["topics", "目标与知识树"],
          ["study", "系统发问"],
          ["insights", "教练反馈"]
        ].map(([id, label]) => (
          <button
            key={id}
            className={mobileTab === id ? "active" : ""}
            onClick={() => setMobileTab(id as MobileTab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="workspace-grid">
        <section className={`panel left-panel ${mobileTab === "topics" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <h2>目标与学习边界</h2>
            <span>{workspace?.availableTopics.length ?? 0} 个主题</span>
          </div>

          <div className="topic-creator">
            <div className="section-intro">
              <strong>先说清你到底想学什么。</strong>
              <p>最好写出：你最想补哪块、现在卡在哪、学完要用在什么场景。</p>
            </div>
            <input
              placeholder="新主题，例如：招聘运营"
              value={newTopicTitle}
              onChange={(event) => setNewTopicTitle(event.target.value)}
            />
            <textarea
              placeholder="例如：我想系统学招聘运营的指标、工具和漏斗分析方法，现在最卡在怎么复盘渠道质量，后面想用于周报和复盘汇报。"
              value={newTopicDescription}
              onChange={(event) => setNewTopicDescription(event.target.value)}
            />
            <button className="primary-button" onClick={handleCreateTopic} type="button" disabled={loading}>
              创建学习主题
            </button>
          </div>

          <div className="topic-list">
            {(workspace?.availableTopics ?? []).map((topic) => (
              <TopicPill
                key={topic.id}
                topic={topic}
                active={topic.id === selectedTopicId}
                onClick={() => void refreshWorkspace(topic.id)}
              />
            ))}
          </div>

          <div className="goal-clarity-card">
            <div className="goal-clarity-head">
              <div>
                <div className="insight-label">目标清晰度</div>
                <div className="goal-score">{workspace?.goalClarity?.score ?? 0}/100</div>
              </div>
              <div className="goal-score-note">{workspace?.session?.goal ?? GOAL_FALLBACK}</div>
            </div>
            <p>{workspace?.goalClarity?.summary ?? "先选一个主题，系统会判断你的目标是否足够清晰。"}</p>

            {(workspace?.goalClarity?.missingPoints ?? []).length ? (
              <div className="clarity-block">
                <div className="clarity-title">还没说清的地方</div>
                <ul className="review-list compact">
                  {workspace!.goalClarity!.missingPoints.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(workspace?.goalClarity?.clarificationQuestions ?? []).length ? (
              <div className="clarity-block">
                <div className="clarity-title">系统建议你先想清这些问题</div>
                <ul className="review-list compact">
                  {workspace!.goalClarity!.clarificationQuestions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="tree-panel">
            <div className="tree-root">
              <div className="tree-root-title">{workspace?.graph ? workspace.graph.nodes[workspace.graph.rootId].title : "暂无知识树"}</div>
              <div className="tree-root-summary">
                {workspace?.graph ? workspace.graph.nodes[workspace.graph.rootId].summary : "先创建一个主题开始学习。"}
              </div>
            </div>
            {workspace?.graph ? (
              <ul className="tree-list">{rootChildren.map((node) => renderTreeNode(workspace.graph!, node.id))}</ul>
            ) : (
              <div className="empty-state">知识树会随着系统发问和你的回答逐步长出来。</div>
            )}
          </div>
        </section>

        <section className={`panel center-panel ${mobileTab === "study" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <h2>系统发问</h2>
            <span>{workspace?.topic?.title ?? "等待主题"}</span>
          </div>

          <div className="prompt-card">
            <div className="prompt-topline">
              <span className="prompt-badge">{difficultyLabel(workspace?.currentPrompt ?? null)}</span>
              <span className="prompt-hint">目标是把你暂时不会的地方问出来，再一层层补上。</span>
            </div>
            <h3>{workspace?.currentPrompt?.question ?? "先创建或选择一个主题，系统就会开始发问。"}</h3>
            <div className="focus-row">
              {(workspace?.currentPrompt?.expectedFocus ?? []).map((item) => (
                <span className="focus-chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="goal-strip">
            {(workspace?.goalSuggestions ?? []).map((goal) => (
              <span className="goal-chip static" key={goal}>
                {goal}
              </span>
            ))}
          </div>

          <div className="qa-editor">
            <label>
              <span>你的回答</span>
              <textarea
                placeholder="直接回答上面的题。你不需要自己想问题，重点是把你现在能想到的内容说出来，系统会指出盲区并继续教你。"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <div className="editor-actions">
              <button className="primary-button" onClick={handleRecordTurn} type="button" disabled={loading}>
                提交回答并获得讲解
              </button>
              <button className="ghost-button" onClick={() => void handleRefine("auto")} type="button" disabled={loading}>
                自动整理知识树
              </button>
            </div>
          </div>

          <div className="turn-stream">
            <div className="stream-head">最近几轮你被问到什么</div>
            {(workspace?.recentTurns ?? []).length ? (
              workspace!.recentTurns.map((turn) => (
                <article className="turn-card" key={turn.id}>
                  <div className="turn-meta">
                    <div className="turn-time">{turn.createdAt}</div>
                    <span className={`quality-badge ${turn.answerQuality}`}>{answerQualityLabel(turn)}</span>
                  </div>
                  <h3>{turn.question}</h3>
                  <p>{turn.summary}</p>
                  <div className="tag-row">
                    {turn.keyPoints.map((point) => (
                      <span key={point} className="mini-tag">
                        {point}
                      </span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">等你回答第一题后，这里会记录系统追问的轨迹。</div>
            )}
          </div>
        </section>

        <section className={`panel right-panel ${mobileTab === "insights" ? "mobile-active" : ""}`}>
          <div className="panel-head">
            <h2>教练反馈</h2>
            <span>{workspace?.topic?.title ?? "等待主题"}</span>
          </div>

          <div className="insight-card accent">
            <div className="insight-label">当前学习目标</div>
            <div className="insight-value">{workspace?.session?.goal ?? GOAL_FALLBACK}</div>
            <p>{workspace?.session?.goalDetail ?? "先补一句你想学会什么、卡在哪里、准备怎么使用。"}</p>
          </div>

          <div className="insight-card">
            <div className="insight-label">这一轮老师会怎么点评你</div>
            {workspace?.latestFeedback ? (
              <div className="feedback-stack">
                <div className="coach-reply">{workspace.latestFeedback.coachReply}</div>

                <div className="clarity-block">
                  <div className="clarity-title">你已经答到的重点</div>
                  <ul className="review-list compact">
                    {workspace.latestFeedback.highlights.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="clarity-block">
                  <div className="clarity-title">还没补上的盲区</div>
                  {workspace.latestFeedback.blindSpots.length ? (
                    <ul className="review-list compact">
                      {workspace.latestFeedback.blindSpots.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-inline">这一轮已经比较完整了，可以继续下一题。</div>
                  )}
                </div>

                <div className="clarity-block">
                  <div className="clarity-title">建议回答骨架</div>
                  <ul className="review-list compact">
                    {workspace.latestFeedback.suggestedAnswer.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="next-step-note">{workspace.latestFeedback.nextStep}</div>
              </div>
            ) : (
              <div className="empty-inline">先答一题，这里会出现系统讲解、盲区提醒和标准回答骨架。</div>
            )}
          </div>

          <div className="insight-card">
            <div className="insight-label">待复习项</div>
            {(workspace?.pendingReview ?? []).length ? (
              <ul className="review-list">
                {workspace!.pendingReview.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="empty-inline">再完成一两轮，系统会把需要回看的点沉淀到这里。</div>
            )}
          </div>

          <div className="insight-card">
            <div className="insight-label">最近导出</div>
            {workspace?.exportStatus ? (
              <>
                <div className="insight-value">{workspace.exportStatus.filename}</div>
                <p>{workspace.exportStatus.path}</p>
                <small>{workspace.exportStatus.exportedAt}</small>
              </>
            ) : (
              <div className="empty-inline">还没有导出 XMind 文件。</div>
            )}
          </div>

          <div className="action-stack">
            <button className="primary-button" onClick={handleExport} type="button" disabled={loading}>
              一键导出 XMind
            </button>
            <button className="ghost-button" onClick={() => void handleRefine("auto")} type="button" disabled={loading}>
              自动去重和整理
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
