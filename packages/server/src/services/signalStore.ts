// packages/server/src/services/signalStore.ts
//
// 每日状态日志 + 信号事件。写入一律「事务内先删后插」而不是 upsert:
// 改大 ATR 周期后输出点会变少,单纯 upsert 会在库里留下旧参数算出的最早几行。
// 先删后插既幂等又不留陈旧行,失败时整体回滚。
import type { DB } from './db.js'

export type Timeframe = '1d' | '1wk'

export interface DailyState {
  symbol: string
  timeframe: Timeframe
  bar_date: string
  trend: 1 | -1
  stop_line: number
  close_adj: number
  close_raw: number
  atr: number
}

export interface SignalEvent {
  symbol: string
  timeframe: Timeframe
  bar_date: string
  direction: 1 | -1
  price: number
}

let _db: DB | null = null

export function initSignalTables(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_states (
      symbol     TEXT NOT NULL,
      timeframe  TEXT NOT NULL,
      bar_date   TEXT NOT NULL,
      trend      INTEGER NOT NULL,
      stop_line  REAL NOT NULL,
      close_adj  REAL NOT NULL,
      close_raw  REAL NOT NULL,
      atr        REAL NOT NULL,
      PRIMARY KEY (symbol, timeframe, bar_date)
    );
    CREATE TABLE IF NOT EXISTS signal_events (
      symbol     TEXT NOT NULL,
      timeframe  TEXT NOT NULL,
      bar_date   TEXT NOT NULL,
      direction  INTEGER NOT NULL,
      price      REAL NOT NULL,
      PRIMARY KEY (symbol, timeframe, bar_date)
    );
    CREATE INDEX IF NOT EXISTS idx_events_date ON signal_events (bar_date DESC);
  `)
}

function db(): DB {
  if (!_db) throw new Error('signalStore 未初始化 —— 先调用 initSignalTables()')
  return _db
}

export function replaceStates(symbol: string, timeframe: Timeframe, rows: DailyState[]): void {
  const d = db()
  const del = d.prepare('DELETE FROM daily_states WHERE symbol = ? AND timeframe = ?')
  const ins = d.prepare(`
    INSERT INTO daily_states (symbol, timeframe, bar_date, trend, stop_line, close_adj, close_raw, atr)
    VALUES (@symbol, @timeframe, @bar_date, @trend, @stop_line, @close_adj, @close_raw, @atr)
  `)
  d.transaction(() => {
    del.run(symbol, timeframe)
    for (const r of rows) ins.run(r)
  })()
}

export function replaceEvents(symbol: string, timeframe: Timeframe, rows: SignalEvent[]): void {
  const d = db()
  const del = d.prepare('DELETE FROM signal_events WHERE symbol = ? AND timeframe = ?')
  const ins = d.prepare(`
    INSERT INTO signal_events (symbol, timeframe, bar_date, direction, price)
    VALUES (@symbol, @timeframe, @bar_date, @direction, @price)
  `)
  d.transaction(() => {
    del.run(symbol, timeframe)
    for (const r of rows) ins.run(r)
  })()
}

export function getLatestState(symbol: string, timeframe: Timeframe): DailyState | null {
  return (db().prepare(
    'SELECT * FROM daily_states WHERE symbol = ? AND timeframe = ? ORDER BY bar_date DESC LIMIT 1',
  ).get(symbol, timeframe) as DailyState) ?? null
}

export function getStates(symbol: string, timeframe: Timeframe, limit: number): DailyState[] {
  return db().prepare(
    'SELECT * FROM daily_states WHERE symbol = ? AND timeframe = ? ORDER BY bar_date DESC LIMIT ?',
  ).all(symbol, timeframe, limit) as DailyState[]
}

export function getLatestEvent(symbol: string, timeframe: Timeframe): SignalEvent | null {
  return (db().prepare(
    'SELECT * FROM signal_events WHERE symbol = ? AND timeframe = ? ORDER BY bar_date DESC LIMIT 1',
  ).get(symbol, timeframe) as SignalEvent) ?? null
}

export function countEventsSince(symbol: string, timeframe: Timeframe, sinceDate: string): number {
  const row = db().prepare(
    'SELECT COUNT(*) AS n FROM signal_events WHERE symbol = ? AND timeframe = ? AND bar_date >= ?',
  ).get(symbol, timeframe, sinceDate) as { n: number }
  return row.n
}

export function getRecentEvents(sinceDate: string): SignalEvent[] {
  // 公开接口,路由层把 days 限到 3650 —— 不加 LIMIT 的话 ?days=3650 会把整张表吐出来。
  // 客户端只用过 7 天,500 条对正常用法绰绰有余。
  return db().prepare(
    'SELECT * FROM signal_events WHERE bar_date >= ? ORDER BY bar_date DESC, symbol LIMIT 500',
  ).all(sinceDate) as SignalEvent[]
}
