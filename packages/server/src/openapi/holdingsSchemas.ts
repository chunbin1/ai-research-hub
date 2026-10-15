// 持仓接口的请求 / 响应形状。OpenAPI 由这些 Zod schema 生成，
// 运行时的校验仍以 routes/holdings.ts 里的 parseHoldings 为准（鉴权在校验之前）。
// 两边共用下面的上限，避免文档和实际拒绝的长度不一致。
import { z } from 'zod'

export const HOLDINGS_MAX_ROWS = 500
export const HOLDING_SYMBOL_MAX_LENGTH = 64
export const HOLDING_NAME_MAX_LENGTH = 200

const finite = (label: string) => z.number().finite().describe(`${label}，有限数字，不要传字符串`)

/** 金额不带币种。调用方须先折算到同一计价币种，服务端只按数字相加。 */
const money = (label: string) => z.number().finite().describe(
  `${label}，有限数字，不要传字符串。须与同一份快照里的 marketValue、cost、pnl 折算到同一计价币种；服务端不识别币种，也不做汇率换算`,
)

export const holdingInputSchema = z.object({
  symbol: z.string().trim().min(1).max(HOLDING_SYMBOL_MAX_LENGTH).describe(
    `标的代码。同一份快照里不能重复，首尾空白会被去掉，最长 ${HOLDING_SYMBOL_MAX_LENGTH} 个字符`,
  ),
  name: z.string().trim().max(HOLDING_NAME_MAX_LENGTH).nullable().optional().describe(
    `名称，可省略。空字符串会存成 null，最长 ${HOLDING_NAME_MAX_LENGTH} 个字符`,
  ),
  shares: finite('股数'),
  marketValue: money('市值'),
  cost: money('成本'),
  pnl: money('浮动盈亏'),
}).describe('一行持仓。金额须已折算到同一计价币种。仓位占比不由调用方传，读的时候按市值原值合计')

export const holdingsPutBodySchema = z.object({
  holdings: z.array(holdingInputSchema).max(HOLDINGS_MAX_ROWS).describe(
    `完整快照，最多 ${HOLDINGS_MAX_ROWS} 条。空数组表示清空，之后读接口回到「没有数据」。同一份快照里的金额须为同一计价币种`,
  ),
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
  weight: z.number().describe('仓位占比，市值 / 市值合计。合计为 0 时为 0。按市值原值计算，调用方须已把金额折算到同一计价币种'),
})

export const holdingsSnapshotSchema = z.object({
  updatedAt: z.string().nullable().describe('整份快照的更新时间（服务端时钟，ISO 8601）。没有持仓时为 null'),
  holdings: z.array(holdingViewSchema),
}).describe('一份持仓快照。所有行共用 updatedAt。金额按调用方传入的同一计价币种理解')

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})
