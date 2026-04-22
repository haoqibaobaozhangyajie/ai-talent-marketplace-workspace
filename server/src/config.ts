import path from "node:path";

export const ROOT_DIR = path.resolve(process.cwd());
export const KNOWLEDGE_BASE_DIR = path.join(ROOT_DIR, "knowledge-base");
export const TOPICS_DIR = path.join(KNOWLEDGE_BASE_DIR, "topics");
export const JOURNAL_DIR = path.join(KNOWLEDGE_BASE_DIR, "journal-capture");
export const ROLE_PROFILE_DIR = path.join(KNOWLEDGE_BASE_DIR, "role-profiles");
export const MARKETPLACE_DIR = path.join(ROOT_DIR, "marketplace-data");
export const WEB_DIST_DIR = path.join(ROOT_DIR, "web", "dist");
export const WIDGET_URI = "ui://learning/workspace.html";
export const APP_PORT = Number(process.env.PORT ?? 3000);
export const APP_HOST = process.env.HOST ?? "127.0.0.1";

export const DEFAULT_GOAL_SUGGESTIONS = [
  "快速建立这个主题的核心知识树",
  "通过一问一答梳理概念、流程和指标",
  "沉淀成适合复盘和复习的导图结构"
];
