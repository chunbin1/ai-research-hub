# ETF 国家队托底监控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `ai-research-hub` 内构建独立的 A 股 18 只宽基 ETF 国家队托底监控模块（后端抓取计算 + 三段盘后幂等定时扫描 + `/etf` 前端看板 + `get_etf_stabilization` 只读 MCP 工具）。

**Architecture:** 后端沿用现有 `better-sqlite3` + Fastify + `node-cron` 分层：新增 `etfClient` 对接东财 K 线 / 基金净值 / 批量实时 `IOPV` 与上交所/深交所规模，由 `etfMonitor/metrics.ts` 纯函数计算放量倍数、溢价率、净申赎与多梯队共振等级，存入独立的三张表（`etf_universe` / `etf_daily_metrics` / `etf_daily_summary`），并由 `etfDailyScan.ts` 在 `Asia/Shanghai` `15:10` / `20:00` / `08:45` 触发同一幂等扫描函数。前端在 `SiteLayout` 下新增 `/etf` 栏目页，复用全站无重图表库的轻量热力时间轴与桌面 Grid / 移动卡片排版。

**Tech Stack:** TypeScript (ESM), Node.js `node:test`, Fastify 5, better-sqlite3, node-cron, Zod, React 19, Vite, Tailwind CSS, Ant Design (`Modal` / `Input` / `Select` / `Popconfirm` / icons), Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-11-18-etf-stabilization-monitor-design.md](../specs/2026-11-18-etf-stabilization-monitor-design.md)

## Global Constraints

- 必须与现有 `/signals`（美港股 SuperTrend）彻底解耦：独立环境变量开关 `ETF_MONITOR=off`、独立 SQLite 表、独立 cron（`Asia/Shanghai`）、不修改 `SIGNALS=off` 行为。
- 外部行情全部走标准 HTTP `fetch`（8 秒超时、温和并发 4–5），不引入 Python 或无头浏览器依赖。
- 预置 18 只宽基 ETF 分 4 个梯队（`mega` / `mid` / `small` / `growth`），首次启动自动建表并种入。
- `vol_ratio_20` 严格要求满前 20 个交易日才计算，不足 20 日必须为 `null`（不回退用前 5–19 日均值）。
- 顶栏「托底」（`/etf`）在 `SiteHeader.tsx` 静态挂载；`seo.ts` 保持 `/etf` 为 `noindex`（不进 `sitemap.xml`）。
- 工作区测试命令为 `pnpm test` 与 `pnpm typecheck`，每次任务结束均应通过相关单测与类型检查。

## Review Focus

- **盘中未收盘保护（`< 15:00 Asia/Shanghai`）**：工作日盘中手动扫描或 `08:45` 补扫时，东财 K 线会返回当日未收盘的 bar，必须过滤不写当日放量指标，同时正确把早盘拿到的开盘前份额归属到上一交易日 `T-1`（pinned in Task 4 `scanner.test.ts`）。
- **深市份额快照防擦除与时间对齐**：`15:10`/`20:00` 扫描不得把尚未结算更新的深市 `f38` 写入当日 `T` 期末份额；日常局部重算时，库里已有的历史 `'snapshot'`/`'sse_history'` 份额若本次未拉到新值，不得被 `null` 覆盖（pinned in Task 2 `etfMonitorStore.test.ts` & Task 4 `scanner.test.ts`）。
- **深市历史缺失下的共振门槛严苛性**：上线前历史交易日仅有沪市份额（`total_net_inflow_yi !== null`），必须严格校验 `total_net_inflow_yi >= 30` 才算 `strong`，不能误落入 `total_net_inflow_yi === null` 的兜底分支（pinned in Task 3 `metrics.test.ts`）。
- **停用 / 改梯队 / 改阈值后历史一致性与恢复入口**：`PATCH /universe/:code` 停用或改梯队后须同步重算历史汇总，`GET /board` 须返回 `disabledUniverse` 供恢复；`PATCH /params` 须同步重算全库历史 `signal_level` 与 `etf_daily_summary`（pinned in Task 4 & Task 5 `etfMonitor.test.ts`）。
- **预热期严格置空与模块关闭隔离**：新 ETF 前 20 个交易日 `vol_ratio_20` 必须为 `null` 且不触发放量信号；`ETF_MONITOR=off` 时接口返回 404 且前端 `/etf` 显示明确关闭提示不崩溃（pinned in Task 3 `metrics.test.ts`、Task 5 `etfMonitor.disabled.test.ts`、Task 7 `EtfMonitorPage.test.tsx`）。

---

### Task 1: ETF 数据源客户端（东财 K 线 / 净值 / 批量实时 IOPV / 上交所与深交所份额）

**Files:**
- Create: `packages/server/src/services/market/etfClient.ts`
- Test: `packages/server/src/services/market/etfClient.test.ts`

**Interfaces:**
- Produces (exported from `packages/server/src/services/market/etfClient.ts`):
  - `export type EtfMarket = 'SH' | 'SZ'`
  - `export interface EtfKlineBar { tradeDate: string; open: number; close: number; high: number; low: number; volume: number; amount: number; pctChange: number | null }`
  - `export interface EtfRealtimeQuote { code: string; name: string; price: number; amount: number; totalShares: number | null; iopv: number | null }`
  - `export interface EtfClientDeps { fetch?: typeof globalThis.fetch }`
  - `export function toSecid(code: string, market: EtfMarket): string`
  - `export function inferEtfMarket(code: string): EtfMarket | null`
  - `export async function fetchEtfKlines(code: string, market: EtfMarket, begYmd: string, endYmd: string, deps?: EtfClientDeps): Promise<{ name: string; bars: EtfKlineBar[] }>`
  - `export async function fetchEtfNavHistory(code: string, pages?: number, pageSize?: number, deps?: EtfClientDeps): Promise<Record<string, number>>`
  - `export async function fetchEtfRealtimeBatch(items: Array<{ code: string; market: EtfMarket }>, deps?: EtfClientDeps): Promise<Record<string, EtfRealtimeQuote>>`
  - `export async function fetchSseDailyShares(statDate: string, deps?: EtfClientDeps): Promise<Record<string, number>>`
  - `export async function fetchSzseLatestShares(code: string, deps?: EtfClientDeps): Promise<{ snapshotDate: string; totalShares: number } | null>`
  - `export async function probeEtfInfo(code: string, deps?: EtfClientDeps): Promise<{ code: string; market: EtfMarket; name: string } | null>`

