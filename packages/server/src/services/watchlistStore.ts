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
  return db().prepare('SELECT * FROM watchlist ORDER BY symbol').all() as WatchlistEntry[]
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

export function setWatchlistEnabled(symbol: string, enabled: boolean): void {
  db().prepare('UPDATE watchlist SET enabled = ? WHERE symbol = ?').run(enabled ? 1 : 0, symbol)
}
