import fs from "node:fs/promises";
import path from "node:path";
import { WEB_DIST_DIR } from "./config.js";

async function loadBuiltIndex(): Promise<string> {
  return fs.readFile(path.join(WEB_DIST_DIR, "index.html"), "utf8");
}

function extractAssetPaths(html: string, tagPattern: RegExp): string[] {
  return [...html.matchAll(tagPattern)]
    .map((match) => match[1])
    .filter(Boolean);
}

async function loadAsset(assetPath: string): Promise<string> {
  const relative = assetPath.replace(/^\/preview\//, "");
  return fs.readFile(path.join(WEB_DIST_DIR, relative), "utf8");
}

export async function renderWidgetHtml(): Promise<string> {
  try {
    const indexHtml = await loadBuiltIndex();
    const scriptPaths = extractAssetPaths(indexHtml, /<script[^>]*src="([^"]+)"/g);
    const stylePaths = extractAssetPaths(indexHtml, /<link[^>]*href="([^"]+\.css)"/g);
    const [scripts, styles] = await Promise.all([
      Promise.all(scriptPaths.map((item) => loadAsset(item))),
      Promise.all(stylePaths.map((item) => loadAsset(item)))
    ]);

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script>window.__LEARNING_APP_MODE__ = "widget";</script>
    ${styles.map((style) => `<style>${style}</style>`).join("\n")}
  </head>
  <body>
    <div id="root"></div>
    ${scripts.map((script) => `<script type="module">${script}</script>`).join("\n")}
  </body>
</html>`;
  } catch {
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { font-family: sans-serif; padding: 24px; background: #faf7ef; color: #1f2937; }
      .card { max-width: 560px; margin: 48px auto; padding: 24px; border-radius: 18px; background: white; box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08); }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Learning Workspace 未构建</h1>
      <p>先运行 <code>npm run build:web</code>，再刷新当前 ChatGPT App。</p>
    </div>
  </body>
</html>`;
  }
}

