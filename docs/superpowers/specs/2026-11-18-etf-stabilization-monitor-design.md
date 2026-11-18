# A股宽基 ETF 国家队托底监控设计

## 意图与背景

监控 A 股「国家队」在下跌或震荡承压期间通过宽基 ETF 托底护盘的行为。单看某一只 ETF 的成交额突然放大容易误判（例如 2026-11-17 `159952` 创业板ETF广发成交额放大到前 5 日均值的 4.48 倍、达 71.20 亿元，但收盘折价 `-0.18%`，同板块更大体量的主力 `159915` 成交额仅 1.01 倍；而同日上交所 `510300`、`510310`、`510330`、`510500`、`512100` 却在份额上录得大额净申购）。

因此需要在 `ai-research-hub` 内建立一套专门的盘后宽基监控系统：同时观察 **18 只跨宽基梯队主力 ETF** 的**二级市场成交额放大倍数**、**收盘相对净值溢价率**以及**每日份额净申赎金额**，并合成为全市场「托底共振状态」与可回溯的历史时间轴。

## 目标 / 非目标 / 反目标

### 目标
- **独立模块与顶栏新栏目**：新增 `/etf` 页面（顶栏名称「托底」），后端服务、SQLite 表、定时调度与现有的美港股 SuperTrend `/signals` 彻底解耦。
- **18 只跨宽基梯队标的池**：预置 18 只主力宽基 ETF（覆盖超大盘权重、中盘、小微盘、双创成长 4 个梯队），支持管理员在页面内增删改标的与调整指标阈值。
- **收盘即看 + 盘后补齐的三段幂等扫描**：
  - `15:10`（北京时间）：收盘后立即算出当天 18 只的成交额放大倍数与基于收盘 `IOPV` 的估算溢价率；
  - `20:00`：补齐基金公司公布的当日官方单位净值（`DWJZ`），更新精确收盘溢价率；
  - 次日 `08:45`（开盘前）：补齐沪深交易所结算后的前一日场内总份额，算出前一日净申购/净赎回资金额。
- **历史回溯与时间轴**：首次启用自动拉取近 250 个交易日（约 1 年）日 K 线与历史官方净值，以及近 90 个交易日的上交所历史份额（与默认 90 天时间轴对齐）；支持在页面点击历史日期查看当天全景明细。
- **只读 MCP 暴露**：新增 `get_etf_stabilization` 工具，供外部 AI 问答引用最新与近期托底状态。

### 非目标
- **不做盘中分钟级盯盘与告警推送**：不轮询盘中分时，不发邮件/飞书/站内消息。
- **不覆盖行业/主题 ETF**：第一版聚焦宽基托底监测，不混入半导体、红利等行业主题 ETF。
- **不强求补全深交所历史份额**：深交所官方列表接口不提供按历史日期参数回溯旧日规模，深市历史交易日仅保留「放量倍数 + 官方净值溢价」，净申赎自系统上线每日快照累计；沪市历史交易日通过上交所日度规模接口一并回溯。
- **不与 `SIGNALS=off` 绑定**：本模块由独立环境变量 `ETF_MONITOR=off` 控制启停。

### 反目标
- **不能把单只折价换手误报成全市场托底**：必须通过「多宽基梯队共振 + 溢价/净申购交叉验证」过滤局部孤立放量。
- **不能卡死到深夜才出当日结果**：必须通过 `15:10` 初算与晚间/早盘覆写补全，既满足收盘第一时间复盘，又保证最终口径严谨。
- **不能在盘中把半天成交额误当成全天放量**：`15:00` 收盘前若触发手动扫描或启动补扫，K 线未收盘的当日（`bar_date === today && now < 15:00`）只记为盘中参考或跳过写入收盘汇总，不污染「收盘放量」统计。

## 方案选择

在脑暴阶段评估了三种落地方式：

