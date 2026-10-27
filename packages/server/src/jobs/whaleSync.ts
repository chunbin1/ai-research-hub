// 工作日看一眼 SEC。13F 不是每个交易日都有新文件；
// accession 没变时同步层不会重复下 XML。
import cron from 'node-cron'
import { isWhalesEnabled, resolveSecUserAgent } from '../services/whales/enabled.js'
import { createSecTransport } from '../services/whales/sec.js'
import { getMeta } from '../services/whales/store.js'
import { syncWhales } from '../services/whales/sync.js'

export const WHALE_CRON_EXPR = '0 6 * * 1-5'
/** 启动补拉的闸门：距上次成功拉取不足这么久就跳过 */
export const WHALE_BACKFILL_GATE_MS = 12 * 60 * 60 * 1000
const BACKFILL_DELAY_MS = 45_000

export function shouldWhaleBackfill(lastSyncAt: string | null, nowMs: number): boolean {
  if (!lastSyncAt) return true
  const t = Date.parse(lastSyncAt)
  if (Number.isNaN(t)) return true
  return nowMs - t >= WHALE_BACKFILL_GATE_MS
}

interface Log {
  info: (msg: string) => void
  error: (msg: string) => void
}

async function runSync(log: Log, reason: string): Promise<void> {
  const userAgent = resolveSecUserAgent()
  if (!userAgent) {
    log.info('[whales] 未配置 SEC_USER_AGENT 或 WHALES_CONTACT_EMAIL — 跳过拉取')
    return
  }
  try {
    const summary = await syncWhales({ transport: createSecTransport(userAgent), userAgent })
    log.info(`[whales] ${reason}拉取完成:成功 ${summary.ok},无申报 ${summary.empty},失败 ${summary.failed}`)
  } catch (err) {
    log.error(`[whales] ${reason}拉取异常:${err instanceof Error ? err.message : String(err)}`)
  }
}

export function startWhaleSync(log: Log): void {
  if (!isWhalesEnabled()) {
    log.info('[whales] WHALES=off — 不注册定时拉取')
    return
  }

  cron.schedule(WHALE_CRON_EXPR, () => { void runSync(log, '定时') }, { timezone: 'UTC' })
  log.info(`[whales] 已注册定时拉取 ${WHALE_CRON_EXPR} (UTC)`)

  setTimeout(() => {
    if (!shouldWhaleBackfill(getMeta().lastSyncAt, Date.now())) {
      log.info('[whales] 距上次拉取不足 12 小时 — 跳过启动补拉')
      return
    }
    void runSync(log, '启动补')
  }, BACKFILL_DELAY_MS).unref()
}