- [ ] **Step 1: Write the failing test in `packages/server/src/services/market/etfClient.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toSecid, inferEtfMarket, fetchEtfKlines, fetchEtfNavHistory,
  fetchEtfRealtimeBatch, fetchSseDailyShares, fetchSzseLatestShares, probeEtfInfo,
} from './etfClient.js'

test('inferEtfMarket & toSecid 识别沪深 6 位 ETF 代码', () => {
  assert.equal(inferEtfMarket('510300'), 'SH')
  assert.equal(inferEtfMarket('588000'), 'SH')
  assert.equal(inferEtfMarket('563300'), 'SH')
  assert.equal(inferEtfMarket('159952'), 'SZ')
  assert.equal(inferEtfMarket('600519'), null)
  assert.equal(toSecid('510300', 'SH'), '1.510300')
  assert.equal(toSecid('159952', 'SZ'), '0.159952')
})

test('fetchEtfKlines 解析东财日 K 线与涨跌幅', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    data: {
      name: '创业板ETF广发',
      klines: [
        '2026-11-16,1.462,1.418,1.467,1.410,13297982,1904635139.456,3.85,9.39',
        '2026-11-17,1.400,1.399,1.433,1.382,50674399,7120143080.344,3.60,35.77',
      ],
    },
  }))
  const res = await fetchEtfKlines('159952', 'SZ', '20261116', '20261117', { fetch: fakeFetch as never })
  assert.equal(res.name, '创业板ETF广发')
  assert.equal(res.bars.length, 2)
  assert.equal(res.bars[1].tradeDate, '2026-11-17')
  assert.equal(res.bars[1].close, 1.399)
  assert.equal(res.bars[1].amount, 7120143080.344)
  // 东财 volume 单位为手(100份),换算为份数
  assert.equal(res.bars[1].volume, 5067439900)
  assert.ok(Math.abs((res.bars[1].pctChange ?? 0) - ((1.399 - 1.418) / 1.418) * 100) < 0.01)
})

test('fetchEtfNavHistory 携带 Referer 并按页收集 DWJZ', async () => {
  const seenHeaders: unknown[] = []
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    seenHeaders.push(init?.headers)
    return new Response(JSON.stringify({
      Data: { LSJZList: [{ FSRQ: '2026-11-17', DWJZ: '1.4015' }, { FSRQ: '2026-11-16', DWJZ: '1.4185' }] },
    }))
  }
  const nav = await fetchEtfNavHistory('159952', 1, 20, { fetch: fakeFetch as never })
  assert.equal(nav['2026-11-17'], 1.4015)
  assert.equal(nav['2026-11-16'], 1.4185)
  assert.match(JSON.stringify(seenHeaders[0]), /fundf10\.eastmoney\.com/)
})

test('fetchEtfRealtimeBatch 解析 f2 价格、f38 总份额、f441 IOPV', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    data: {
      diff: [
        { f12: '159952', f14: '创业板ETF广发', f2: 1.413, f6: 1643068179.854, f38: 14165584896.0, f441: 1.4137 },
        { f12: '510300', f14: '沪深300ETF华泰柏瑞', f2: 4.051, f6: 2581014438.0, f38: 48343087616.0, f441: 4.0449 },
      ],
    },
  }))
  const map = await fetchEtfRealtimeBatch(
    [{ code: '159952', market: 'SZ' }, { code: '510300', market: 'SH' }],
    { fetch: fakeFetch as never },
  )
  assert.equal(map['159952'].iopv, 1.4137)
  assert.equal(map['159952'].totalShares, 14165584896.0)
  assert.equal(map['510300'].price, 4.051)
})

test('fetchSseDailyShares 把万份转为份 & fetchSzseLatestShares 解析 dqgm', async () => {
  const sseFetch = async () => new Response(JSON.stringify({
    result: [{ SEC_CODE: '510300', TOT_VOL: '4834308.77' }],
  }))
  const sse = await fetchSseDailyShares('2026-11-17', { fetch: sseFetch as never })
  assert.equal(sse['510300'], 48343087700)

  const szseFetch = async () => new Response(JSON.stringify([{
    metadata: { subname: '2026-11-18' },
    data: [{ sys_key: '<a href="..."><u>159952</u></a>', dqgm: '1,416,558.49' }],
  }]))
  const szse = await fetchSzseLatestShares('159952', { fetch: szseFetch as never })
  assert.deepEqual(szse, { snapshotDate: '2026-11-18', totalShares: 14165584900 })
})

test('probeEtfInfo 识别有效 ETF 并拒绝非法代码', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    data: { f57: '510300', f58: '沪深300ETF华泰柏瑞' },
  }))
  assert.deepEqual(await probeEtfInfo('510300', { fetch: fakeFetch as never }), {
    code: '510300', market: 'SH', name: '沪深300ETF华泰柏瑞',
  })
  assert.equal(await probeEtfInfo('600519', { fetch: fakeFetch as never }), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arh/server exec tsx --test src/services/market/etfClient.test.ts`
Expected: FAIL with module not found (`etfClient.js`).

- [ ] **Step 3: Implement `packages/server/src/services/market/etfClient.ts`**

