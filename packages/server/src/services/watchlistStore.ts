// packages/server/src/services/watchlistStore.ts
//
// 自选股。列表完全由研报标题驱动 —— 没有手动添加入口,
// 但 admin 可以禁用误抽的行(见 routes/signals.ts 的 PATCH)。
import type { DB } from './db.js'
import type { Market } from './market/symbol.js'

export type WatchStatus = 'ok' | 'invalid' | 'insufficient'

export interface WatchlistEntry {
  symbol: string
  market: Market
  name: string | null
  currency: string | null
  source_doc: string | null
  source_text: string | null
  /** 1 = 未删除,0 = 已被管理员删除(墓碑)。不是「启用/禁用」——禁用功能已移除。 */
  enabled: 0 | 1
  status: WatchStatus
  last_error: string | null
  last_scan_at: string | null
  created_at: string
}

let _db: DB | null = null

export function initWatchlistTable(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      symbol       TEXT PRIMARY KEY,
      market       TEXT NOT NULL,
      name         TEXT,
      currency     TEXT,
      source_doc   TEXT,
      source_text  TEXT,
      -- enabled 现在的语义是「未删除」而不是「启用/禁用」:0 表示已被管理员删除。
      -- 保留墓碑行是刻意的 —— addWatchlistEntry 的 ON CONFLICT DO NOTHING 会因此
      -- 直接冲突,使「重新抽取」不会把已删除的标的带回来。
      enabled      INTEGER NOT NULL DEFAULT 1,
      status       TEXT NOT NULL DEFAULT 'ok',
      last_error   TEXT,
      last_scan_at TEXT,
      created_at   TEXT NOT NULL
    );
  `)
}

function db(): DB {
  if (!_db) throw new Error('watchlistStore 未初始化 —— 先调用 initWatchlistTable()')
  return _db
}

/** 已存在则整行不动 —— 同一标的被多篇研报提及时保留最早一次的来源 */
export function addWatchlistEntry(e: {
  symbol: string
  market: Market
  sourceDoc: string | null
  sourceText: string | null
}): void {
  db().prepare(`
    INSERT INTO watchlist (symbol, market, source_doc, source_text, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO NOTHING
  `).run(e.symbol, e.market, e.sourceDoc, e.sourceText, new Date().toISOString())
}

export function listWatchlist(): WatchlistEntry[] {
  // 墓碑(enabled = 0)不返回 —— 界面上不该看到已删除的标的
  return db().prepare('SELECT * FROM watchlist WHERE enabled = 1 ORDER BY symbol').all() as WatchlistEntry[]
}

export function listScannable(): WatchlistEntry[] {
  return db().prepare(
    "SELECT * FROM watchlist WHERE enabled = 1 AND status != 'invalid' ORDER BY symbol",
  ).all() as WatchlistEntry[]
}

/** `name` / `currency` 不传就保持原值 —— 扫描失败时不该把已知的名称清掉 */
export function updateScanResult(symbol: string, patch: {
  name?: string | null
  currency?: string | null
  status: WatchStatus
  lastError: string | null
  lastScanAt: string
}): void {
  db().prepare(`
    UPDATE watchlist SET
      name         = COALESCE(?, name),
      currency     = COALESCE(?, currency),
      status       = ?,
      last_error   = ?,
      last_scan_at = ?
    WHERE symbol = ?
  `).run(
    patch.name ?? null, patch.currency ?? null,
    patch.status, patch.lastError, patch.lastScanAt, symbol,
  )
}

/**
 * 软删除。只打墓碑,不删行 —— 墓碑占着主键,使 addWatchlistEntry 的
 * ON CONFLICT DO NOTHING 直接冲突,「重新抽取」因此不会把它带回来。
 * 该标的的日志与事件由调用方(routes/signals.ts)另行清除。
 */
export function softDeleteWatchlistEntry(symbol: string): void {
  db().prepare('UPDATE watchlist SET enabled = 0 WHERE symbol = ?').run(symbol)
}

/**
 * 复活一个已删除的标的。状态一并归零 —— 若上次是因 invalid 被标记,
 * 不清掉的话它复活后仍会被 listScannable 排除在外,等于活不过来。
 */
export function reviveWatchlistEntry(symbol: string): void {
  db().prepare(
    "UPDATE watchlist SET enabled = 1, status = 'ok', last_error = NULL WHERE symbol = ?",
  ).run(symbol)
}
