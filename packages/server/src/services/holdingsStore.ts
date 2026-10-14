// packages/server/src/services/holdingsStore.ts
//
// 一份实盘持仓快照。第三方 PUT 全量覆盖:元数据一行记整份快照的更新时间,
// 持仓行跟着一起换掉。空数组即清空,读接口回到「从未上传」。
// 仓位占比不落库,读的时候按市值合计现算 —— 口径改了也不会留下旧比例。
import type { DB } from './db.js'

export interface HoldingInput {
  symbol: string
  name: string | null
  shares: number
  marketValue: number
  cost: number
  pnl: number
}

export interface HoldingView extends HoldingInput {
  /** 市值 / 市值合计。合计为 0 时为 0,避免除零。 */
  weight: number
}

export interface HoldingsSnapshot {
  updatedAt: string | null
  holdings: HoldingView[]
}

interface HoldingRow {
  symbol: string
  name: string | null
  shares: number
  market_value: number
  cost: number
  pnl: number
}

let _db: DB | null = null

export function initHoldingsTables(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS holdings_meta (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS holdings_positions (
      symbol       TEXT PRIMARY KEY,
      name         TEXT,
      shares       REAL NOT NULL,
      market_value REAL NOT NULL,
      cost         REAL NOT NULL,
      pnl          REAL NOT NULL,
      sort_order   INTEGER NOT NULL
    );
  `)
}

function db(): DB {
  if (!_db) throw new Error('holdingsStore 未初始化 —— 先调用 initHoldingsTables()')
  return _db
}

function withWeights(rows: HoldingRow[]): HoldingView[] {
  const total = rows.reduce((sum, row) => sum + row.market_value, 0)
  return rows.map(row => ({
    symbol: row.symbol,
    name: row.name,
    shares: row.shares,
    marketValue: row.market_value,
    cost: row.cost,
    pnl: row.pnl,
    weight: total === 0 ? 0 : row.market_value / total,
  }))
}

export function getHoldingsSnapshot(): HoldingsSnapshot {
  const database = db()
  const meta = database.prepare('SELECT updated_at FROM holdings_meta WHERE id = 1').get() as
    | { updated_at: string }
    | undefined
  const rows = database.prepare(`
    SELECT symbol, name, shares, market_value, cost, pnl
    FROM holdings_positions
    ORDER BY sort_order ASC
  `).all() as HoldingRow[]
  // 没有元数据或一行都没有,都当成「没有持仓」:导航和 /holdings 靠这个判断藏起来。
  if (!meta || rows.length === 0) return { updatedAt: null, holdings: [] }
  return { updatedAt: meta.updated_at, holdings: withWeights(rows) }
}

/** 整份替换。rows 为空则两张表都清空,updatedAt 不保留。 */
export function replaceHoldings(rows: HoldingInput[], updatedAt: string): HoldingsSnapshot {
  const database = db()
  const deletePositions = database.prepare('DELETE FROM holdings_positions')
  const deleteMeta = database.prepare('DELETE FROM holdings_meta')
  const insertMeta = database.prepare('INSERT INTO holdings_meta (id, updated_at) VALUES (1, ?)')
  const insertPosition = database.prepare(`
    INSERT INTO holdings_positions (symbol, name, shares, market_value, cost, pnl, sort_order)
    VALUES (@symbol, @name, @shares, @market_value, @cost, @pnl, @sort_order)
  `)
  database.transaction(() => {
    deletePositions.run()
    deleteMeta.run()
    if (rows.length === 0) return
    insertMeta.run(updatedAt)
    rows.forEach((row, index) => insertPosition.run({
      symbol: row.symbol,
      name: row.name,
      shares: row.shares,
      market_value: row.marketValue,
      cost: row.cost,
      pnl: row.pnl,
      sort_order: index,
    }))
  })()
  return getHoldingsSnapshot()
}
