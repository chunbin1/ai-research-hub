// packages/server/src/jobs/dailyScan.ts
//
// 每交易日收盘后扫描一次 + 服务启动时补扫。
//
// cron 定在 21:30 UTC:实测 meta.currentTradingPeriod.regular.end,
// 港股 08:10 UTC 收盘、美股 20:00 UTC(EDT)/ 21:00 UTC(EST)收盘,
// 21:30 卡在两者之后 —— 一个 cron 覆盖两个市场。对应北京时间次日 05:30。
// 时区必须显式传 UTC,不能依赖容器 TZ。
//
// 节假日不需要交易日历:当天 Yahoo 不返回新 bar,全量重算后内容不变,空跑无害。
import cron from 'node-cron'
import { scanAll, isSignalsEnabled, LAST_SCAN_KEY } from '../services/signals/scanner.js'
import { getSetting } from '../services/siteSettingsStore.js'

export const CRON_EXPR = '30 21 * * 1-5'
/** 启动补扫的闸门:距上次扫描不足这么久就跳过,防开发期反复重启反复扫 */
export const BACKFILL_GATE_MS = 6 * 60 * 60 * 1000
const BACKFILL_DELAY_MS = 30_000

/**
 * 不做缺口检测 —— 判断「缺了哪几天」需要交易日历(港股与美股假期还不同),
 * 复杂且易错。全量重算本就幂等,缺 1 天与缺 100 天走同一条路径。
 */
export function shouldBackfill(lastScanAt: string | null, nowMs: number): boolean {
  if (!lastScanAt) return true
  const t = Date.parse(lastScanAt)
  if (Number.isNaN(t)) return true
  return nowMs - t >= BACKFILL_GATE_MS
}

interface Log {
  info: (msg: string) => void
  error: (msg: string) => void
}

async function runScan(log: Log, reason: string): Promise<void> {
  try {
    const s = await scanAll()
    log.info(`[signals] ${reason}扫描完成:共 ${s.total},成功 ${s.ok},失败 ${s.failed},数据不足 ${s.insufficient}`)
  } catch (err) {
    log.error(`[signals] ${reason}扫描异常:${err instanceof Error ? err.message : String(err)}`)
  }
}

export function startDailyScan(log: Log): void {
  if (!isSignalsEnabled()) {
    log.info('[signals] SIGNALS=off — 不注册定时扫描')
    return
  }

  cron.schedule(CRON_EXPR, () => { void runScan(log, '定时') }, { timezone: 'UTC' })
  log.info(`[signals] 已注册定时扫描 ${CRON_EXPR} (UTC)`)

  // 延迟 30 秒,不阻塞服务启动
  setTimeout(() => {
    if (!shouldBackfill(getSetting(LAST_SCAN_KEY), Date.now())) {
      log.info('[signals] 距上次扫描不足 6 小时 — 跳过启动补扫')
      return
    }
    void runScan(log, '启动补')
  }, BACKFILL_DELAY_MS).unref()
}