1. **方案一（已选）：研报站内建独立模块 + 顶栏新栏目 `/etf`**
   - 独立 SQLite 表、独立 A 股行情/净值/份额抓取客户端、独立 `Asia/Shanghai` 定时任务、独立前端页面与 MCP 工具。
   - **取舍**：工作量属于完整功能模块，但 A 股收盘节奏（15:00）与现有 `/signals`（美港股 UTC 21:30 扫 Yahoo）完全隔离，数据模型干净，历史时间轴与 18 只分组表交互完整。
2. **方案二（已淘汰）：塞进 `/signals` 第二个 Tab**
   - 省掉顶栏一个导航项，但 `/signals` 的 `SIGNALS=off` 开关、SuperTrend 状态语义、扫描时间都会和 A 股宽基监控互相牵制。
3. **方案三（已淘汰）：每日后端脚本生成一篇 Markdown 报告发到首页研报流**
   - 开发量最小，但每天发报告会刷乱研报阅读流，且没有交互式日期回溯、排序与参数配置能力。

## 数据源（均已实测验证）

所有外部请求设置超时（建议 8s）与温和并发（并发度 4–5），全部走标准 HTTP `fetch`，不依赖额外 Python/无头浏览器。

| 数据项 | 接口 | 关键参数与字段 | 已实测说明 |
|---|---|---|---|
| 日 K 线（成交额/量/价） | `GET https://push2his.eastmoney.com/api/qt/stock/kline/get` | `secid=1.{code}`（沪）或 `0.{code}`（深），`klt=101&fqt=0`，`fields2=f51,f52,f53,f54,f55,f56,f57,f58,f61` | 返回 `date,open,close,high,low,vol,amount,...`；历史不复权价与净值同口径 |
| 基金官方历史净值 | `GET https://api.fund.eastmoney.com/f10/lsjz` | `fundCode={code}&pageIndex=1&pageSize=20`（分页拉近 1 年）+ `Referer: https://fundf10.eastmoney.com/` | 返回 `Data.LSJZList[]`：`FSRQ`（日期）、`DWJZ`（当日官方单位净值） |
| 实时收盘价与 `IOPV` / 最新份额 | `GET https://push2.eastmoney.com/api/qt/ulist.np/get` | `fltt=2&secids=...&fields=f2,f3,f6,f12,f14,f38,f441` | 单次请求可批量拉 18 只；`f2` 最新价，`f6` 当日成交额，`f38` 场内总份额（股/份），`f441` 实时 `IOPV` |
| 上交所每日 ETF 规模（含历史） | `GET https://query.sse.com.cn/commonQuery.do` | `sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L&STAT_DATE=YYYY-MM-DD&pageHelp.pageSize=1000` + `Referer: https://www.sse.com.cn/` | `SEC_CODE`、`TOT_VOL`（万份）；支持查询任意历史交易日，当天净申购在当晚/次晨生效 |
| 深交所最新 ETF 规模 | `GET https://www.szse.cn/api/report/ShowReport/data` | `SHOWTYPE=JSON&CATALOGID=1945&TABKEY=tab1&txtQueryKeyAndJC={code}` + `Referer: https://www.szse.cn/` | 返回 `metadata.subname`（快照日期）与 `dqgm`（万份），实测与 `ulist.np` `f38` 一致 |

### 沪深份额日期对齐规则（重要）

实测发现两市披露时间差：
- **上交所 `STAT_DATE = T`**：在 T 日晚间或次日凌晨公布，表示 **T 日收盘并计入 T 日净申赎后的期末总份额**。
- **深交所 `1945` 与东方财富 `ulist.np` `f38`**：在 `T+1` 日开盘前（如 `2026-11-18` 盘前/盘中）显示 `subname = T+1`，实际反映的是 **T 日收盘结算完成后的最新总份额**（即包含 T 日申赎变动）；而在 T 日当天 `15:10` / `20:00` 读到的 `f38` 仍是 `T-1` 日期末份额。

