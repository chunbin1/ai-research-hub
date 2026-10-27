# 名家 13F 持仓追踪

## 背景

站点已有两条和「持仓」相关、但互不替代的路径：

- `/holdings`：用户自己的实盘快照，由外部账户 API 全量覆盖，只留最新一份
- `/signals`：自选股的 SuperTrend，行情来自 Yahoo，按交易日 cron 重算

缺的是公开信息：巴菲特、李录、高瓴、Ackman、Burry、Cathie Wood 在美国申报的 13F。这些申报季度更新、用 CUSIP、和本站实盘不是同一份数据。

已确认方案 A：服务端直连 SEC EDGAR，不接第三方持仓聚合站。

## 目标

- 新栏目「名家持仓」，路由 `/whales` 与 `/whales/:slug`，和 `/holdings` 完全分开
- 首批固定六家机构，CIK 写进种子数据。名单见下节，2026-10-27 用 `data.sec.gov/submissions` 核对过
- 列表给出摘要；详情同时给出本期持仓表，以及相对上一报告期的新建仓 / 加仓 / 减仓 / 清仓
- 定时从 SEC 拉取。`WHALES=off` 时不注册 cron，相关路由 404
- 某家在 submissions 里没有 `13F-HR` / `13F-HR/A` 时，列表仍保留该机构，状态为「暂无数据」
- 展示尽量带上 ticker；对不上就显示申报里的 `nameOfIssuer` 和 CUSIP

## 非目标

- 不接 OpenFIGI、Yahoo 或其它行情源来补 ticker、补价格
- 不把 13F 写进 `holdings_*` 表，也不进信号自选股
- 不做「立刻同步全部」按钮。管理员添加机构时会拉这一家；全量仍走定时任务
- 不做报告期切换器。页面只展示最新一期，并和库里相邻的上一期对比
- 不展示投票权、`otherManager`、投资裁量拆分。同一证券的多行在入库前合并
- 不把历史每一期都摊到页面上。库里保留最近 8 个报告期，供对比和日后扩展

## 与 holdings / signals 的边界

| | 实盘 `/holdings` | 信号 `/signals` | 名家 `/whales` |
|---|---|---|---|
| 数据从哪来 | 外部 `PUT` 快照 | Yahoo 行情 + 自选股 | SEC Form 13F |
| 开关 | `HOLDINGS_API_KEY` 只关上传 | `SIGNALS=off` | `WHALES=off` |
| 表 | `holdings_meta` / `holdings_positions` | `signal_*` / `watchlist` | `whale_*` / `sec_company_tickers` |
| 空数据时导航 | 隐藏「持仓」，直开会回首页 | 栏目一直在 | 栏目一直在；`WHALES=off` 才藏 |
| 收录 | noindex，不进 sitemap | 可收录 | 列表和库里已有机构的详情可收录；未知 slug noindex |

三条线不互相读写。关其中一条不影响另外两条。

## 种子机构

CIK 为 10 位、左侧补零，与 submissions URL 一致。官方名称以 submissions JSON 的 `name` 为准。

| slug | 展示名 | 管理人 | 英文名 | CIK | 核对 |
|---|---|---|---|---|---|
| `berkshire` | 伯克希尔·哈撒韦 | 巴菲特 | Berkshire Hathaway Inc | `0001067983` | 2026-08-14 仍有 `13F-HR`，报告期 2026-06-30 |
| `himalaya` | 喜马拉雅资本 | 李录 | Himalaya Capital Management LLC | `0001709323` | 2026-08-14 仍有 `13F-HR`，报告期 2026-06-30 |
| `hhlr` | 高瓴 HHLR | 张磊 | HHLR Advisors, Ltd. | `0001762304` | 高瓴美股 13F 的申报主体。不要用相邻的 `0001762303`。2026-08-14 仍有 `13F-HR` |
| `pershing` | 潘兴广场 | 比尔·阿克曼 | Pershing Square Capital Management, L.P. | `0001336528` | 最近一份在 recent 里是 2026-05-15，报告期 2026-03-31 |
| `scion` | Scion | 迈克尔·伯里 | Scion Asset Management, LLC | `0001649339` | 最近一份 2025-11-03，报告期 2025-09-30 |
| `ark` | ARK Invest | 凯西·伍德 | ARK Investment Management LLC | `0001697748` | 2026-08-14 仍有 `13F-HR`，报告期 2026-06-30 |

