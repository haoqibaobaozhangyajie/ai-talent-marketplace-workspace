# AI Talent Marketplace Workspace

一个基于 `TypeScript + React + Node` 的多工作台项目，当前包含两条主要能力：

- 学习工作台：系统主动发问、知识树沉淀、XMind 导出
- 内部人才市场工作台：岗位画像、人才画像、人岗双向匹配、人工判断留痕

项目目标是用一套轻量的本地工作台，验证 AI 在企业内部知识沉淀和人才配置场景中的应用方式。

## 开发

```bash
npm install
npm run dev:web
npm run dev:server
```

## 构建

```bash
npm run build
npm start
```

启动后访问：

- `http://127.0.0.1:3000/preview/`：本地网页预览
- `http://127.0.0.1:3000/marketplace`：内部人才市场工作台
- `http://127.0.0.1:3000/mcp`：MCP endpoint

## 内部人才市场能力

内部人才市场工作台当前覆盖：

- 岗位需求标准化：把原始岗位描述转成结构化岗位画像
- 人才画像标准化：把履历、经历与流动意愿整理成统一人才画像
- 岗找人：根据岗位画像推荐内部候选人
- 人找岗：根据员工画像推荐内部岗位
- 匹配解释：输出原因、风险、差距项与建议动作
- 人工判断：支持 HR 或业务记录通过、观察、淘汰等判断

## 目录

- `server/src`：MCP server、预览 API、本地知识库持久化、XMind 导出
- `web/src`：React 工作台界面
- `shared/contracts.ts`：前后端共享数据契约
- `knowledge-base/`：学习工作台运行时数据
- `marketplace-data/`：内部人才市场运行时数据