因此写入 `etf_daily_metrics.total_shares` 时严格按交易所对齐：
- **沪市 ETF（`51xxxx` / `56xxxx` / `58xxxx`）**：优先用上交所 `STAT_DATE = T` 的 `TOT_VOL * 10000` 写入交易日 `T`；次日 `08:45` 补扫时亦可取 `T+1` 开盘前 `ulist.np` `f38` 交叉兜底（仅当该交易日上交所接口未返回时）。
- **深市 ETF（`15xxxx`）**：在 `T+1` 日开盘前（`08:45` 或 `T+1` 任意时刻已知最新前收盘份额时），将深交所当日 `subname = T+1`（或 `ulist.np` `f38`）的份额归属写入**上一个已收盘交易日 `T`**；在 `T` 日当天的 `15:10` / `20:00` 扫描中，不把当日尚未更新的 `f38` 当作 `T` 日期末份额，保持 `share_delta = null`（页面标注「份额待次日开盘前确认」）。

## 预置 18 只宽基 ETF 池

初始化数据库时若 `etf_universe` 为空，自动种入以下 18 只（支持管理员后续增删或停用）：

| 梯队 (`tier`) | 代码 | 名称 | 市场 | 备注 |
|---|---|---|---|---|
| `mega`（超大盘权重） | `510050` | 上证50ETF华夏 | `SH` | 上证50 绝对主力 |
| `mega`（超大盘权重） | `510300` | 沪深300ETF华泰柏瑞 | `SH` | 规模最大 300ETF |
| `mega`（超大盘权重） | `510310` | 沪深300ETF易方达 | `SH` | 国家队常用 300 通道 |
| `mega`（超大盘权重） | `510330` | 沪深300ETF华夏 | `SH` | 国家队常用 300 通道 |
| `mega`（超大盘权重） | `159919` | 沪深300ETF嘉实 | `SZ` | 深市主力 300ETF |
| `mega`（超大盘权重） | `512050` | A500ETF华夏 | `SH` | 中证 A500 代表 |
| `mid`（中盘均衡） | `510500` | 中证500ETF南方 | `SH` | 500 主力 |
| `mid`（中盘均衡） | `512500` | 中证500ETF华夏 | `SH` | 500 补充 |
| `small`（小微盘） | `512100` | 中证1000ETF南方 | `SH` | 1000 绝对主力 |
| `small`（小微盘） | `159845` | 中证1000ETF华夏 | `SZ` | 深市 1000 主力 |
| `small`（小微盘） | `560010` | 中证1000ETF广发 | `SH` | 1000 补充 |
| `small`（小微盘） | `159629` | 中证1000ETF富国 | `SZ` | 1000 补充 |
| `small`（小微盘） | `563300` | 中证2000ETF华泰柏瑞 | `SH` | 小微盘温度计 |
| `growth`（双创成长） | `159915` | 创业板ETF易方达 | `SZ` | 创业板绝对主力 |
| `growth`（双创成长） | `159952` | 创业板ETF广发 | `SZ` | 创业板重点 |
| `growth`（双创成长） | `159977` | 创业板ETF天弘 | `SZ` | 创业板补充 |
| `growth`（双创成长） | `588000` | 科创50ETF华夏 | `SH` | 科创50 绝对主力 |
| `growth`（双创成长） | `588080` | 科创50ETF易方达 | `SH` | 科创50 补充 |

## 核心指标与共振规则（设计者默认方案，参数可调）

### 1. 单只 ETF 日度指标
对每只启用中的 ETF，按交易日升序计算：
- **成交额 5 日均值 / 20 日均值（不含当日）**：
  - `vol_ratio_5 = amount / avg(prev 5 days amount)`（至少前 5 日有数据，不足置 `null`）
  - `vol_ratio_20 = amount / avg(prev 20 days amount)`（严格要求满前 20 日有数据，不足 20 日时置 `null`，不回退用少于 20 日均值兜底，避免新上市 ETF 早期误触发放量）