种子在 `initWhaleTables` 时写入。已有 slug 用 `ON CONFLICT DO UPDATE` 更新名称和 CIK，不碰已拉下来的申报。

## 架构

```
cron / 启动补拉
    → syncWhales
        → data.sec.gov/submissions/CIK##########.json
        → www.sec.gov/Archives/...-index.htm     找 INFORMATION TABLE 的 xml
        → 该 xml
        → 解析、按证券合并、换算成美元
        → whale_filings + whale_positions
        → （最多每 7 天）www.sec.gov/files/company_tickers.json
              → sec_company_tickers

GET /api/whales
GET /api/whales/:slug
    → 读库
    → 相邻两期在读时做 diff（不落增减表）
    → 用公司名匹配 ticker
```

`filings.recent` 对这六家已经覆盖大约十年的 13F（伯克希尔 recent 共 1000 条申报，其中 13F 仍有 44 条，最旧到 2016-12-31）。本轮只读 `filings.recent`，不再追 `filings.files` 里的更老归档。每家只保留最近 8 个报告期。

同一 `reportDate` 若同时有 `13F-HR` 和 `13F-HR/A`，只留一份：申报日较新者胜；同一天则修正案（`/A`）胜；仍相同则 accession 字典序较大者胜。库里对 `(slug, report_period)` 唯一。再次同步到同一 accession 时跳过下载。修正案换了 accession 则整期替换持仓。

机构之间串行拉取，避免并行打穿 SEC 限流。一家失败只记下这家的错误，继续下一家。

## 表

SQLite，由 `initWhaleTables` 建表。不改 holdings / signals 的表。

`whale_institutions`：`slug` 主键，`name_zh`，`name_en`，`manager`，`cik`，`sort_order`。

`whale_filings`：

| 列 | 含义 |
|---|---|
| `id` | 整数主键 |
| `slug` | 机构 |
| `accession` | 如 `0001193125-26-352200` |
| `form` | `13F-HR` 或 `13F-HR/A` |
| `report_period` | 报告期 `YYYY-MM-DD` |
| `filed_at` | 申报日 |
| `source_url` | SEC 归档索引页，给页面上的「SEC 原文」 |
| `value_unit` | `dollars` 或 `thousands`，记录这份申报原始 `value` 的单位 |
| `fetched_at` | 拉下来的时间 |

`UNIQUE (slug, report_period)`。

`whale_positions`：主键 `(filing_id, cusip, put_call, share_type)`。

| 列 | 含义 |
|---|---|
| `issuer_name` | `nameOfIssuer` |
| `title_of_class` | `titleOfClass` |
| `put_call` | `''`、`Put` 或 `Call` |
| `share_type` | `SH` 或 `PRN` |
| `shares` | 合并后的 `sshPrnamt` |
| `value_reported` | 合并后的原始 `value` |
| `value_usd` | 换算成美元之后的市值 |

`whale_sync`：每家一行。`last_attempt_at`，`last_success_at`，`last_error`。没有 13F 也算成功（错误清空），页面靠「没有任何 filing」显示暂无数据。

`whale_meta`：单行 `id = 1`。`last_sync_at` 给启动补拉的闸门，`tickers_fetched_at` 给 ticker 表的 7 天缓存。

`sec_company_tickers`：`ticker` 主键，`title`，`cik`。整表替换，不和持仓行绑在一起。ticker 在读的时候现配，公司名表更新后不用重下 13F。

## SEC 访问

### 主机

- 申报清单只走 `https://data.sec.gov/submissions/CIK##########.json`
- 信息表 XML 不在 `data.sec.gov`。同一路径实测返回 404。索引页和 XML 在 `https://www.sec.gov/Archives/edgar/data/...`
- ticker 对照表用 SEC 自己的 `https://www.sec.gov/files/company_tickers.json`，不是第三方行情

