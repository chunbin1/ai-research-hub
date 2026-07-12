# 研报站 Trace 系统设计文档

> 日期:2026-07-12
> 状态:设计已确认,待写实现计划
> 来源:移植自 `~/myCode/docmind` 的自研 trace 系统(用户已有代码)

## 1. 目标

给研报站补上**每请求的 span 树 trace**,让问答链路出问题时能定位到具体阶段:检索命中了哪些块及 cosine 距离、注入 LLM 的 prompt 是什么、各阶段耗时、哪一步 degraded / error。等价于 docmind 的 trace 系统,外加研报站独有的"检索距离"埋点。

**为什么自研而非第三方(Langfuse/Helicone 等)**:① 本地个人 + 投研内容敏感,不希望 prompt/正文上云;② docmind 自研 trace 代码用户已拥有,零新增外部依赖、单 SQLite;③ 已内置"检索命中块 + 距离"这类通用工具给不了的定制信号。

## 2. 范围

移植 docmind trace 系统全量(后端 span 落库 + `/traces` 可视化 waterfall 页面),适配研报站的无登录、单文档管线。

### 非目标
- 不接入任何第三方可观测服务。
- 不做告警 / 采样 / 保留策略(首版全量落库,后续再说)。
- 不改动现有 `LOG_LLM` / `LOG_RETRIEVAL` 日志开关(与 trace 并存)。

## 3. 后端

### 3.1 移植(逐字为主)
- **`services/tracing.ts`**:空壳 no-op → docmind 完整版。AsyncLocalStorage 每请求 `Tracer`;导出 `runInTrace`、`withSpan`、`spanInput`、`spanOutput`、`spanMeta`、`markDegraded`、`appendSpanLate`、`currentTraceId`、`rollupStatus`、`truncate`。开关:`TRACING`(默认开,`=off` 关)、`TRACE_CONTENT`(默认开,`=off` 只记结构不记正文)。唯一依赖 `traceStore`。
- **`services/traceStore.ts`**(新增):逐字搬,仅把 `import type { DB } from './memoryStore.js'` 改为 `'./db.js'`。两表 `traces` + `trace_spans`(见 docmind DDL),复用现有 SQLite 连接。导出 `initTraceTables`、`saveTrace`、`appendSpan`、`getTrace`、`listTraces`、`traceStats`。
- **`routes/traces.ts`**(新增):搬,**删除 `requireAdmin` 鉴权**(研报站无登录)。三接口:
  - `GET /api/traces?status=&route=&limit=` → `{ traces: TraceRecord[] }`
  - `GET /api/traces/stats?route=` → 汇总统计
  - `GET /api/traces/:id` → `{ trace, spans }`(404 若无)

### 3.2 装配
- `index.ts`:`initTraceTables(db)` + `await app.register(traceRoutes, { prefix: '/api' })`。

### 3.3 埋点(唯一新写部分)——`routes/chat.ts`
把 `/chat/stream` 主体包进 `runInTrace({ route: '/chat/stream', userId: null })`,内部加三个 span:
- **`doc_retrieval`**:`spanInput(message)`;`spanOutput` 为命中块摘要;`spanMeta('kept', n)`、`spanMeta('distances', [...])`(各块 cosine 距离)、`spanMeta('sections', [...])`。
- **`prompt_assembly`**:`spanMeta('finalTokens', 估算)`、`spanMeta('chunkCount', n)`。
- **`llm_generation`**:`spanMeta('provider', PROVIDER)`、`spanMeta('ttfbMs', 首字延迟)`、`spanMeta('outputTokens', 估算)`。
- 检索无命中触发 `markDegraded('doc_retrieval_empty')`;`documentVector` 的 `minK` 降级与 `llm` 的模型 fallback 因 `markDegraded` 变实现而自动记录。
- SSE 流式:trace 在流结束(runInTrace 的 async fn settle)后 flush,不影响流。

## 4. 前端

### 4.1 移植(适配去 auth)
- **`lib/waterfall.ts`** + **`lib/waterfall.test.ts`**:逐字搬。
- 组件:**`TracesPage`**、**`TraceList`**、**`TraceDetailPage`**、**`SpanWaterfall`**、**`TraceStats`**(各 + `.module.css`)。
- **`hooks/useTraces.ts`**。
- 去掉其中对 auth / userId / 登录态的引用(研报站无登录)。

### 4.2 路由与入口
- `App.tsx` 加 `/traces`(→ TracesPage 列表)、`/traces/:id`(→ TraceDetailPage waterfall)。
- 首页 header 加一个入口链接(如右上角"trace")。

## 5. 数据流

```
POST /chat/stream
  runInTrace('/chat/stream')
    ├─ withSpan('doc_retrieval')   → 记 query / 命中块 / 距离 / 保留数
    ├─ withSpan('prompt_assembly') → 记 finalTokens / chunkCount
    └─ withSpan('llm_generation')  → 记 provider / ttfb / outputTokens
  (流结束) flush → SQLite traces + trace_spans

前端  /traces      → 列表(时间/route/状态/耗时/span 数,红=error 黄=degraded)
      /traces/:id  → waterfall(各 span 起止/耗时条 + 点开看 input/output/metadata)
```

## 6. 测试
- 搬 `waterfall.test.ts`(前端 span 布局计算单测)。
- 端到端手测:问一次 → `GET /api/traces` 有记录 → 开 `/traces/:id` 看到 3 个 span、耗时、检索距离 metadata、无 auth 报错。
- `TRACING=off` 时不落库、接口返回空;`TRACE_CONTENT=off` 时 span 无 input/output 正文。

## 7. 里程碑(供实现计划)
1. 后端 traceStore + tracing 全量移植(替换空壳)+ 单测挂原有测试跑通。
2. traces 路由(去 auth)+ index 装配。
3. chat.ts 埋点(3 span + 距离 metadata)。
4. 前端 waterfall.ts + 单测。
5. 前端组件 + useTraces 移植(去 auth)。
6. 路由 + 首页入口。
7. 端到端手测 + 开关验证。