- **收盘溢价率 (`premium_rate`, %)**：
  - 优先使用当日官方单位净值 `DWJZ`：`((close - nav) / nav) * 100`，`nav_source = 'official'`；
  - 若当日为最新交易日且官方 `DWJZ` 尚未发布（例如 `15:10` 刚收盘），且能拿到当日 `IOPV`（`f441 > 0`），用 `((close - iopv) / iopv) * 100` 写入并标记 `nav_source = 'iopv'`；
  - 两者都暂缺时 `premium_rate = null`，`nav_source = null`。
- **份额净变化与净申购金额**：
  - 当交易日 `T` 与上一交易日 `T-1` 均有 `total_shares` 时：
    - `share_delta = total_shares[T] - total_shares[T-1]`（份）
    - `net_inflow_yi = (share_delta * (nav ?? close)) / 1e8`（亿元）

### 2. 可调阈值（存于 `site_settings`）
- `etf.vol_ratio_threshold`：默认 `1.8`（相对 20 日均额放量倍数阈值）
- `etf.premium_threshold`：默认 `0.05`（正溢价判定阈值，单位 `%`）
- `etf.inflow_threshold_yi`：默认 `5.0`（单只显著净申购门槛，单位 `亿元`）

### 3. 单只当日状态标签 (`signal_level`)
- `strong_support`（强托底）：`vol_ratio_20 >= vol_ratio_threshold` **且**（`premium_rate >= premium_threshold` **或** `net_inflow_yi >= inflow_threshold_yi`）
- `inflow_only`（静默净申购）：未达放量阈值，但 `net_inflow_yi >= inflow_threshold_yi`（典型如 2026-11-17 的 `510500`、`512100`，场内仅 1.1x 量但份额大增 ~20 亿）
- `volume_only`（放量待观察）：`vol_ratio_20 >= vol_ratio_threshold`，但暂未出现正溢价也未见显著净申购（例如 2026-11-17 的 `159952`，提示关注是局部换手还是护盘）
- `normal`（常规）：其余情况

### 4. 全市场「托底共振状态」(`etf_daily_summary`)
按日汇总所有已启用 ETF：
- 统计当日：
  - `active_count`：有效标的数量
  - `volume_spike_count`：放量达标只数
  - `support_etf_count`：触发 `strong_support` 或 `inflow_only` 的只数
  - `support_tier_count`：触发 `strong_support` 或 `inflow_only` 覆盖到的不同 `tier` 数（0–4）
  - `total_amount_yi`：当日合计成交额（亿元）与相对 20 日均额总体倍数 `aggregate_vol_ratio`
  - `total_net_inflow_yi`：当日已知份额变动的 ETF 合计净申购估算（亿元；当且仅当没有任何一只启用 ETF 有当日份额变动时为 `null`）
  - `data_stage`：四档状态，按完整度递增：
    - `'preliminary'`：官方净值尚未齐备（获得 `'official'` 净值的启用 ETF 比例 `< 80%`，如 `15:10` 初扫）；
    - `'nav_ready'`：官方净值已齐（`>= 80%`），但 `total_net_inflow_yi === null`（尚未拿齐当日或次晨份额）；
    - `'partial_shares'`：官方净值已齐且已有部分市场份额变动（`total_net_inflow_yi !== null`，但非全部启用 ETF 都有份额变动，典型如系统上线前仅有沪市份额的历史交易日）；
    - `'complete'`：官方净值已齐（`>= 80%`）且所有启用 ETF 当日份额变动均齐。
