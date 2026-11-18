// packages/server/src/jobs/etfDailyScan.ts
//
// A 股宽基 ETF 三段定时扫描（北京时间 Asia/Shanghai）：
// - 15:10：收盘即看放量倍数 + IOPV 估算溢价
// - 20:00：官方单位净值 DWJZ 覆盖更新精确溢价
// - 08:45：开盘前补齐前一日沪深交易所申赎后总份额（计算净申购额）
import cron from 'node-cron'
import { ETF_LAST_SCAN_KEY, isEtfMonitorEnabled, scanEtfMonitor } from '../services/etfMonitor/scanner.js'
import { getSetting } from '../services/siteSettingsStore.js'

export const ETF_CRON_EXPRS = ['10 15 * * 1-5', '0 20 * * 1-5', '45 8 * * 1-5'] as const
export const ETF_TIMEZONE = 'Asia/Shanghai'
export const ETF_BACKFILL_GATE_MS = 4 * 60 * 60 * 1000
const BACKFILL_DELAY_MS = 30_000

export function shouldEtfBackfill(lastScanAt: string | null, nowMs: number): boolean {
  if (!lastScanAt) return true
  const t = Date.parse(lastScanAt)
  if (Number.isNaN(t)) return true
  return nowMs - t >= ETF_BACKFILL_GATE_MS
}

interface Log {
  info: (msg: string) => void
  error: (msg: string) => void
}

async function runEtfScan(log: Log, reason: string): Promise<void> {
  try {
    const s = await scanEtfMonitor()
    log.info(`[etf] ${reason}扫描完成: 共 ${s.total}, 成功 ${s.ok}, 失败 ${s.failed}, 最新交易日 ${s.latestDate ?? '无'}`)
  } catch (err) {
    log.error(`[etf] ${reason}扫描异常: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function startEtfDailyScan(log: Log): void {
  if (!isEtfMonitorEnabled()) {
    log.info('[etf] ETF_MONITOR=off — 不注册定时扫描')
    return
  }

  for (const expr of ETF_CRON_EXPRS) {
    cron.schedule(expr, () => { void runEtfScan(log, `定时(${expr})`) }, { timezone: ETF_TIMEZONE })
  }
  log.info(`[etf] 已注册三段定时扫描 (${ETF_CRON_EXPRS.join(', ')}) [${ETF_TIMEZONE}]`)

  setTimeout(() => {
    if (!shouldEtfBackfill(getSetting(ETF_LAST_SCAN_KEY), Date.now())) {
      log.info('[etf] 距上次扫描不足 4 小时 — 跳过启动补扫')
      return
    }
    void runEtfScan(log, '启动补')
  }, BACKFILL_DELAY_MS).unref()
}
