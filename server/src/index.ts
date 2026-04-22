import express from "express";
import path from "node:path";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  answerRoleProfileQuestion,
  createRoleProfileDraft,
  finalizeRoleProfile,
  openRoleProfileWorkspace,
  ensureRoleProfileDirectories,
} from "./role-profile-service.js";
import {
  ensureMarketplaceDirectories,
  matchByEmployee,
  matchByJob,
  normalizeEmployeeProfile,
  normalizeJobProfile,
  openMarketplaceWorkspace,
  reviewMatch
} from "./marketplace-service.js";
import {
  createLearningTopic as createLearningTopicWorkspace,
  exportXmindFile as exportXmindFileWorkspace,
  openWorkspace as openLearningWorkspace,
  recordLearningTurn,
  refineKnowledgeMap
} from "./workspace-service.js";
import { APP_HOST, APP_PORT, WIDGET_URI, WEB_DIST_DIR } from "./config.js";
import { renderWidgetHtml } from "./widget-html.js";
import { createJournalEntry, ensureJournalDirectories, listJournalDay } from "./journal-capture.js";
import {
  answerRoleProfileQuestionSchema,
  createRoleProfileDraftSchema,
  createTopicSchema,
  exportXmindSchema,
  finalizeRoleProfileSchema,
  matchByEmployeeSchema,
  matchByJobSchema,
  normalizeEmployeeProfileSchema,
  normalizeJobProfileSchema,
  openRoleProfileWorkspaceSchema,
  openMarketplaceWorkspaceSchema,
  openWorkspaceSchema,
  recordTurnSchema,
  reviewMatchSchema,
  refineMapSchema
} from "./schemas.js";
import { ensureBaseDirectories } from "./knowledge-base.js";

function buildToolResultContent(message: string) {
  return [{ type: "text" as const, text: message }];
}