- **市场共振等级 (`resonance_level`)**：
  - `strong`（强托底共振）：满足以下任一条件：
    1. `support_tier_count >= 2` 且 `support_etf_count >= 3` 且（`total_net_inflow_yi >= 30` 或 **完全无份额数据时** `total_net_inflow_yi === null && strong_support >= 2`）；只要已有任意份额流入数据（`total_net_inflow_yi !== null`，例如历史日有 12 只沪市 ETF 份额），就严格校验 `total_net_inflow_yi >= 30`，避免深市历史缺失导致历史日期全部跳过资金净申购门槛；
    2. `total_net_inflow_yi >= 50`（大额真金白银净申购）。
  - `watch`（局部托底/异动关注）：未达 `strong`，但满足以下任一条件：
    1. `support_etf_count >= 1` 或 `total_net_inflow_yi >= 10`；
    2. `volume_spike_count >= 2`（多只同时放量异动）。
  - `none`（常规波动）：其余情况。

> 以 2026-11-17 实测数据按上述默认阈值验证：`510310` 为 `strong_support`（2.85x + 19.4亿净申购），`510300` / `510330` / `510500` / `512100` 为 `inflow_only`，`159952` 为 `volume_only`；覆盖 `mega`、`mid`、`small` **3 个梯队**、合计净申购超 **115 亿**，会准确判定为 **`strong`（强托底共振）**，且明确区分出 `159952` 只是 `volume_only` 局部放量而非全创业板共振。

## 架构与数据流

### SQLite 表结构（`packages/server/src/services/etfMonitorStore.ts`）

```sql
CREATE TABLE IF NOT EXISTS etf_universe (
  code        TEXT PRIMARY KEY,          -- 6位代码如 510300
  market      TEXT NOT NULL,             -- 'SH' | 'SZ'
  name        TEXT NOT NULL,
  tier        TEXT NOT NULL,             -- 'mega' | 'mid' | 'small' | 'growth'
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etf_daily_metrics (
  code               TEXT NOT NULL,
  trade_date         TEXT NOT NULL,      -- YYYY-MM-DD
  open               REAL NOT NULL,
  close              REAL NOT NULL,
  pct_change         REAL,               -- 当日涨跌幅 %
  volume             REAL NOT NULL,      -- 手或份(统一存股/份数)
  amount             REAL NOT NULL,      -- 元
  vol_ratio_5        REAL,
  vol_ratio_20       REAL,
  nav                REAL,               -- 净值(官方DWJZ或IOPV)
  nav_source         TEXT,               -- 'official' | 'iopv' | NULL
  premium_rate       REAL,               -- %
  total_shares       REAL,               -- 期末场内总份额(份)
  share_source       TEXT,               -- 'sse_history' | 'snapshot' | NULL
  share_delta        REAL,               -- 相对上一交易日份数变化
  net_inflow_yi      REAL,               -- 净申购估算(亿元)
  signal_level       TEXT NOT NULL,      -- 'strong_support' | 'inflow_only' | 'volume_only' | 'normal'
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (code, trade_date)
);

CREATE TABLE IF NOT EXISTS etf_daily_summary (
  trade_date           TEXT PRIMARY KEY,
  resonance_level      TEXT NOT NULL,    -- 'strong' | 'watch' | 'none'
  active_count         INTEGER NOT NULL,
  volume_spike_count   INTEGER NOT NULL,
  support_etf_count    INTEGER NOT NULL,
  support_tier_count   INTEGER NOT NULL,
  total_amount_yi      REAL NOT NULL,
  aggregate_vol_ratio  REAL,
  total_net_inflow_yi  REAL,
  data_stage           TEXT NOT NULL,    -- 'preliminary' | 'nav_ready' | 'complete'
  updated_at           TEXT NOT NULL
);
```

### 扫描与回溯编排（`packages/server/src/services/etfMonitor/scanner.ts`）