两个主机都算 SEC 公平访问政策里的机器访问：同一 User-Agent，同一条限流队列。

### 限流与 User-Agent

- 全任务串行，两次请求至少间隔 150ms（低于 SEC 的每秒 10 次上限）
- 收到 429 或 503 时等 1 秒再试一次，仍失败则这家记错误
- User-Agent 必填，否则 SEC 会拒绝。解析顺序：
  1. `SEC_USER_AGENT` 非空则原样使用
  2. 否则若 `WHALES_CONTACT_EMAIL` 非空，使用 `ai-research-hub whales-13f (<email>)`
  3. 两者都没有：打日志并跳过本次拉取，服务照常启动，页面仍可读已有数据。不使用「空 User-Agent」去撞 SEC

### 信息表在哪

`primary_doc.xml` 是封面，不是持仓。归档索引 HTML 里，类型为 `INFORMATION TABLE` 的那一行有两份链接：一份在 `xslForm13F_*` 下，是给人看的 HTML；另一份是原始 XML（文件名不固定，伯克希尔 2026-06-30 那份叫 `56757.xml`）。取不含 `xslForm13F` 的 `.xml`。

### 市值单位

SEC Release 34-95148：2023-01-03 及之后**提交**的 13F，`value` 改为四舍五入到美元，不再是千美元。

- `filed_at >= 2023-01-03`：`value_usd = value`
- 更早：`value_usd = value × 1000`

判断用申报日，不用报告期。`value_unit` 记在 filing 上，页面统一写「市值（美元）」，页脚说明这条口径。不能对 2023 之后的申报再乘 1000，否则会放大一千倍。伯克希尔 2026-06-30 信息表里 ALLY 约 1256 万股、`value` 577211815，对应每股约 46 美元，和「已经是美元」一致。

## 解析与合并

从每个 `<infoTable>` 取出 `nameOfIssuer`、`titleOfClass`、`cusip`、`value`、`sshPrnamt`、`sshPrnamtType`、可选的 `putCall`。标签允许带命名空间前缀。

- CUSIP 去空白、转大写。空 CUSIP 或股数 / 市值不是有限数字的行丢掉
- `putCall` 归一成 `Put`、`Call` 或空
- `sshPrnamtType` 缺省当 `SH`
- 同一 filing 内按 `(cusip, put_call, share_type)` 相加股数和市值。伯克希尔会把同一只股票按 `otherManager` 拆成多行，页面上应是一只仓

## 增减

不建增减表。读详情时取该机构报告期最新的两份 filing，用同一个三元组做键：

| 情况 | `change` |
|---|---|
| 只有本期、没有上一份 filing | `null`（页面写「暂无上期可对比」，不要把所有行标成新建仓） |
| 上期没有、本期有 | `new` 新建仓 |
| 本期股数 > 上期股数 | `increased` 加仓 |
| 本期股数 < 上期股数 | `decreased` 减仓 |
| 股数相同 | `unchanged` 不变。市值可以因价格变化而不同，不因此改标签 |
| 上期有、本期没有 | `closed` 清仓，不进持仓表，单独列在下面 |

比较的是股数，不是市值。清仓的本期股数和市值记 0，权重为 `null`。本期权重 = 该行 `value_usd` / 本期市值合计；合计为 0 时权重为 0。

## Ticker

`company_tickers.json` 只有 ticker、公司名、CIK，没有 CUSIP。匹配规则：

- 名称转大写，`&` 换成 `AND`，去掉标点，再剥掉末尾的 INC / CORP / LTD / LLC / LP / PLC / CO / COMPANY 等
- 归一化后的公司名只对应一个 ticker 才采用
- 对应多个（如 BRK-A / BRK-B、GOOG / GOOGL）或一个都没有：`ticker` 为 `null`，页面显示 `nameOfIssuer` 和 CUSIP

