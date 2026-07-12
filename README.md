# ai-research-hub — 研报站

本地运行的精致研报阅读站 + 单篇 AI 问答(带溯源回链)。上传 markdown 研报,站点排版成好读的文章,旁边挂一个针对当前这篇的 AI 问答,答案里的来源可点击跳回原文对应章节并高亮。

## 技术栈

- 后端:Fastify + TypeScript(tsx)+ better-sqlite3 + ChromaDB
- 前端:React 19 + Vite + react-router + react-markdown + rehype-slug
- AI:智谱 GLM(生成)+ embedding-3(向量);单一 `ZHIPU_API_KEY`
- 脚手架来源:自有项目 docmind 的叶子服务(LLM 流式 / embedding / 向量检索)

## 快速开始

```bash
pnpm install
cp packages/server/.env.example packages/server/.env   # 填入 ZHIPU_API_KEY
docker compose -f docker-compose.dev.yml up chroma -d   # 启动 ChromaDB(端口 8000)
pnpm dev:server   # http://localhost:3001
pnpm dev:client   # http://localhost:5173
```

打开 http://localhost:5173,点右上角上传一篇 `.md` 研报即可阅读 + 提问。

## 功能

- [x] 上传 markdown 研报,按标题分块索引(章节 slug/path/offset)
- [x] 报告流首页(最新在前)
- [x] 精致阅读页:章节目录 TOC + 表格 / 大师语录块 / ASCII 走势图渲染
- [x] 单篇 RAG 流式问答(SSE),严格基于当前报告作答
- [x] 溯源回链:答案标注来源章节,点击跳回原文并高亮
- [x] Trace 可观测:每次问答一棵 span 树(检索距离 / prompt / 各阶段耗时 / degraded·error),`/traces` 可视化 waterfall
- [ ] 全库问答 / 上线部署(后续)

## Trace / 可观测

每次 `/chat/stream` 问答会记录一棵 span 树到 SQLite,首页右上角 "🔍 trace" → `/traces` 看列表与 waterfall 详情:`doc_retrieval`(命中块及 cosine 距离)、`prompt_assembly`、`llm_generation`(首字延迟 ttfb / 输出 token)。开关:

- `TRACING=off` — 整体关闭 trace(不落库)
- `TRACE_CONTENT=off` — 只记结构与 metadata,不记 prompt / 检索正文(投研内容敏感时用)

## 检索调参

研报章节长、问题宽,`RAG_MAX_K` 默认设为 10(纯默认 5 会漏掉排在第 6~9 位的关键节)。可通过环境变量调整:

- `RAG_MAX_K` — 单篇检索返回块数上限(默认 10)
- `RAG_DISTANCE_THRESHOLD` — cosine 距离阈值(默认 0.7)
- `LOG_RETRIEVAL=1` — 打印每次检索的候选距离,便于调参
- `LOG_LLM=1`(或 `=full`)— 打印真正发给 LLM 的完整 prompt

## 测试

```bash
pnpm test        # 后端 markdownParser/documentStore 单测 + 前端 toc 单测
pnpm typecheck   # 后端 + 前端类型检查
```

设计文档与实现计划见 `docs/superpowers/`。