- 进程内单飞互斥锁（同 `signals/scanner.ts` `inFlight`），防止定时任务与手动触发并发打重数据源。
- **窗口与幂等性**：
  - 首次初始化或库内无数据时（或新加入/重新启用一只 ETF 时），拉取近 `250` 个交易日（约 1 年，接口侧实际多取约 25 根作 20 日均额预热）的日 K 线与分页历史官方净值，以及近 `90` 个交易日的上交所历史份额（与默认 90 天时间轴对齐，控制单次请求量在 ~90 次以内，避免 250 次单日查询触发上交所限流或撞 nginx 300s 超时）。
  - 日常扫描只拉最近 `~45` 天日 K 线（覆盖 20 日均额计算所需窗口）、最近 `20` 条净值、以及近 `5` 个交易日上交所份额 + 当日深市/批量实时行情，在事务内对受影响日期重算指标并更新（**保留历史深市份额快照 `total_shares` 不被覆盖丢失**——upsert 时若已有 `'snapshot'`/`'sse_history'` 且本次未拿到新值，保留原值）。
  - `POST /api/etf/scan` 的可选参数 `{ backfillDays?: number }` 统一表示本次需要回溯重拉的交易日窗口（默认按首次 `90`/日常 `5` 天的上交所份额窗口与对应 K 线+25 根预热窗口执行，上限 `250`）。
- **盘中保护**：判断北京时间当前是否已过 `15:00`（交易日收盘）。若当前是工作日且北京时间早于 `15:00`，当天的未收盘 K 线（`trade_date === todayCN`）**不写入当日收盘指标**，但仍更新**前一交易日 `T-1`** 的深市/沪市份额净申购（这正是 `08:45` 早盘前补扫的作用）。
- **定时调度（`packages/server/src/jobs/etfDailyScan.ts`）**：
  - 使用 `node-cron` 显式传 `{ timezone: 'Asia/Shanghai' }`，周一至周五运行三波：
    - `10 15 * * 1-5`（15:10 收盘初扫）
    - `0 20 * * 1-5`（20:00 官方净值补齐）
    - `45 8 * * 1-5`（08:45 开盘前补齐昨日净申购）
  - 服务启动 30 秒后若距上次扫描超过 4 小时则补扫一次（由 `site_settings['etf.last_scan_at']` 控制闸门）。

## HTTP API 设计（`packages/server/src/routes/etfMonitor.ts`）

挂载于 `/api`，`ETF_MONITOR=off` 时统一返回 `404 { error: 'etf_monitor_disabled' }`。

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `GET /api/etf/board` | 公开读 | 查询参数 `?date=YYYY-MM-DD`（不传则取最新有数据的交易日）。返回 `{ summary, rows, disabledUniverse, params, lastScanAt, availableDates }`；`rows` 仅含 `enabled = 1` 的在池标的及指标，`disabledUniverse` 返回已停用标的列表供管理员在界面查看与恢复 |
| `GET /api/etf/timeline` | 公开读 | 查询参数 `?days=90`（默认 90，上限 365）。返回近 N 个交易日的 `etf_daily_summary` 列表，用于顶部历史共振时间轴/热力条 |
| `GET /api/etf/:code/history` | 公开读 | 查询参数 `?days=60`。返回单只 ETF 近 N 个交易日的成交额、放量倍数、溢价率、份额变化与净申购历史，供展开单行查看趋势 |
| `POST /api/etf/scan` | Admin | 触发一次扫描（可选 `{ backfillDays?: number }`） |
| `POST /api/etf/universe` | Admin | 新增一只 ETF（输入 6 位代码自动向东财查名称与市场确认，校验合法后加入并立即回溯该标的历史、重算历史汇总） |
| `PATCH /api/etf/universe/:code` | Admin | 启停（`enabled`）或调整所属梯队（`tier`）。改 `tier` 或停用（`1 -> 0`）时立即重算库内历史 `etf_daily_summary`；重新启用（`0 -> 1`）时先回溯该标的近期历史再重算汇总 |
| `DELETE /api/etf/universe/:code` | Admin | 从监控池删除该标的及其历史明细并重算汇总 |
| `PATCH /api/etf/params` | Admin | 修改 `vol_ratio_threshold`、`premium_threshold`、`inflow_threshold_yi` 并立即用新阈值重算库内历史状态标签与共振汇总 |