function toStructuredContent<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function createServer() {
  const server = new McpServer(
    {
      name: "learning-xmind-app",
      version: "0.1.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  registerAppResource(
    server,
    "Learning Workspace",
    WIDGET_URI,
    {
      description: "Interactive knowledge-learning workspace"
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await renderWidgetHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                connectDomains: [],
                resourceDomains: []
              }
            },
            "openai/widgetDescription": "用于系统主动发问、学习反馈、知识树沉淀和 XMind 导出。"
          }
        }
      ]
    })
  );

  registerAppTool(
    server,
    "open_learning_workspace",
    {
      title: "Open Learning Workspace",
      description:
        "Use this when you want to open or refresh the learning workspace for question-answer study and knowledge-map review.",
      inputSchema: openWorkspaceSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI
        },
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "正在准备学习工作台…",
        "openai/toolInvocation/invoked": "学习工作台已就绪"
      }
    },
    async (args) => {
      const workspace = await openLearningWorkspace(args);
      return {
        structuredContent: toStructuredContent(workspace),
        content: buildToolResultContent(`已打开主题「${workspace.topic?.title ?? "未命名主题"}」的学习工作台。`)
      };
    }
  );

  registerAppTool(
    server,
    "create_learning_topic",
    {
      title: "Create Learning Topic",
      description:
        "Use this when you want to create a new study topic such as recruitment operations or data analysis.",
      inputSchema: createTopicSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在创建学习主题…",
        "openai/toolInvocation/invoked": "学习主题已创建"
      }
    },
    async (args) => {
      const topic = await createLearningTopicWorkspace(args);
      return {
        structuredContent: toStructuredContent(topic),
        content: buildToolResultContent(`已创建学习主题「${topic.title}」。`)
      };
    }
  );

  registerAppTool(
    server,
    "record_learning_turn",
    {
      title: "Record Learning Turn",
      description:
        "Use this when a question-answer learning turn has finished and it should be summarized into key points, review prompts, and knowledge-map updates.",
      inputSchema: recordTurnSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在沉淀本轮学习…",
        "openai/toolInvocation/invoked": "本轮学习已沉淀"
      }
    },
    async (args) => {
      const result = await recordLearningTurn(args);
      return {
        structuredContent: toStructuredContent(result),
        content: buildToolResultContent("已沉淀一轮学习内容，并更新知识树。")
      };
    }
  );

  registerAppTool(
    server,
    "refine_knowledge_map",
    {
      title: "Refine Knowledge Map",
      description:
        "Use this when you want to auto-refine, merge, split, or reparent nodes inside the knowledge map.",
      inputSchema: refineMapSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在整理知识树…",
        "openai/toolInvocation/invoked": "知识树已更新"
      }
    },
    async (args) => {
      const result = await refineKnowledgeMap(args);
      return {
        structuredContent: toStructuredContent(result),
        content: buildToolResultContent(`已根据动作「${args.action}」更新知识树。`)
      };
    }
  );

  registerAppTool(
    server,
    "export_xmind_file",
    {
      title: "Export XMind File",
      description:
        "Use this when you want to export the current topic's knowledge map as a real XMind file.",
      inputSchema: exportXmindSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在导出 XMind…",
        "openai/toolInvocation/invoked": "XMind 已导出"
      }
    },
    async (args) => {
      const result = await exportXmindFileWorkspace(args);
      return {
        structuredContent: toStructuredContent(result),
        content: buildToolResultContent(`已导出 XMind 文件：${result.exportStatus.filename}`)
      };
    }
  );

  registerAppTool(
    server,
    "open_marketplace_workspace",
    {
      title: "Open Marketplace Workspace",
      description:
        "Use this when you want to open the internal talent marketplace dashboard for job matching, talent matching, and review decisions.",
      inputSchema: openMarketplaceWorkspaceSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI
        },
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "正在准备内部人才市场工作台…",
        "openai/toolInvocation/invoked": "内部人才市场工作台已就绪"
      }
    },
    async (args) => {
      const workspace = await openMarketplaceWorkspace(args);
      return {
        structuredContent: toStructuredContent(workspace),
        content: buildToolResultContent("已打开 AI 内部人才市场工作台。")
      };
    }
  );

  registerAppTool(
    server,
    "normalize_job_profile",
    {
      title: "Normalize Job Profile",
      description:
        "Use this when a raw internal job request should be turned into a structured job profile for downstream matching.",
      inputSchema: normalizeJobProfileSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在标准化岗位画像…",
        "openai/toolInvocation/invoked": "岗位画像已标准化"
      }
    },
    async (args) => {
      const result = await normalizeJobProfile(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已生成岗位画像，并刷新人才市场推荐。")
      };
    }
  );

  registerAppTool(
    server,
    "normalize_employee_profile",
    {
      title: "Normalize Employee Profile",
      description:
        "Use this when a raw employee summary should be turned into a structured talent profile for internal mobility matching.",
      inputSchema: normalizeEmployeeProfileSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在标准化人才画像…",
        "openai/toolInvocation/invoked": "人才画像已标准化"
      }
    },
    async (args) => {
      const result = await normalizeEmployeeProfile(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已生成人才画像，并刷新人岗匹配结果。")
      };
    }
  );

  registerAppTool(
    server,
    "match_by_job",
    {
      title: "Match By Job",
      description:
        "Use this when you want to recommend internal employees for a given job profile.",
      inputSchema: matchByJobSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在为岗位匹配内部人选…",
        "openai/toolInvocation/invoked": "岗位匹配结果已生成"
      }
    },
    async (args) => {
      const result = await matchByJob(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已生成该岗位的内部人才推荐。")
      };
    }
  );

  registerAppTool(
    server,
    "match_by_employee",
    {
      title: "Match By Employee",
      description:
        "Use this when you want to recommend internal jobs for a given employee profile.",
      inputSchema: matchByEmployeeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在为人才匹配内部岗位…",
        "openai/toolInvocation/invoked": "人才匹配结果已生成"
      }
    },
    async (args) => {
      const result = await matchByEmployee(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已生成该员工的内部岗位推荐。")
      };
    }
  );

  registerAppTool(
    server,
    "review_match",
    {
      title: "Review Match",
      description:
        "Use this when HR or the business owner wants to approve, hold, or reject a match suggestion and keep a review trail.",
      inputSchema: reviewMatchSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在记录人工判断…",
        "openai/toolInvocation/invoked": "人工判断已记录"
      }
    },
    async (args) => {
      const result = await reviewMatch(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已记录本次人岗匹配的人工判断。")
      };
    }
  );

  registerAppTool(
    server,
    "open_role_profile_workspace",
    {
      title: "Open Role Profile Workspace",
      description:
        "Use this when you want to open or refresh the job requirement clarification workspace for role profiling, search strategy, and screening alignment.",
      inputSchema: openRoleProfileWorkspaceSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI
        },
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "正在准备岗位画像工作台…",
        "openai/toolInvocation/invoked": "岗位画像工作台已就绪"
      }
    },
    async (args) => {
      const workspace = await openRoleProfileWorkspace(args);
      return {
        structuredContent: toStructuredContent(workspace),
        content: buildToolResultContent("已打开岗位画像工作台。")
      };
    }
  );

  registerAppTool(
    server,
    "create_role_profile_draft",
    {
      title: "Create Role Profile Draft",
      description:
        "Use this when HR provides an initial fuzzy hiring requirement and it should become a structured role-profile draft.",
      inputSchema: createRoleProfileDraftSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在创建岗位画像草稿…",
        "openai/toolInvocation/invoked": "岗位画像草稿已创建"
      }
    },
    async (args) => {
      const workspace = await createRoleProfileDraft(args);
      return {
        structuredContent: toStructuredContent(workspace),
        content: buildToolResultContent(`已创建岗位画像草稿「${workspace.draft?.targetRole ?? "未命名岗位"}」。`)
      };
    }
  );

  registerAppTool(
    server,
    "answer_role_profile_question",
    {
      title: "Answer Role Profile Question",
      description:
        "Use this when a clarification answer should be written back into the role profile draft and the profile should be refreshed.",
      inputSchema: answerRoleProfileQuestionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在更新岗位画像…",
        "openai/toolInvocation/invoked": "岗位画像已更新"
      }
    },
    async (args) => {
      const result = await answerRoleProfileQuestion(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已记录本轮澄清，并刷新岗位画像。")
      };
    }
  );

  registerAppTool(
    server,
    "finalize_role_profile",
    {
      title: "Finalize Role Profile",
      description:
        "Use this when the clarified role profile should be finalized into a reusable role card, search strategy, and screening guide.",
      inputSchema: finalizeRoleProfileSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"]
        },
        "openai/toolInvocation/invoking": "正在生成标准岗位画像…",
        "openai/toolInvocation/invoked": "标准岗位画像已生成"
      }
    },
    async (args) => {
      const result = await finalizeRoleProfile(args);
      return {
        structuredContent: toStructuredContent(result.workspace),
        content: buildToolResultContent("已生成可供下游搜索与筛选复用的岗位画像。")
      };
    }
  );

  return server;
}

