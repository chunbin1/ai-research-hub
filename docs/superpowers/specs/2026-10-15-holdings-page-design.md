# 实盘持仓

## 背景

研报站已经有信号看板，但没有「现在实际持有什么」。持仓来自站外账户，不在本站计算。
第三方按自己的节奏把**完整快照**推上来，站点只负责保存最新一份并展示。

## 目标

- 第三方通过 API **全量覆盖**上传一份持仓快照
- 新页面 `/holdings` 展示：标的、股数、市值、成本、浮动盈亏、仓位占比
- **整份快照共用一个更新时间**，放在表格上方，不给每行各记一个时间
- 没有持仓数据时：导航不出现「持仓」，直接打开 `/holdings` 回到首页
- 上传用固定 API Key；没配密钥时上传接口不可用

## 非目标

- 不计算行情、不拉券商、不在站内改某一行
- 不保留历史快照，只留最新一份
- 不按用户分持仓（站点一份实盘）
- 不把密钥放进查询串，也不写进日志
- 持仓页不进搜索引擎索引（沿用「未知路由 noindex」）

## 数据

SQLite，两张表。空快照 = 两张表都没有行，和「从未上传」相同。

`holdings_meta` 只有一行（`id = 1`），记整份快照的 `updated_at`（服务端时钟，ISO 8601）。

`holdings_positions` 存行：

| 列 | 含义 |
|---|---|
| `symbol` | 标的代码，主键，调用方传入后去掉首尾空白 |
| `name` | 名称，可空 |
| `shares` | 股数 |
| `market_value` | 市值 |
| `cost` | 成本 |
| `pnl` | 浮动盈亏 |
| `sort_order` | 上传数组里的顺序 |

仓位占比 **不落库**。读的时候按 `market_value / 市值合计` 现算。合计为 0 时每行占比为 0，避免除零。不取绝对值：空头的负市值就得到负占比。

**计价币种。** 服务端不识别币种，也不做汇率换算，占比就是各行 `market_value` 原值相加后的权重。调用方须在上传前把同一份快照里的 `marketValue`、`cost`、`pnl` 折算到同一计价币种。混有未折算的 USD/HKD 等金额时，占比没有意义。接口不增加 `currency` 字段。

## API

### `GET /api/holdings`

公开读，与 `GET /api/signals` 同一档：不要求登录。

没有数据：

```json
{ "updatedAt": null, "holdings": [] }
```

有数据：

```json
{
  "updatedAt": "2026-10-15T08:00:00.000Z",
  "holdings": [
    {
      "symbol": "AAPL",
      "name": "Apple",
      "shares": 10,
      "marketValue": 2000,
      "cost": 1500,
      "pnl": 500,
      "weight": 0.4
    }
  ]
}
```

`weight` 是 0–1 的比例（合计为 0 时为 0），前端格式化成百分比。计算使用市值原值，因此同一份快照的金额必须已经是同一计价币种。

### `PUT /api/holdings`

全量替换。请求体：

```json
{
  "holdings": [
    {
      "symbol": "AAPL",
      "name": "Apple",
      "shares": 10,
      "marketValue": 2000,
      "cost": 1500,
      "pnl": 500
    }
  ]
}
```

- `name` 可省略或为 `null`；空字符串存成 `null`。去空白后最长 200 个字符
- `shares` / `marketValue` / `cost` / `pnl` 必须是有限数字（拒绝字符串、`NaN`、`Infinity`）
- `marketValue`、`cost`、`pnl` 须由调用方折算到同一计价币种后再传。服务端不记录币种，仓位占比按市值原值合计
- `symbol` 去空白后不能空，最长 64 个字符，同一份快照里不能重复
- `holdings` 最多 500 条。`holdings: []` 清空快照，之后 GET 回到「没有数据」
- 条数或字段超长与其它校验失败一样，返回 400，已有快照不动
- 成功时返回与 GET 相同的快照，`updatedAt` 由服务端生成
- 校验失败返回 400 `{ "error": "invalid_input", "message": "..." }`，**已有快照不动**
- 替换在一个事务里：先删光再插入。失败则整单回滚

### 鉴权