## 前端页面设计（`/etf`，`packages/client/src/pages/EtfMonitorPage.tsx`）

沿用全站设计语言（`SiteLayout` + `bg-page` + `font-sans-sc` / `font-numeral` + 桌面 CSS Grid + 移动端卡片流，不引入重型图表库，用轻量条形与热力块实现高信息密度排版）：

1. **顶栏导航与 SEO**：`SiteHeader.tsx` 的 `NAV_ITEMS` 中静态增加 `{ label: '托底', to: '/etf', adminOnly: false }`（紧跟「信号」之后，不增加全站能力探测请求）；当 `ETF_MONITOR=off` 使接口返回 404 时，`/etf` 页面展示清晰的「ETF 托底监控未启用」状态。`seo.ts` 中 `/etf` 保持 `noindex` 且不进 `sitemap.xml`（同 `/holdings`）。
2. **顶部总览卡（今日 / 所选日期状态）**：
   - 共振等级徽章（强托底共振 / 局部关注 / 常规波动）+ 所选交易日 + 数据完整度标签（对应 `data_stage` 四档：初步估算 / 含官方净值 / 含沪市份额 / 完整数据）。
   - 四个核心数字：触发托底宽基数（如 `5 / 18 只`）、覆盖梯队数（`3 / 4 个梯队`）、18 只合计成交额与整体放量倍数、合计净申购估算（亿元）。
   - 管理员操作区（右上角）：「立即扫描」按钮、「参数设置」弹窗（调 3 个阈值）、「添加 / 管理 ETF」弹窗（可查看并恢复 `disabledUniverse` 中已停用的标的）。
3. **历史共振时间轴（近 60/90 个交易日可交互热力条）**：
   - 一排紧凑竖条/色块对应最近 60 个交易日，强托底日高亮、局部关注日浅标，悬停显示日期、净申购额与触发只数，**点击任意一天立即切换下方明细表到该交易日**（方便直接点回 `2026-11-17` 看当天全景）。
4. **18 只宽基梯队明细区**：
   - 支持按梯队分组查看或「仅看异动」筛选，支持按放量倍数、溢价率、净申购额排序。
   - 每行展示：代码/简称（带梯队标签）、收盘价与涨跌幅、成交额与放量倍数（相对于 20 日均额 + 进度条直观看出放大程度）、溢价率（带 `IOPV` 估算标记若尚未出官方净值）、净申购估算（亿元 + 份额变化）、当日状态标签。
   - **点击行展开**：显示该 ETF 最近 15 个交易日的简明每日走势条（成交额倍数 / 溢价率 / 净申购列表，不用再跳转 App 翻 K 线）；管理员展开区可启停或移除该 ETF。

## MCP 只读工具（`packages/server/src/services/mcpServer.ts`）

新增 `get_etf_stabilization`：
- 入参：`date?: string`（可选 `YYYY-MM-DD`，默认最新交易日）、`days?: number`（近期时间轴天数，默认 10，最大 60）。
- 返回：指定交易日的全市场托底共振汇总 + 触发异动的 ETF 列表 + 18 只全量摘要 + 近 `days` 天共振历史，方便在 Claude / Codex 里结合研报直接分析大盘护盘动向。

## 留给实现阶段决定的细节（Left to Builder）

- 东方财富 / 上交所 / 深交所请求失败时的退避重试次数与单接口 UA/Headers 细节。
- SQLite 查询索引与 `availableDates` 分页细节。
- 前端桌面端列宽断点调优与移动端卡片细节排版（与 `SignalsPage.tsx` 风格保持一致即可）。
- OpenAPI 路由描述文案（`describeRoute`）与前后端单元测试 fixture 设计。