Implement all exported types and functions using native `fetch` with `AbortSignal.timeout(8000)` (or injected `deps.fetch`), matching the verified Eastmoney / SSE / SZSE URLs and headers from the spec:
- `inferEtfMarket(code)`: matches 6-digit codes; `51xxxx`, `56xxxx`, `58xxxx` -> `'SH'`; `15xxxx` -> `'SZ'`; otherwise `null`.
- `fetchEtfKlines`: parses `data.klines`, converts `vol * 100` (手 -> 份), computes `pctChange` from previous bar's `close` (or `null` for bar 0).
- `fetchEtfNavHistory`: loops pages `1..pages`, stops early if `LSJZList` is empty or shorter than `pageSize`, parses `FSRQ -> Number(DWJZ)` where positive finite.
- `fetchEtfRealtimeBatch`: single request to `ulist.np/get?fltt=2&secids=...&fields=f2,f3,f6,f12,f14,f38,f441`, guards non-numeric `'-'` fields as `null`.
- `fetchSseDailyShares`: returns `{}` if SSE returns empty `result` (holidays/not published yet); parses `TOT_VOL * 10000`.
- `fetchSzseLatestShares`: matches row where `sys_key` contains `code` (exact `<u>${code}</u>`), strips commas from `dqgm` and multiplies by `10000`.
- `probeEtfInfo`: validates `inferEtfMarket(code)`, queries `stock/get?secid=...&fields=f57,f58`, returns `{ code, market, name }` or `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arh/server exec tsx --test src/services/market/etfClient.test.ts`
Expected: PASS (all 6 tests pass).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/market/etfClient.ts packages/server/src/services/market/etfClient.test.ts
git commit -m "feat(etf): add market data client for Eastmoney, SSE, and SZSE ETF endpoints"
```

---

### Task 2: ETF 监控 SQLite 存储与 18 只预置标的池 (`etfMonitorStore.ts`)

**Files:**
- Create: `packages/server/src/services/etfMonitorStore.ts`
- Test: `packages/server/src/services/etfMonitorStore.test.ts`

**Interfaces:**
- Produces (exported from `packages/server/src/services/etfMonitorStore.ts`):
  - `export type EtfTier = 'mega' | 'mid' | 'small' | 'growth'`
  - `export type NavSource = 'official' | 'iopv'`
  - `export type ShareSource = 'sse_history' | 'snapshot'`
  - `export type SignalLevel = 'strong_support' | 'inflow_only' | 'volume_only' | 'normal'`
  - `export type ResonanceLevel = 'strong' | 'watch' | 'none'`
  - `export type DataStage = 'preliminary' | 'nav_ready' | 'partial_shares' | 'complete'`
  - `export interface EtfUniverseEntry { code: string; market: 'SH' | 'SZ'; name: string; tier: EtfTier; enabled: boolean; sort_order: number; created_at: string }`
  - `export interface EtfDailyMetricRow { code: string; trade_date: string; open: number; close: number; pct_change: number | null; volume: number; amount: number; vol_ratio_5: number | null; vol_ratio_20: number | null; nav: number | null; nav_source: NavSource | null; premium_rate: number | null; total_shares: number | null; share_source: ShareSource | null; share_delta: number | null; net_inflow_yi: number | null; signal_level: SignalLevel; updated_at: string }`
  - `export interface EtfDailySummaryRow { trade_date: string; resonance_level: ResonanceLevel; active_count: number; volume_spike_count: number; support_etf_count: number; support_tier_count: number; total_amount_yi: number; aggregate_vol_ratio: number | null; total_net_inflow_yi: number | null; data_stage: DataStage; updated_at: string }`
  - `export const PRESET_ETF_UNIVERSE: ReadonlyArray<Omit<EtfUniverseEntry, 'enabled' | 'created_at'>>` (all 18 ETFs from spec)
  - `export function initEtfMonitorTables(db: DB): void` (creates 3 tables + index `idx_etf_metrics_date` and seeds `PRESET_ETF_UNIVERSE` if `etf_universe` is empty)
  - `export function listUniverse(opts?: { enabledOnly?: boolean }): EtfUniverseEntry[]`
  - `export function getUniverseEntry(code: string): EtfUniverseEntry | null`
  - `export function addUniverseEntry(entry: { code: string; market: 'SH' | 'SZ'; name: string; tier: EtfTier }): EtfUniverseEntry`
  - `export function updateUniverseEntry(code: string, patch: { enabled?: boolean; tier?: EtfTier }): EtfUniverseEntry | null`
  - `export function deleteUniverseEntry(code: string): boolean` (deletes from `etf_universe` and `etf_daily_metrics` in a transaction)
  - `export function getExistingMetricsForCode(code: string): EtfDailyMetricRow[]`
  - `export function upsertDailyMetrics(rows: EtfDailyMetricRow[]): void` (preserves existing `total_shares` & `share_source` when incoming `total_shares === null`, and preserves `'official'` nav over `'iopv'` if incoming `nav === null`)
  - `export function upsertDailySummaries(rows: EtfDailySummaryRow[]): void`
  - `export function deleteSummaryDatesNotIn(validDates: string[]): void`
  - `export function getBoardByDate(tradeDate?: string): { summary: EtfDailySummaryRow | null; metrics: EtfDailyMetricRow[]; availableDates: string[] }`
  - `export function getAllMetricsGroupedByDate(): Map<string, EtfDailyMetricRow[]>`
  - `export function getTimelineSummaries(days: number): EtfDailySummaryRow[]`
  - `export function getCodeHistory(code: string, days: number): EtfDailyMetricRow[]`

- [ ] **Step 1: Write the failing test in `packages/server/src/services/etfMonitorStore.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initEtfMonitorTables, listUniverse, addUniverseEntry, updateUniverseEntry,
  deleteUniverseEntry, upsertDailyMetrics, getExistingMetricsForCode,
  upsertDailySummaries, getBoardByDate, getTimelineSummaries, getCodeHistory,
} from './etfMonitorStore.js'

test('initEtfMonitorTables 首次种入 18 只宽基 ETF 且重复初始化幂等', () => {
  const db = new Database(':memory:')
  initEtfMonitorTables(db)
  assert.equal(listUniverse().length, 18)
  // 再次调用不重复插入也不覆盖用户修改
  updateUniverseEntry('159952', { enabled: false })
  initEtfMonitorTables(db)
  assert.equal(listUniverse().length, 18)
  assert.equal(listUniverse({ enabledOnly: true }).length, 17)
})

test('upsertDailyMetrics 保留已有历史快照 total_shares 不被 null 覆盖', () => {
  const db = new Database(':memory:')
  initEtfMonitorTables(db)
  upsertDailyMetrics([{
    code: '159952', trade_date: '2026-11-17', open: 1.4, close: 1.399, pct_change: -1.3,
    volume: 5e9, amount: 7.12e9, vol_ratio_5: 4.48, vol_ratio_20: 4.1,
    nav: 1.4015, nav_source: 'official', premium_rate: -0.18,
    total_shares: 14165584900, share_source: 'snapshot', share_delta: 1e8, net_inflow_yi: 1.4,
    signal_level: 'volume_only', updated_at: '2026-11-18T00:45:00Z',
  }])
  // 模拟日常重算时新拉取对象里深市该历史日未带出 total_shares
  upsertDailyMetrics([{
    code: '159952', trade_date: '2026-11-17', open: 1.4, close: 1.399, pct_change: -1.3,
    volume: 5e9, amount: 7.12e9, vol_ratio_5: 4.48, vol_ratio_20: 4.1,
    nav: 1.4015, nav_source: 'official', premium_rate: -0.18,
    total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null,
    signal_level: 'volume_only', updated_at: '2026-11-18T07:10:00Z',
  }])
  const saved = getExistingMetricsForCode('159952')
  assert.equal(saved[0].total_shares, 14165584900)
  assert.equal(saved[0].share_source, 'snapshot')
})

