// packages/server/src/routes/holdings.ts
//
// 实盘持仓。读接口公开(与信号看板同权限);上传用固定 API Key 全量覆盖。
// 密钥只从 Header 读。不要把密钥打进访问日志、错误日志或请求体日志 ——
// 查询串同样会进访问日志,所以这里不接受 ?key=。只在 HTTPS 上使用。
import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { IncomingHttpHeaders } from 'node:http'
import { validatorCompiler } from 'fastify-type-provider-zod'
import {
  getHoldingsSnapshot, replaceHoldings, type HoldingInput,
} from '../services/holdingsStore.js'
import {
  HOLDING_NAME_MAX_LENGTH, HOLDING_SYMBOL_MAX_LENGTH, HOLDINGS_MAX_ROWS,
  apiErrorSchema, holdingsPutBodySchema, holdingsSnapshotSchema,
} from '../openapi/holdingsSchemas.js'

export interface HoldingsRoutesOptions {
  /** 测试注入,避免断言依赖墙钟 */
  now?: () => Date
}

function configuredKey(): string | null {
  const raw = process.env.HOLDINGS_API_KEY
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  return key.length > 0 ? key : null
}

/** 先哈希再比较:长度不同时 timingSafeEqual 会抛,而且原始字节比较会把长度差暴露出来。 */
function keysMatch(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(provided).digest()
  return timingSafeEqual(a, b)
}

function headerValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null
}

function presentedKeys(headers: IncomingHttpHeaders): string[] {
  const keys: string[] = []
  const authorization = headerValue(headers.authorization)?.trim()
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization)
    if (match?.[1]) keys.push(match[1])
  }
  const alternate = headerValue(headers['x-holdings-key'])?.trim()
  if (alternate) keys.push(alternate)
  return keys
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseHoldings(body: unknown): { ok: true; rows: HoldingInput[] } | { ok: false; message: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: '请求体必须是对象' }
  }
  const holdings = (body as { holdings?: unknown }).holdings
  if (!Array.isArray(holdings)) return { ok: false, message: 'holdings 必须是数组' }
  if (holdings.length > HOLDINGS_MAX_ROWS) {
    return { ok: false, message: `holdings 最多 ${HOLDINGS_MAX_ROWS} 条` }
  }

  const rows: HoldingInput[] = []
  const seen = new Set<string>()
  for (const [index, item] of holdings.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: `holdings[${index}] 必须是对象` }
    }
    const row = item as Record<string, unknown>
    if (typeof row.symbol !== 'string' || !row.symbol.trim()) {
      return { ok: false, message: `holdings[${index}].symbol 不能为空` }
    }
    const symbol = row.symbol.trim()
    if (symbol.length > HOLDING_SYMBOL_MAX_LENGTH) {
      return { ok: false, message: `holdings[${index}].symbol 不能超过 ${HOLDING_SYMBOL_MAX_LENGTH} 个字符` }
    }
    if (seen.has(symbol)) return { ok: false, message: `symbol 重复: ${symbol}` }
    seen.add(symbol)

    let name: string | null = null
    if (row.name != null) {
      if (typeof row.name !== 'string') return { ok: false, message: `holdings[${index}].name 必须是字符串` }
      const trimmed = row.name.trim()
      if (trimmed.length > HOLDING_NAME_MAX_LENGTH) {
        return { ok: false, message: `holdings[${index}].name 不能超过 ${HOLDING_NAME_MAX_LENGTH} 个字符` }
      }
      name = trimmed.length > 0 ? trimmed : null
    }

    for (const field of ['shares', 'marketValue', 'cost', 'pnl'] as const) {
      if (!isFiniteNumber(row[field])) {
        return { ok: false, message: `holdings[${index}].${field} 必须是有限数字` }
      }
    }
    rows.push({
      symbol,
      name,
      shares: row.shares as number,
      marketValue: row.marketValue as number,
      cost: row.cost as number,
      pnl: row.pnl as number,
    })
  }
  return { ok: true, rows }
}