只保护 PUT。密钥来自环境变量 `HOLDINGS_API_KEY`（去掉首尾空白后为空则视为未配置）。

调用方任选一种 Header（不要放查询串，查询串会进访问日志）：

```
Authorization: Bearer <key>
X-Holdings-Key: <key>
```

两个都带时，任意一个匹配即可。

| 情况 | 状态 |
|---|---|
| 未配置密钥 | 503 `{ "error": "holdings_upload_disabled" }` |
| 未带密钥或密钥不对 | 401 `{ "error": "unauthorized" }` |

比较时先做 SHA-256 再用 `timingSafeEqual`，避免密钥长度不同时直接抛错，也缩短按字节比较的时间差。

**不要把密钥打进日志。** 包括访问日志、错误日志、调试打印和请求体日志。密钥只应出现在 `.env` 和调用方的密钥管理里。此接口按 HTTPS 部署使用；HTTP 上 Header 等同明文。

生成示例：`openssl rand -hex 32`

```bash
curl -X PUT https://your-domain.example/api/holdings \
  -H "Authorization: Bearer $HOLDINGS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"holdings":[{"symbol":"AAPL","name":"Apple","shares":10,"marketValue":2000,"cost":1500,"pnl":500}]}'
```

## 页面

路由 `/holdings`，版式对齐 `/signals`：同一套顶栏、`max-w-[1440px]`、衬线标题、表格顶线用 `border-ink`。

- 标题「实盘持仓」
- 更新时间在表格**上方**，整页只有一处，用 `<time datetime="服务端 ISO">`
- 列：标的（代码，有名称则作副标题）、股数、市值、成本、浮动盈亏、仓位占比
- 盈亏沿用站内红涨绿跌：正数 `text-long`，负数 `text-short`，零为中性色
- 数字用 `font-numeral`

导航「持仓」插在「信号」之后，**仅当 GET 返回的 `holdings` 非空**时出现（桌面与移动两行一起）。加载失败或仍是空快照时不显示。

直接访问 `/holdings`：

- 加载中：给出「加载中…」，不渲染空表
- 成功且没有持仓：`<Navigate to="/" replace>`，不留空白页
- 请求失败：一行错误，不渲染空表

## 测试

服务端（内存 SQLite）：

- 未配置或空白密钥 → PUT 503，GET 仍返回空快照
- 缺密钥、密钥错误、密钥只放在查询串 → 401，且不会改掉已有快照
- 从未上传 → GET `{ updatedAt: null, holdings: [] }`
- Bearer 与 `X-Holdings-Key` 都能写入；再次 PUT 整份替换；`[]` 清空后 GET 回到空快照
- 仓位占比按市值合计；合计为 0 时占比为 0
- 非法请求体 400，原快照保持不变
- `holdings` 超过 500 条、`symbol` 超过 64 个字符或 `name` 超过 200 个字符 → 400，原快照保持不变

前端：

- 有数据时表格含上述列，更新时间只有一处且在表上方；盈亏红绿
- 无数据时访问 `/holdings` 回到首页
- 无数据或请求失败时导航没有「持仓」；有数据时有

## 接口文档

Swagger UI 挂在 `/api/docs`。这条路径在 `/api` 下，nginx 和 Vite 都会把它转到 Fastify，不会进前端路由。页面响应带 `X-Robots-Tag: noindex`，SEO 对 `api/docs` 也按未知路径不收录。

- 规范：`GET /api/docs/json`、`GET /api/docs/yaml`
- 持仓的请求体和响应由 Zod schema 生成，示例是虚构的 AAPL / 0700.HK，不含真实密钥
- 上传的两种 Header 记成 `bearerAuth` 与 `holdingsKey`。文档页不记住授权（`persistAuthorization: false`）
- 运行时校验仍以 `parseHoldings` 为准，并且在鉴权之后。文档用的 schema 不改变 503 / 401 / 400 的顺序和错误体
- 其它公开读接口只写摘要，不附加 body / response schema，避免改掉原有校验
- 没标注的管理接口不出现在这份文档里

导出（不启动监听）：

```bash
pnpm --filter @arh/server exec tsx scripts/export-openapi.ts ./openapi
```
