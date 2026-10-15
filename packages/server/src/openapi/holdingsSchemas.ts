// 持仓接口的请求 / 响应形状。OpenAPI 由这些 Zod schema 生成，
// 运行时的校验仍以 routes/holdings.ts 里的 parseHoldings 为准（鉴权在校验之前）。
import { z } from 'zod'

const finite = (label: string) => z.number().finite().describe(`${label}，有限数字，不要传字符串`)

export const holdingInputSchema = z.object({
  symbol: z.string().trim().min(1).describe('标的代码。同一份快照里不能重复，首尾空白会被去掉'),
  name: z.string().trim().nullable().optional().describe('名称，可省略。空字符串会存成 null'),
  shares: finite('股数'),
  marketValue: finite('市值'),
  cost: finite('成本'),
  pnl: finite('浮动盈亏'),
}).describe('一行持仓。仓位占比不由调用方传，读的时候按市值合计算')

export const holdingsPutBodySchema = z.object({
  holdings: z.array(holdingInputSchema).describe('完整快照。空数组表示清空，之后读接口回到「没有数据」'),
}).meta({
  examples: [{
    holdings: [
      { symbol: 'AAPL', name: 'Apple', shares: 10, marketValue: 2000, cost: 1500, pnl: 500 },
      { symbol: '0700.HK', name: null, shares: 100, marketValue: 3000, cost: 2800, pnl: -200 },
    ],
  }],
})

export const holdingViewSchema = holdingInputSchema.extend({
  name: z.string().nullable().describe('名称，没有时为 null'),
  weight: z.number().describe('仓位占比，市值 / 市值合计。合计为 0 时为 0'),
})

export const holdingsSnapshotSchema = z.object({
  updatedAt: z.string().nullable().describe('整份快照的更新时间（服务端时钟，ISO 8601）。没有持仓时为 null'),
  holdings: z.array(holdingViewSchema),
}).describe('一份持仓快照。所有行共用 updatedAt')

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})