不猜测股份类别。ticker 表拉取失败不影响 13F 入库，沿用库里的旧表；旧表也没有就只显示申报名称。

## API

读接口公开，与 `GET /api/signals` 同一档，不要求登录。增删仅管理员。`WHALES=off` 时整组 404，体为 `{ "error": "whales_disabled" }`。

### `GET /api/whales`

按 `sort_order` 返回种子机构和后来添加的机构。没有申报的机构也在里面：`dataStatus` 为 `empty`，`latest` 为 `null`。有申报为 `ready`。`syncError` 是最近一次失败的短文本，成功或尚未拉取时为 `null`。

`latest` 含 `reportPeriod`、`filedAt`、`form`、`positionCount`、`totalValueUsd`，以及市值最大的一持仓 `top`（`issuerName`、`ticker`、`cusip`）。没有持仓行时 `top` 为 `null`。

### `GET /api/whales/:slug`

未知 slug：404 `{ "error": "not_found" }`。

已知 slug 但没有申报：`period`、`previousPeriod` 为 `null`，`positions` 和 `closed` 为空数组。机构信息仍返回。

有申报时 `period` 带 `reportPeriod`、`filedAt`、`form`、`accession`、`sourceUrl`、`valueUnit`。`previousPeriod` 只有报告期和申报日。`valueNote` 是给页面用的口径说明。

`positions` 按 `valueUsd` 降序。每行：`cusip`、`ticker`、`issuerName`、`titleOfClass`、`putCall`、`shareType`、`shares`、`valueUsd`、`weight`、`change`、`prevShares`、`prevValueUsd`、`shareDelta`、`valueDeltaUsd`。没有上期时，`change` 和 `prev*`、`shareDelta`、`valueDeltaUsd` 为 `null`。

`closed` 是清仓行，按上期市值降序。`weight` 为 `null`。

### `POST /api/whales`

仅管理员，与信号页添加标的一样走 `requireAdmin`。未登录 401，非管理员 403。

请求体：`cik`、`manager`、`nameZh` 必填，`nameEn`、`slug` 可选。CIK 是 1–10 位数字，入库前补零到 10 位。短名不填时从英文名生成；生成不了返回 400 `{ "error": "slug_required" }`。手填短名若含无法变成 URL 片段的字符，返回 400 `{ "error": "invalid_input" }`。

slug 或 CIK 与现有行冲突：409，`error` 为 `slug_taken` 或 `cik_taken`，`message` 说明冲突的是哪一个。

成功 201。写入后立刻只拉这一家，不改全量同步的 `last_sync_at`。没有 13F 仍保留。响应带 `institution`（与列表里同一行）和 `sync`（`ok` / `empty` / `failed` / `skipped`）。

### `DELETE /api/whales/:slug`

仅管理员。硬删这一家，并删除它的申报、持仓和同步记录。没有这家是 404 `{ "error": "not_found" }`。六家种子在进程下次启动时会按代码重新写回；管理员后加的机构不会。

## 定时任务

对齐 `jobs/dailyScan.ts` 的形状，单独一个任务，不塞进信号扫描。

- cron：`0 6 * * 1-5`，时区显式 `UTC`（北京时间工作日 14:00）。13F 不是每个交易日都有新文件，工作日看一眼即可；没有新 accession 时只打 submissions，不重复下 XML
- 启动后延迟 45 秒再考虑补拉，避免和信号扫描的 30 秒补扫叠在一起抢启动
- 距 `whale_meta.last_sync_at` 不足 12 小时则跳过补拉。时间戳损坏或从未同步则补拉
- `WHALES=off`：不注册 cron，不补拉，日志写明原因。进程照常监听

## 页面

版式对齐 `/holdings` 与 `/signals`：顶栏由 `SiteLayout` 提供，内容 `max-w-[1440px]`，标题 `font-serif-sc`，数字 `font-sans-sc` + `tabular-nums`，表顶线 `border-ink`。页面不引用 antd，单独懒加载。

导航「名家持仓」放在「持仓」后面（持仓被隐藏时紧跟「信号」）。桌面和移动两行都有。`/whales/:slug` 仍高亮这一项。