test('universe CRUD 与 board / timeline / history 查询', () => {
  const db = new Database(':memory:')
  initEtfMonitorTables(db)
  addUniverseEntry({ code: '510350', market: 'SH', name: '沪深300ETF工银', tier: 'mega' })
  assert.equal(listUniverse().length, 19)

  upsertDailyMetrics([{
    code: '510300', trade_date: '2026-11-17', open: 4.0, close: 4.042, pct_change: -0.5,
    volume: 2e9, amount: 8.115e9, vol_ratio_5: 1.57, vol_ratio_20: 1.6,
    nav: 4.0513, nav_source: 'official', premium_rate: -0.23,
    total_shares: 48343087700, share_source: 'sse_history', share_delta: 1341900000, net_inflow_yi: 54.36,
    signal_level: 'inflow_only', updated_at: '2026-11-18T01:00:00Z',
  }])
  upsertDailySummaries([{
    trade_date: '2026-11-17', resonance_level: 'strong', active_count: 18,
    volume_spike_count: 2, support_etf_count: 5, support_tier_count: 3,
    total_amount_yi: 502.6, aggregate_vol_ratio: 1.45, total_net_inflow_yi: 115.8,
    data_stage: 'partial_shares', updated_at: '2026-11-18T01:00:00Z',
  }])

  const board = getBoardByDate()
  assert.equal(board.summary?.trade_date, '2026-11-17')
  assert.equal(board.metrics.length, 1)
  assert.deepEqual(board.availableDates, ['2026-11-17'])
  assert.equal(getTimelineSummaries(90).length, 1)
  assert.equal(getCodeHistory('510300', 60).length, 1)

  assert.equal(deleteUniverseEntry('510350'), true)
  assert.equal(listUniverse().length, 18)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arh/server exec tsx --test src/services/etfMonitorStore.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `packages/server/src/services/etfMonitorStore.ts`**

Create the module with `PRESET_ETF_UNIVERSE` (exact 18 ETFs from spec), table creation + `idx_etf_metrics_date`, transactional `upsertDailyMetrics` using `COALESCE(excluded.total_shares, etf_daily_metrics.total_shares)` and `CASE WHEN excluded.total_shares IS NOT NULL THEN excluded.share_source ELSE etf_daily_metrics.share_source END` so historical snapshots are never wiped by null updates, and clean query helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arh/server exec tsx --test src/services/etfMonitorStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/etfMonitorStore.ts packages/server/src/services/etfMonitorStore.test.ts
git commit -m "feat(etf): add SQLite store and preset 18 broad ETF universe"
```

---

### Task 3: 指标计算引擎与共振合成 (`metrics.ts`)

**Files:**
- Create: `packages/server/src/services/etfMonitor/metrics.ts`
- Test: `packages/server/src/services/etfMonitor/metrics.test.ts`

**Interfaces:**
- Produces (exported from `packages/server/src/services/etfMonitor/metrics.ts`):
  - `export interface EtfMonitorParams { volRatioThreshold: number; premiumThreshold: number; inflowThresholdYi: number }`
  - `export const DEFAULT_ETF_PARAMS: EtfMonitorParams` (`{ volRatioThreshold: 1.8, premiumThreshold: 0.05, inflowThresholdYi: 5.0 }`)
  - `export interface MergedBarInput { tradeDate: string; open: number; close: number; pctChange: number | null; volume: number; amount: number; nav: number | null; navSource: NavSource | null; totalShares: number | null; shareSource: ShareSource | null }`
  - `export function computeCodeMetrics(code: string, barsAsc: MergedBarInput[], params: EtfMonitorParams, nowIso: string): EtfDailyMetricRow[]`
  - `export function classifySignalLevel(m: { volRatio20: number | null; premiumRate: number | null; netInflowYi: number | null }, params: EtfMonitorParams): SignalLevel`
  - `export function computeDailySummary(tradeDate: string, enabledUniverse: EtfUniverseEntry[], metricsForDate: EtfDailyMetricRow[], prev20AvgAmountTotalYi: number | null, params: EtfMonitorParams, nowIso: string): EtfDailySummaryRow`

- [ ] **Step 1: Write the failing test in `packages/server/src/services/etfMonitor/metrics.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ETF_PARAMS, computeCodeMetrics, computeDailySummary, type MergedBarInput,
} from './metrics.js'
import type { EtfUniverseEntry } from '../etfMonitorStore.js'

function makeBars(count: number, amount = 1e9): MergedBarInput[] {
  return Array.from({ length: count }, (_, i) => ({
    tradeDate: `2026-10-${String(i + 1).padStart(2, '0')}`,
    open: 1, close: 1, pctChange: 0, volume: 1e9, amount,
    nav: 1, navSource: 'official', totalShares: 1e10, shareSource: 'sse_history',
  }))
}

test('前 20 根历史数据不足时 vol_ratio_20 严格为 null（不回退），第 21 根起正常计算', () => {
  const bars = makeBars(21, 10e8)
  bars[10].amount = 50e8 // 第 11 根放 5 倍量，但前 20 根未满
  bars[20].amount = 25e8 // 第 21 根对比前 20 根
  const rows = computeCodeMetrics('510300', bars, DEFAULT_ETF_PARAMS, '2026-11-18T00:00:00Z')
  assert.equal(rows[10].vol_ratio_20, null)
  assert.equal(rows[10].vol_ratio_5, 5)
  assert.equal(rows[10].signal_level, 'normal')
  assert.ok((rows[20].vol_ratio_20 ?? 0) > 2.0)
})

test('2026-11-17 实测样本回归: 510310 强托底 / 510300 净申购 / 159952 孤立放量', () => {
  const universe: EtfUniverseEntry[] = [
    { code: '510300', market: 'SH', name: '沪深300ETF', tier: 'mega', enabled: true, sort_order: 1, created_at: '' },
    { code: '510310', market: 'SH', name: '300ETF易方达', tier: 'mega', enabled: true, sort_order: 2, created_at: '' },
    { code: '510500', market: 'SH', name: '中证500ETF', tier: 'mid', enabled: true, sort_order: 3, created_at: '' },
    { code: '512100', market: 'SH', name: '中证1000ETF', tier: 'small', enabled: true, sort_order: 4, created_at: '' },
    { code: '159915', market: 'SZ', name: '创业板ETF', tier: 'growth', enabled: true, sort_order: 5, created_at: '' },
    { code: '159952', market: 'SZ', name: '创业板广发', tier: 'growth', enabled: true, sort_order: 6, created_at: '' },
  ]
  const metrics = [
    { code: '510300', trade_date: '2026-11-17', open: 4, close: 4.042, pct_change: -0.5, volume: 2e9, amount: 81.15e8, vol_ratio_5: 1.57, vol_ratio_20: 1.57, nav: 4.0513, nav_source: 'official' as const, premium_rate: -0.23, total_shares: 483.43e8, share_source: 'sse_history' as const, share_delta: 1.34e8, net_inflow_yi: 54.4, signal_level: 'inflow_only' as const, updated_at: '' },
    { code: '510310', trade_date: '2026-11-17', open: 3.9, close: 3.936, pct_change: -0.4, volume: 7e8, amount: 29.24e8, vol_ratio_5: 2.85, vol_ratio_20: 2.85, nav: 3.9371, nav_source: 'official' as const, premium_rate: -0.03, total_shares: 265.63e8, share_source: 'sse_history' as const, share_delta: 0.49e8, net_inflow_yi: 19.4, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '510500', trade_date: '2026-11-17', open: 6.3, close: 6.317, pct_change: -0.6, volume: 6e8, amount: 40.94e8, vol_ratio_5: 1.1, vol_ratio_20: 1.1, nav: 6.3192, nav_source: 'official' as const, premium_rate: -0.03, total_shares: 94.58e8, share_source: 'sse_history' as const, share_delta: 0.39e8, net_inflow_yi: 24.4, signal_level: 'inflow_only' as const, updated_at: '' },
    { code: '512100', trade_date: '2026-11-17', open: 2.4, close: 2.473, pct_change: -1.0, volume: 2e9, amount: 50.68e8, vol_ratio_5: 1.09, vol_ratio_20: 1.09, nav: 2.4789, nav_source: 'official' as const, premium_rate: -0.24, total_shares: 179.09e8, share_source: 'sse_history' as const, share_delta: 0.71e8, net_inflow_yi: 17.6, signal_level: 'inflow_only' as const, updated_at: '' },
    { code: '159915', trade_date: '2026-11-17', open: 2.3, close: 2.31, pct_change: -1.2, volume: 4e9, amount: 111.07e8, vol_ratio_5: 1.01, vol_ratio_20: 1.01, nav: 2.3076, nav_source: 'official' as const, premium_rate: 0.10, total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null, signal_level: 'normal' as const, updated_at: '' },
    { code: '159952', trade_date: '2026-11-17', open: 1.4, close: 1.399, pct_change: -1.3, volume: 5e9, amount: 71.20e8, vol_ratio_5: 4.48, vol_ratio_20: 4.48, nav: 1.4015, nav_source: 'official' as const, premium_rate: -0.18, total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null, signal_level: 'volume_only' as const, updated_at: '' },
  ]
  const sum = computeDailySummary('2026-11-17', universe, metrics, 250, DEFAULT_ETF_PARAMS, '2026-11-18T00:00:00Z')
  assert.equal(sum.resonance_level, 'strong')
  assert.equal(sum.support_tier_count, 3)
  assert.equal(sum.support_etf_count, 4)
  assert.equal(sum.volume_spike_count, 2)
  assert.equal(sum.data_stage, 'partial_shares')
})

test('深市历史缺失导致仅有部分份额时（total_net_inflow_yi !== null），若净申购 < 30 亿不得误降级成兜底触发 strong', () => {
  const universe: EtfUniverseEntry[] = [
    { code: '510300', market: 'SH', name: '300', tier: 'mega', enabled: true, sort_order: 1, created_at: '' },
    { code: '510500', market: 'SH', name: '500', tier: 'mid', enabled: true, sort_order: 2, created_at: '' },
    { code: '512100', market: 'SH', name: '1000', tier: 'small', enabled: true, sort_order: 3, created_at: '' },
    { code: '159915', market: 'SZ', name: '创业板', tier: 'growth', enabled: true, sort_order: 4, created_at: '' },
  ]
  const metrics = [
    // 3 只沪市都放量+正溢价(strong_support)，但每只净申购只有 1 亿，总净申购 3 亿 (< 30亿)
    { code: '510300', trade_date: '2026-10-10', open: 4, close: 4.1, pct_change: 1, volume: 1e9, amount: 50e8, vol_ratio_5: 2, vol_ratio_20: 2.1, nav: 4.05, nav_source: 'official' as const, premium_rate: 1.2, total_shares: 1e10, share_source: 'sse_history' as const, share_delta: 2.5e7, net_inflow_yi: 1.0, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '510500', trade_date: '2026-10-10', open: 6, close: 6.1, pct_change: 1, volume: 1e9, amount: 40e8, vol_ratio_5: 2, vol_ratio_20: 2.1, nav: 6.05, nav_source: 'official' as const, premium_rate: 0.8, total_shares: 1e10, share_source: 'sse_history' as const, share_delta: 1.6e7, net_inflow_yi: 1.0, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '512100', trade_date: '2026-10-10', open: 2, close: 2.05, pct_change: 1, volume: 1e9, amount: 30e8, vol_ratio_5: 2, vol_ratio_20: 2.1, nav: 2.02, nav_source: 'official' as const, premium_rate: 1.4, total_shares: 1e10, share_source: 'sse_history' as const, share_delta: 5e7, net_inflow_yi: 1.0, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '159915', trade_date: '2026-10-10', open: 2, close: 2.0, pct_change: 0, volume: 1e9, amount: 20e8, vol_ratio_5: 1, vol_ratio_20: 1.0, nav: 2.0, nav_source: 'official' as const, premium_rate: 0, total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null, signal_level: 'normal' as const, updated_at: '' },
  ]
  const sum = computeDailySummary('2026-10-10', universe, metrics, 100, DEFAULT_ETF_PARAMS, '2026-11-18T00:00:00Z')
  // total_net_inflow_yi = 3.0 (!== null)，不进 null 兜底，只能是 watch
  assert.equal(sum.total_net_inflow_yi, 3)
  assert.equal(sum.resonance_level, 'watch')
  assert.equal(sum.data_stage, 'partial_shares')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arh/server exec tsx --test src/services/etfMonitor/metrics.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `packages/server/src/services/etfMonitor/metrics.ts`**

Implement strictly per spec:
- `computeCodeMetrics`: iterate `barsAsc` once keeping running window of prior `amount` (slice `i - 5..i` and `i - 20..i`); `vol_ratio_20` strictly `null` when `i < 20`; `premium_rate` from `(close - nav) / nav * 100`; `share_delta` when both `barsAsc[i].totalShares !== null` and `barsAsc[i - 1].totalShares !== null`; `net_inflow_yi` = `(share_delta * (nav ?? close)) / 1e8`; call `classifySignalLevel`.
- `computeDailySummary`: filter `metricsForDate` to `enabledUniverse`; count `officialNavCount`, `shareChangeCount`, `support_etf_count`, `support_tier_count`, `volume_spike_count`, `strong_support` count; determine `data_stage` (`preliminary` / `nav_ready` / `partial_shares` / `complete`) and `resonance_level` (`strong` / `watch` / `none`). Note: `total_net_inflow_yi` is rounded to 2 decimals or `null` when `shareChangeCount === 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arh/server exec tsx --test src/services/etfMonitor/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/etfMonitor/metrics.ts packages/server/src/services/etfMonitor/metrics.test.ts
git commit -m "feat(etf): implement volume ratio, premium, net inflow, and resonance metrics engine"
```

---

### Task 4: 扫描编排器、三段定时任务与服务启动接入 (`scanner.ts`, `etfDailyScan.ts`, `index.ts`)

**Files:**
- Create: `packages/server/src/services/etfMonitor/scanner.ts`
- Create: `packages/server/src/jobs/etfDailyScan.ts`
- Modify: `packages/server/src/index.ts:1-60,95-104`
- Test: `packages/server/src/services/etfMonitor/scanner.test.ts`
- Test: `packages/server/src/jobs/etfDailyScan.test.ts`

**Interfaces:**
- Produces from `packages/server/src/services/etfMonitor/scanner.ts`:
  - `export const ETF_LAST_SCAN_KEY = 'etf.last_scan_at'`
  - `export function isEtfMonitorEnabled(): boolean` (`process.env.ETF_MONITOR !== 'off'`)
  - `export function getEtfParams(): EtfMonitorParams`
  - `export function setEtfParams(patch: Partial<EtfMonitorParams>): EtfMonitorParams`
  - `export interface EtfScanSummary { total: number; ok: number; failed: number; latestDate: string | null }`
  - `export interface EtfScanDeps { now?: () => Date; fetchKlines?: typeof fetchEtfKlines; fetchNavs?: typeof fetchEtfNavHistory; fetchRealtimeBatch?: typeof fetchEtfRealtimeBatch; fetchSseShares?: typeof fetchSseDailyShares; fetchSzseShares?: typeof fetchSzseLatestShares; concurrency?: number }`
  - `export function scanEtfMonitor(opts?: { backfillDays?: number; codes?: string[] }, deps?: EtfScanDeps): Promise<EtfScanSummary>`
  - `export function recomputeAllEtfSummaries(nowIso?: string): void`
- Produces from `packages/server/src/jobs/etfDailyScan.ts`:
  - `export const ETF_CRON_EXPRS = ['10 15 * * 1-5', '0 20 * * 1-5', '45 8 * * 1-5'] as const`
  - `export const ETF_TIMEZONE = 'Asia/Shanghai'`
  - `export const ETF_BACKFILL_GATE_MS = 4 * 60 * 60 * 1000`
  - `export function shouldEtfBackfill(lastScanAt: string | null, nowMs: number): boolean`
  - `export function startEtfDailyScan(log: { info: (m: string) => void; error: (m: string) => void }): void`

- [ ] **Step 1: Write failing tests in `scanner.test.ts` and `etfDailyScan.test.ts`**

Write `scanner.test.ts` covering:
1. **盘中保护（`< 15:00 Asia/Shanghai`）与深市 T+1 份额归属**：模拟 `now = 2026-11-18T10:30:00+08:00`（`02:30 UTC`），`fetchKlines` 返回至 `2026-11-18` 的半天 bar，同时 `fetchSzseShares` 返回 `snapshotDate = '2026-11-18'` 与 `totalShares = 14165584900`；断言 `2026-11-18` **没有**被写入 `etf_daily_metrics`，且深市份额被准确归属到上一已收盘交易日 `2026-11-17`。
2. **收盘后（`>= 15:00`）**：`15:10` 仅拿到 `IOPV` 时写入 `nav_source = 'iopv'` 且不把未结算 `f38` 写成当日深市期末份额；`20:00` 官方净值到达后覆写为 `'official'`。
3. **修改阈值 / 停用标的后 `recomputeAllEtfSummaries()`**：修改阈值重新计算已有日期的 `signal_level` 与 `etf_daily_summary`，并保留既有的 `total_shares` 不丢。

Write `etfDailyScan.test.ts` covering:
- `shouldEtfBackfill(null, now)` -> `true`, `< 4h` -> `false`, `>= 4h` -> `true`
- `ETF_CRON_EXPRS` exact 3 schedules and `ETF_TIMEZONE === 'Asia/Shanghai'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arh/server exec tsx --test src/services/etfMonitor/scanner.test.ts src/jobs/etfDailyScan.test.ts`
Expected: FAIL with modules not found.

- [ ] **Step 3: Implement `scanner.ts`, `etfDailyScan.ts`, and wire into `packages/server/src/index.ts`**

Key implementation details in `scanner.ts`:
- Helper `cnDateAndMinutes(now: Date)` using `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', ... })` (works regardless of host TZ): returns `{ ymd: 'YYYY-MM-DD', minutesOfDay: number }`.
- Intraday filter: drop any kline bar where `bar.tradeDate > todayCN` OR (`bar.tradeDate === todayCN && minutesOfDay < 15 * 60`).
- Initial vs incremental window: check if `getExistingMetricsForCode(code)` is empty (or `opts.backfillDays` passed); initial pulls 250 trading days (~380 calendar days) of klines + ~14 pages of `lsjz` + 90 recent trading days from `fetchSseShares`; daily pulls ~45 calendar days klines + 1 page of 20 `lsjz` + 5 recent trading days from `fetchSseShares`.
- Merge with existing stored metrics (`getExistingMetricsForCode`) so older `total_shares` / `share_source` / `official nav` never get erased when partial scans run.
- SZSE T+1 share attribution: for `SZ` ETFs, if `fetchSzseShares` returns `{ snapshotDate, totalShares }` (or `realtimeBatch[code]` has `totalShares` on a date after `latestClosedDate` when `snapshotDate > latestClosedDate`), and `latestClosedDate` exists in the merged bars (`latestClosedDate < snapshotDate`, e.g. `2026-11-17 < 2026-11-18`), write `totalShares` with `shareSource = 'snapshot'` onto `latestClosedDate`. Similarly for `SH` ETFs, prefer `sseSharesByDate[bar.tradeDate]` and fall back to `realtimeBatch[code].totalShares` on `latestClosedDate` ONLY when `todayCN > latestClosedDate` (next day pre-open!).
- Wrap DB writes in `recomputeAllEtfSummaries` using `etf_daily_metrics` + `etf_universe` so `PATCH /params` and `PATCH /universe/:code` run fast locally without network calls.
- In `packages/server/src/index.ts`: call `initEtfMonitorTables(db)` right after `initHoldingsTables(db)`, and call `startEtfDailyScan(app.log)` right after `startDailyScan(app.log)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arh/server exec tsx --test src/services/etfMonitor/scanner.test.ts src/jobs/etfDailyScan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/etfMonitor/scanner.ts packages/server/src/jobs/etfDailyScan.ts packages/server/src/services/etfMonitor/scanner.test.ts packages/server/src/jobs/etfDailyScan.test.ts packages/server/src/index.ts
git commit -m "feat(etf): add idempotent 3-pass scanner, Asia/Shanghai cron jobs, and server startup wiring"
```

---

### Task 5: HTTP 路由、OpenAPI 文档与 MCP 只读工具 (`routes/etfMonitor.ts`, `http.ts`, `mcpServer.ts`)

**Files:**
- Create: `packages/server/src/routes/etfMonitor.ts`
- Modify: `packages/server/src/http.ts:10-35`
- Modify: `packages/server/src/services/mcpServer.ts:1-25,130-170`
- Test: `packages/server/src/routes/etfMonitor.test.ts`
- Test: `packages/server/src/routes/etfMonitor.disabled.test.ts`
- Modify/Test: `packages/server/src/routes/mcp.test.ts`

**Interfaces:**
- Produces from `packages/server/src/routes/etfMonitor.ts`:
  - `export interface EtfMonitorRoutesOptions { scan?: typeof scanEtfMonitor; probe?: typeof probeEtfInfo }`
  - `export const etfMonitorRoutes: FastifyPluginAsync<EtfMonitorRoutesOptions>`
  - Endpoints under `/api`:
    - `GET /etf/board` (`?date=YYYY-MM-DD`) -> `{ summary, rows, disabledUniverse, params, lastScanAt, availableDates }`
    - `GET /etf/timeline` (`?days=90`) -> `{ days: EtfDailySummaryRow[] }`
    - `GET /etf/:code/history` (`?days=60`) -> `{ code, entry, history }`
    - `POST /etf/scan` (Admin, `{ backfillDays?: number }`) -> `{ summary }`
    - `POST /etf/universe` (Admin, `{ code, tier }`) -> `{ entry }` (probes via `probeEtfInfo`, adds, scans that code, recomputes summaries; 400 if invalid code, 409 if already exists)
    - `PATCH /etf/universe/:code` (Admin, `{ enabled?, tier? }`) -> `{ entry }` (recomputes summaries; if `enabled` flipped `false -> true`, scans that code)
    - `DELETE /etf/universe/:code` (Admin) -> `{ ok: true }` (deletes & recomputes summaries)
    - `PATCH /etf/params` (Admin, `{ volRatioThreshold?, premiumThreshold?, inflowThresholdYi? }`) -> `{ params }` (validates bounds, saves, calls `recomputeAllEtfSummaries()`)
- Produces in `packages/server/src/services/mcpServer.ts`:
  - Tool `get_etf_stabilization({ date?, days? })` registered when `isEtfMonitorEnabled()` (returns latest/requested day summary, active/triggered ETFs, all enabled ETFs summary, and recent `days` timeline).

- [ ] **Step 1: Write failing tests in `etfMonitor.test.ts`, `etfMonitor.disabled.test.ts`, and `mcp.test.ts`**

Test:
- Public `GET /api/etf/board`, `GET /api/etf/timeline`, `GET /api/etf/510300/history`;
- Admin `POST /api/etf/universe` (valid + invalid code 400 + duplicate 409), `PATCH /api/etf/universe/:code` (disabling puts entry into `disabledUniverse` and updates `summary.active_count`, re-enabling invokes scan), `DELETE /api/etf/universe/:code`, `PATCH /api/etf/params` (validates positive numbers and updates board/summary);
- Non-admin returns 401/403 on write endpoints;
- `ETF_MONITOR=off` in `etfMonitor.disabled.test.ts` makes all `/api/etf/*` return 404 `{ error: 'etf_monitor_disabled' }`;
- `mcp.test.ts` calls `get_etf_stabilization` and asserts returned JSON structure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arh/server exec tsx --test src/routes/etfMonitor.test.ts src/routes/etfMonitor.disabled.test.ts src/routes/mcp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `routes/etfMonitor.ts`, register in `http.ts`, add `get_etf_stabilization` to `mcpServer.ts`**

Follow `routes/signals.ts` style (`describeRoute` for OpenAPI, `requireAdmin`, Zod or explicit input checks returning `400 { error: 'invalid_input', message }`). Note: `GET /api/etf/board` joins `etf_universe` (`enabled = 1`) with that date's `etf_daily_metrics` (so enabled ETFs without data for an older date still show safely with `metric: null`), and also returns `disabledUniverse` from `listUniverse().filter(u => !u.enabled)`.

- [ ] **Step 4: Run all server tests**

Run: `pnpm --filter @arh/server test && pnpm --filter @arh/server typecheck`
Expected: ALL server tests & typecheck PASS (including existing `seo.test.ts`, `openapi.test.ts`, `signals.test.ts`, `mcp.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/etfMonitor.ts packages/server/src/http.ts packages/server/src/services/mcpServer.ts packages/server/src/routes/etfMonitor.test.ts packages/server/src/routes/etfMonitor.disabled.test.ts packages/server/src/routes/mcp.test.ts
git commit -m "feat(etf): add HTTP routes, OpenAPI docs, and get_etf_stabilization MCP tool"
```

---

### Task 6: 前端类型、API 客户端、Hook 与视图工具 (`types.ts`, `api.ts`, `useEtfMonitor.ts`, `etfView.ts`)

**Files:**
- Modify: `packages/client/src/types.ts`
- Modify: `packages/client/src/api.ts`
- Create: `packages/client/src/hooks/useEtfMonitor.ts`
- Create: `packages/client/src/lib/etfView.ts`
- Test: `packages/client/src/lib/etfView.test.ts`

**Interfaces:**
- Produces in `packages/client/src/types.ts`:
  - `EtfTier`, `EtfSignalLevel`, `EtfResonanceLevel`, `EtfDataStage`, `EtfUniverseEntry`, `EtfBoardRow`, `EtfDailySummary`, `EtfMonitorParams`, `EtfBoardResponse`, `EtfDailyMetric`
- Produces in `packages/client/src/api.ts`:
  - `fetchEtfBoard(date?: string): Promise<EtfBoardResponse>` (throws a typed error with `disabled: true` on 404 `etf_monitor_disabled`)
  - `fetchEtfTimeline(days?: number): Promise<EtfDailySummary[]>`
  - `fetchEtfCodeHistory(code: string, days?: number): Promise<{ code: string; entry: EtfUniverseEntry; history: EtfDailyMetric[] }>`
  - `triggerEtfScan(backfillDays?: number): Promise<{ total: number; ok: number; failed: number; latestDate: string | null }>`
  - `addEtfUniverse(code: string, tier: EtfTier): Promise<EtfUniverseEntry>`
  - `updateEtfUniverse(code: string, patch: { enabled?: boolean; tier?: EtfTier }): Promise<EtfUniverseEntry>`
  - `deleteEtfUniverse(code: string): Promise<void>`
  - `updateEtfParams(patch: Partial<EtfMonitorParams>): Promise<EtfMonitorParams>`
- Produces in `packages/client/src/lib/etfView.ts`:
  - Tier labels (`mega` -> `'超大盘权重'`, `mid` -> `'中盘均衡'`, `small` -> `'小微盘'`, `growth` -> `'双创成长'`), resonance labels/tones, `data_stage` labels, `signal_level` labels, formatting helpers (`formatYi`, `formatRatio`, `formatPremium`, `volBarWidth`, `sortEtfRows`), and filter matching (`'all' | 'active' | EtfTier`).

- [ ] **Step 1: Write failing test in `packages/client/src/lib/etfView.test.ts`**

Test `sortEtfRows` (by `vol_ratio_20`, `premium_rate`, `net_inflow_yi`, `amount`, default tier order), `volBarWidth` clamping (`0%`–`100%` capped at 4x), `formatYi`, `formatPremium`, and label mappings for all 4 `data_stage` and 3 `resonance_level` values.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arh/client test -- src/lib/etfView.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `types.ts`, `api.ts`, `hooks/useEtfMonitor.ts`, and `lib/etfView.ts`**

`useEtfMonitor(selectedDate?: string)` fetches `fetchEtfBoard(selectedDate)` and `fetchEtfTimeline(90)` cleanly without duplicate mount calls, exposes `disabled`, `loading`, `error`, `scanning`, `refresh()`, `selectDate()`, and admin action wrappers (`scan`, `addEtf`, `updateEtf`, `deleteEtf`, `saveParams`).

- [ ] **Step 4: Run client test**

Run: `pnpm --filter @arh/client test -- src/lib/etfView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/types.ts packages/client/src/api.ts packages/client/src/hooks/useEtfMonitor.ts packages/client/src/lib/etfView.ts packages/client/src/lib/etfView.test.ts
git commit -m "feat(etf): add client types, API wrappers, useEtfMonitor hook, and view helpers"
```

---

### Task 7: 前端 `/etf` 看板页面、顶栏导航与全站联调测试 (`EtfMonitorPage.tsx`, `SiteHeader.tsx`, `App.tsx`)

**Files:**
- Create: `packages/client/src/pages/EtfMonitorPage.tsx`
- Modify: `packages/client/src/components/SiteHeader.tsx:27-35`
- Modify: `packages/client/src/App.tsx:21-50`
- Test: `packages/client/src/pages/EtfMonitorPage.test.tsx`

**Interfaces:**
- Consumes: `useEtfMonitor`, `useAuth`, `useIsMobile`, `lib/etfView`, `api.ts`
- Produces: default export `EtfMonitorPage` mounted at `/etf` inside `SiteLayout`; `NAV_ITEMS` includes `{ label: '托底', to: '/etf', adminOnly: false }`.

- [ ] **Step 1: Write failing test in `packages/client/src/pages/EtfMonitorPage.test.tsx`**

Test:
1. 渲染总览卡（共振等级、触发数、梯队数、合计成交额与净申购、数据完整度标签）、近 60/90 天历史时间轴竖条、以及按梯队/排序展示的 18 只数据行（包含 `IOPV` 估算标记）。
2. 点击历史时间轴中的另一天（如 `2026-11-17`）触发对应 `?date=2026-11-17` 刷新。
3. 筛选「仅看异动」和点击行展开最近 15 日历史走势明细。
4. 管理员视图：可见「立即扫描」「参数设置」「管理标的」（含恢复 `disabledUniverse` 中已停用标的的按钮），普通游客不可见。
5. 当接口返回 `404 { error: 'etf_monitor_disabled' }` 时，显示「ETF 托底监控未启用」提示而不报错白屏。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arh/client test -- src/pages/EtfMonitorPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `EtfMonitorPage.tsx`, update `SiteHeader.tsx` and `App.tsx`**

Match `SignalsPage.tsx` visual design tokens (`bg-page`, `border-rule`, `font-numeral`, `text-ink`, `text-ink-faint`, `text-ink-mute`, `bg-white`, responsive CSS grid on `md:`/`lg:`/`xl:` and clean vertical cards on mobile, no horizontal scroll). Keep modals lightweight using Ant Design `Modal` + `Input` + `InputNumber` + `Select` + `Popconfirm`.

- [ ] **Step 4: Run full project tests, typecheck, and client build**

Run: `pnpm test && pnpm typecheck && pnpm build:client`
Expected: ALL server + client tests pass, zero TypeScript errors, client Vite production build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/pages/EtfMonitorPage.tsx packages/client/src/components/SiteHeader.tsx packages/client/src/App.tsx packages/client/src/pages/EtfMonitorPage.test.tsx
git commit -m "feat(etf): add /etf stabilization monitor page and navigation tab"
```