const disabledSchema = apiErrorSchema.describe('未配置 HOLDINGS_API_KEY，上传关闭。error 为 holdings_upload_disabled')
const unauthorizedSchema = apiErrorSchema.describe('未带密钥或密钥不对。error 为 unauthorized。已有快照不变')
const invalidSchema = apiErrorSchema.describe('请求体不合法。error 为 invalid_input，message 说明原因。已有快照不变')

export const holdingsRoutes: FastifyPluginAsync<HoldingsRoutesOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date())
  // 只在这个插件里换编译器。Zod 用来生成 OpenAPI；真正的校验仍是下面的 parseHoldings，
  // 并且一定发生在鉴权之后。响应 schema 同样只用于文档，序列化原样输出，避免字段被裁掉。
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(() => (data) => JSON.stringify(data))

  app.get('/holdings', {
    schema: {
      tags: ['holdings'],
      operationId: 'getHoldings',
      summary: '读取当前持仓快照',
      description: [
        '公开读，不需要登录，也不需要 API Key。',
        '没有数据时 `updatedAt` 为 null、`holdings` 为空数组。',
        '仓位占比 `weight` 由服务端按市值原值合计计算，合计为 0 时为 0。调用方上传时须已把 marketValue、cost、pnl 折算到同一计价币种，服务端不识别币种，也不做汇率换算。',
      ].join('\n\n'),
      response: { 200: holdingsSnapshotSchema },
    },
  }, async () => getHoldingsSnapshot())

  app.put('/holdings', {
    // Zod 校验失败也进处理函数，这样 503 / 401 仍优先于 400，错误体保持 invalid_input。
    attachValidation: true,
    schema: {
      tags: ['holdings'],
      operationId: 'replaceHoldings',
      summary: '全量覆盖上传持仓快照',
      description: [
        '用一份完整快照替换站上的持仓。不是合并。空数组表示清空。',
        '密钥放在 Header：`Authorization: Bearer <key>` 或 `X-Holdings-Key: <key>`，任选其一，两个都带时匹配一个即可。',
        '密钥是环境变量 `HOLDINGS_API_KEY` 的值。不要放进查询串（查询串会进访问日志），不要打进日志，只在 HTTPS 上使用。',
        '未配置密钥返回 503；密钥缺失或不对返回 401，此时不看请求体。',
        '请求体不合法返回 400，已有快照保持不变。成功时返回与读取接口相同的快照，`updatedAt` 由服务端时钟生成。',
        '同一份快照里的 marketValue、cost、pnl 必须先折算到同一计价币种。服务端按市值原值计算仓位占比，不识别币种，也不做汇率换算。',
        `holdings 最多 ${HOLDINGS_MAX_ROWS} 条；symbol 去空白后最长 ${HOLDING_SYMBOL_MAX_LENGTH} 个字符；name 去空白后最长 ${HOLDING_NAME_MAX_LENGTH} 个字符。超出返回 400，已有快照不变。`,
      ].join('\n\n'),
      security: [{ bearerAuth: [] }, { holdingsKey: [] }],
      body: holdingsPutBodySchema,
      response: {
        200: holdingsSnapshotSchema,
        400: invalidSchema,
        401: unauthorizedSchema,
        503: disabledSchema,
      },
    },
  }, async (request, reply) => {
    const key = configuredKey()
    // 未配置和密钥错误分开:前者是站点没开上传,后者才是调用方没带对。
    if (!key) return reply.status(503).send({ error: 'holdings_upload_disabled' })
    if (!presentedKeys(request.headers).some(candidate => keysMatch(key, candidate))) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
    const parsed = parseHoldings(request.body)
    if (!parsed.ok) return reply.status(400).send({ error: 'invalid_input', message: parsed.message })
    return replaceHoldings(parsed.rows, now().toISOString())
  })
}
