// packages/server/src/routes/holdings.ts
//
// 实盘持仓。读接口公开(与信号看板同权限);上传用固定 API Key 全量覆盖。
// 密钥只从 Header 读。不要把密钥打进访问日志、错误日志或请求体日志 ——
// 查询串同样会进访问日志,所以这里不接受 ?key=。只在 HTTPS 上使用。
import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { IncomingHttpHeaders } from 'node:http'
import {
  getHoldingsSnapshot, replaceHoldings, type HoldingInput,
} from '../services/holdingsStore.js'

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
    if (seen.has(symbol)) return { ok: false, message: `symbol 重复: ${symbol}` }
    seen.add(symbol)

    let name: string | null = null
    if (row.name != null) {
      if (typeof row.name !== 'string') return { ok: false, message: `holdings[${index}].name 必须是字符串` }
      const trimmed = row.name.trim()
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

export const holdingsRoutes: FastifyPluginAsync<HoldingsRoutesOptions> = async (app, opts) => {
  const now = opts.now ?? (() => new Date())

  app.get('/holdings', async () => getHoldingsSnapshot())

  app.put('/holdings', async (request, reply) => {
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