`WHALES=off`（接口 404 且 `error === whales_disabled`）时两行导航都去掉。其它失败不藏入口，页面自己显示错误。

### 列表 `/whales`

- 标题「名家持仓」
- 说明：「美国 SEC Form 13F 的公开申报。」
- 管理员（与信号页「添加标的」同一套 `requireAdmin`）在列表标题旁看到「添加机构」。必填 CIK、管理人、中文名；英文名和短名可选。短名不填时从英文名生成，纯中文生成不了就要求手填。写入后立刻拉这一家；没有 13F 仍留在列表，状态「暂无数据」。slug 或 CIK 与现有行冲突时接口 409，页面展示返回的说明。删除是硬删，申报和持仓一并清掉；代码里的六家种子会在下次进程启动时写回，管理员后加的机构删了就没有了
- 列：管理人（链到详情）、机构、报告期、持仓数、市值合计（美元）、第一大持仓、状态
- `empty`：状态格写「暂无数据」，数字列用「—」
- 有 `syncError` 且没有申报：状态仍是「暂无数据」，下面一行小字「最近一次拉取失败」
- 加载中只写「加载中…」，不渲染空表。请求失败一行错误

### 详情 `/whales/:slug`

- 标题用管理人，副标题是中文机构名、英文名和 CIK
- 有数据：报告期、申报日、`form`、指向 `sourceUrl` 的「SEC 原文」
- 有上一期：写明对比的报告期。表的「相对上期」列用中文标签。加仓和新建仓用 `text-long`，减仓和清仓用 `text-short`，不变用中性色。股数差额带正负号
- 没有上一期：表仍在，相对上期这一列写「—」，页上说明暂无上期可对比
- 清仓单独一小节，不混进本期持仓
- 没有申报：不渲染空表，正文写「暂无数据」
- 未知 slug：接口 404，页面写「没有这家机构」
- 页脚标明市值是美元，并复述 2023-01-03 前后的换算规则。期权行在名称旁标「认购」或「认沽」

## SEO

`/whales` 与库里已有机构的详情可收录，标题类似「名家持仓 — 研报站」「巴菲特持仓 — 研报站」。未知 slug、以及 `WHALES=off` 时，按 noindex 处理，sitemap 也不列出这些 URL。`/holdings` 维持 noindex。

## 环境变量

| 变量 | 作用 |
|---|---|
| `WHALES=off` | 关闭路由与 cron。其它值或未设置表示开启 |
| `SEC_USER_AGENT` | 可选。完整 User-Agent，优先于邮箱 |
| `WHALES_CONTACT_EMAIL` | 可选。没有上一行时，用来拼 User-Agent |

写入 `packages/server/.env.example` 和 `.env.prod.example`。不把联系邮箱写死在代码里。

## 测试

不访问真实 SEC。同步测试注入一个假的 `getText`，喂 submissions、索引 HTML 和信息表 XML。

- 解析器：命名空间、同一 CUSIP 多行合并、Put/Call、坏行丢弃、2023 前后的美元换算
- 报告期选择：修正案覆盖原报，只留最近 N 期
- diff：新建、加仓、减仓、清仓、股数不变、没有上期
- ticker：唯一命中、重名放弃、对不上
- API：六家都在；无申报是 `empty` 而不是 404；详情含增减；未知 slug 404；`WHALES=off` 时列表也 404
- 启动补拉闸门：没同步过要补，刚同步过不补
- 前端：列表有「暂无数据」和摘要列；详情能看见四类增减和「市值（美元）」；导航有「名家持仓」，功能关闭时没有

`pnpm typecheck`、`pnpm test`、`pnpm build:client` 必须通过。

## 已知取舍

- 13F 最少滞后 45 天，而且只覆盖美股多头（外加部分期权）。它不是实盘，也不是当日仓位
- 股份类别靠公司名对不上 ticker 时宁可空着，也不把 A/B 类猜错
- 工作日 cron 在非申报季大多是空跑。空跑只请求 submissions，代价是六次小 JSON