async function main() {
  await ensureBaseDirectories();
  await ensureJournalDirectories();
  await ensureRoleProfileDirectories();
  await ensureMarketplaceDirectories();
  const app = createMcpExpressApp({ host: APP_HOST });
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/workspace", async (req, res) => {
    try {
      const input = z.object(openWorkspaceSchema).parse(req.body ?? {});
      res.json(await openLearningWorkspace(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/topics", async (req, res) => {
    try {
      const input = z.object(createTopicSchema).parse(req.body ?? {});
      res.json(await createLearningTopicWorkspace(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/turns", async (req, res) => {
    try {
      const input = z.object(recordTurnSchema).parse(req.body ?? {});
      res.json(await recordLearningTurn(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/refine", async (req, res) => {
    try {
      const input = z.object(refineMapSchema).parse(req.body ?? {});
      res.json(await refineKnowledgeMap(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/export", async (req, res) => {
    try {
      const input = z.object(exportXmindSchema).parse(req.body ?? {});
      res.json(await exportXmindFileWorkspace(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/role-profile/workspace", async (req, res) => {
    try {
      const input = z.object(openRoleProfileWorkspaceSchema).parse(req.body ?? {});
      res.json(await openRoleProfileWorkspace(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/role-profile/drafts", async (req, res) => {
    try {
      const input = z.object(createRoleProfileDraftSchema).parse(req.body ?? {});
      res.json(await createRoleProfileDraft(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/role-profile/answer", async (req, res) => {
    try {
      const input = z.object(answerRoleProfileQuestionSchema).parse(req.body ?? {});
      res.json(await answerRoleProfileQuestion(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/role-profile/finalize", async (req, res) => {
    try {
      const input = z.object(finalizeRoleProfileSchema).parse(req.body ?? {});
      res.json(await finalizeRoleProfile(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get("/api/dashboard/marketplace", async (req, res) => {
    try {
      const query = z.object(openMarketplaceWorkspaceSchema).parse(req.query);
      res.json(await openMarketplaceWorkspace(query));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/job-profile/normalize", async (req, res) => {
    try {
      const input = z.object(normalizeJobProfileSchema).parse(req.body ?? {});
      res.json(await normalizeJobProfile(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/employee-profile/normalize", async (req, res) => {
    try {
      const input = z.object(normalizeEmployeeProfileSchema).parse(req.body ?? {});
      res.json(await normalizeEmployeeProfile(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/match/by-job", async (req, res) => {
    try {
      const input = z.object(matchByJobSchema).parse(req.body ?? {});
      res.json(await matchByJob(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/match/by-employee", async (req, res) => {
    try {
      const input = z.object(matchByEmployeeSchema).parse(req.body ?? {});
      res.json(await matchByEmployee(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/match/review", async (req, res) => {
    try {
      const input = z.object(reviewMatchSchema).parse(req.body ?? {});
      res.json(await reviewMatch(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.get("/api/journal/day", async (req, res) => {
    try {
      const query = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        })
        .parse(req.query);
      res.json(await listJournalDay(query.date));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/api/journal/entries", async (req, res) => {
    try {
      const input = z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          type: z.enum(["event", "problem", "emotion", "highlight", "idea", "todo", "free"]),
          content: z.string().min(1),
          note: z.string().optional(),
          source: z.enum(["manual", "voice"]).optional()
        })
        .parse(req.body ?? {});
      res.json(await createJournalEntry(input));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post("/mcp", async (req, res) => {
    const server = createServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.use("/preview", express.static(WEB_DIST_DIR));
  app.get(/^\/preview(?:\/.*)?$/, (req, res, next) => {
    if (req.path.startsWith("/preview/assets/")) {
      next();
      return;
    }
    res.sendFile(path.join(WEB_DIST_DIR, "index.html"));
  });

  app.get("/", (_req, res) => {
    res.redirect("/preview/");
  });

  app.get("/capture", (_req, res) => {
    res.redirect("/preview/?app=capture");
  });

  app.get("/marketplace", (_req, res) => {
    res.redirect("/preview/?app=marketplace");
  });

  app.listen(APP_PORT, APP_HOST, () => {
    console.log(`Learning workspace server listening on http://${APP_HOST}:${APP_PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
