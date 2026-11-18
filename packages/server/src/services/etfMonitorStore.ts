// packages/server/src/services/etfMonitorStore.ts
//
// A 股宽基 ETF 托底监控持久化层：
// - etf_universe：标的池（首次建表自动种入 18 只预置宽基）
// - etf_daily_metrics：单只 ETF 日度放量/溢价/份额净申赎明细
// - etf_daily_summary：全市场每日共振状态汇总
import type { DB } from './db.js'

export type EtfTier = 'mega' | 'mid' | 'small' | 'growth'
export type NavSource = 'official' | 'iopv'
export type ShareSource = 'sse_history' | 'snapshot'
export type SignalLevel = 'strong_support' | 'inflow_only' | 'volume_only' | 'normal'
export type ResonanceLevel = 'strong' | 'watch' | 'none'
export type DataStage = 'preliminary' | 'nav_ready' | 'partial_shares' | 'complete'

export interface EtfUniverseEntry {
  code: string
  market: 'SH' | 'SZ'
  name: string
  tier: EtfTier
  enabled: boolean
  sort_order: number
  created_at: string
}

export interface EtfDailyMetricRow {
  code: string
  trade_date: string
  open: number
  close: number
  pct_change: number | null
  volume: number
  amount: number
  vol_ratio_5: number | null
  vol_ratio_20: number | null
  nav: number | null
  nav_source: NavSource | null
  premium_rate: number | null
  total_shares: number | null
  share_source: ShareSource | null
  share_delta: number | null
  net_inflow_yi: number | null
  signal_level: SignalLevel
  updated_at: string
}

export interface EtfDailySummaryRow {
  trade_date: string
  resonance_level: ResonanceLevel
  active_count: number
  volume_spike_count: number
  support_etf_count: number
  support_tier_count: number
  total_amount_yi: number
  aggregate_vol_ratio: number | null
  total_net_inflow_yi: number | null
  data_stage: DataStage
  updated_at: string
}

export const PRESET_ETF_UNIVERSE: ReadonlyArray<Omit<EtfUniverseEntry, 'enabled' | 'created_at'>> = [
  // 超大盘权重（6）
  { code: '510050', market: 'SH', name: '上证50ETF华夏', tier: 'mega', sort_order: 10 },
  { code: '510300', market: 'SH', name: '沪深300ETF华泰柏瑞', tier: 'mega', sort_order: 20 },
  { code: '510310', market: 'SH', name: '沪深300ETF易方达', tier: 'mega', sort_order: 30 },
  { code: '510330', market: 'SH', name: '沪深300ETF华夏', tier: 'mega', sort_order: 40 },
  { code: '159919', market: 'SZ', name: '沪深300ETF嘉实', tier: 'mega', sort_order: 50 },
  { code: '512050', market: 'SH', name: 'A500ETF华夏', tier: 'mega', sort_order: 60 },
  // 中盘均衡（2）
  { code: '510500', market: 'SH', name: '中证500ETF南方', tier: 'mid', sort_order: 70 },
  { code: '512500', market: 'SH', name: '中证500ETF华夏', tier: 'mid', sort_order: 80 },
  // 小微盘（5）
  { code: '512100', market: 'SH', name: '中证1000ETF南方', tier: 'small', sort_order: 90 },
  { code: '159845', market: 'SZ', name: '中证1000ETF华夏', tier: 'small', sort_order: 100 },
  { code: '560010', market: 'SH', name: '中证1000ETF广发', tier: 'small', sort_order: 110 },
  { code: '159629', market: 'SZ', name: '中证1000ETF富国', tier: 'small', sort_order: 120 },
  { code: '563300', market: 'SH', name: '中证2000ETF华泰柏瑞', tier: 'small', sort_order: 130 },
  // 双创成长（5）
  { code: '159915', market: 'SZ', name: '创业板ETF易方达', tier: 'growth', sort_order: 140 },
  { code: '159952', market: 'SZ', name: '创业板ETF广发', tier: 'growth', sort_order: 150 },
  { code: '159977', market: 'SZ', name: '创业板ETF天弘', tier: 'growth', sort_order: 160 },
  { code: '588000', market: 'SH', name: '科创50ETF华夏', tier: 'growth', sort_order: 170 },
  { code: '588080', market: 'SH', name: '科创50ETF易方达', tier: 'growth', sort_order: 180 },
]

let _db: DB | null = null

function db(): DB {
  if (!_db) throw new Error('etfMonitorStore 未初始化 —— 先调用 initEtfMonitorTables()')
  return _db
}

export function initEtfMonitorTables(database: DB): void {
  _db = database
  database.exec(`
    CREATE TABLE IF NOT EXISTS etf_universe (
      code        TEXT PRIMARY KEY,
      market      TEXT NOT NULL,
      name        TEXT NOT NULL,
      tier        TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS etf_daily_metrics (
      code           TEXT NOT NULL,
      trade_date     TEXT NOT NULL,
      open           REAL NOT NULL,
      close          REAL NOT NULL,
      pct_change     REAL,
      volume         REAL NOT NULL,
      amount         REAL NOT NULL,
      vol_ratio_5    REAL,
      vol_ratio_20   REAL,
      nav            REAL,
      nav_source     TEXT,
      premium_rate   REAL,
      total_shares   REAL,
      share_source   TEXT,
      share_delta    REAL,
      net_inflow_yi  REAL,
      signal_level   TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (code, trade_date)
    );
    CREATE INDEX IF NOT EXISTS idx_etf_metrics_date ON etf_daily_metrics (trade_date DESC);
    CREATE TABLE IF NOT EXISTS etf_daily_summary (
      trade_date           TEXT PRIMARY KEY,
      resonance_level      TEXT NOT NULL,
      active_count         INTEGER NOT NULL,
      volume_spike_count   INTEGER NOT NULL,
      support_etf_count    INTEGER NOT NULL,
      support_tier_count   INTEGER NOT NULL,
      total_amount_yi      REAL NOT NULL,
      aggregate_vol_ratio  REAL,
      total_net_inflow_yi  REAL,
      data_stage           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
  `)

  const countRow = database.prepare('SELECT COUNT(*) AS n FROM etf_universe').get() as { n: number }
  if (countRow.n === 0) {
    const now = new Date().toISOString()
    const ins = database.prepare(`
      INSERT INTO etf_universe (code, market, name, tier, enabled, sort_order, created_at)
      VALUES (@code, @market, @name, @tier, 1, @sort_order, @created_at)
    `)
    database.transaction(() => {
      for (const item of PRESET_ETF_UNIVERSE) {
        ins.run({ ...item, created_at: now })
      }
    })()
  }
}

interface RawUniverseRow {
  code: string
  market: 'SH' | 'SZ'
  name: string
  tier: EtfTier
  enabled: number
  sort_order: number
  created_at: string
}

function mapUniverse(r: RawUniverseRow): EtfUniverseEntry {
  return { ...r, enabled: r.enabled === 1 }
}

export function listUniverse(opts: { enabledOnly?: boolean } = {}): EtfUniverseEntry[] {
  const where = opts.enabledOnly ? 'WHERE enabled = 1' : ''
  const rows = db().prepare(
    `SELECT * FROM etf_universe ${where} ORDER BY sort_order ASC, code ASC`,
  ).all() as RawUniverseRow[]
  return rows.map(mapUniverse)
}

export function getUniverseEntry(code: string): EtfUniverseEntry | null {
  const row = db().prepare('SELECT * FROM etf_universe WHERE code = ?').get(code) as RawUniverseRow | undefined
  return row ? mapUniverse(row) : null
}

export function addUniverseEntry(entry: {
  code: string
  market: 'SH' | 'SZ'
  name: string
  tier: EtfTier
}): EtfUniverseEntry {
  const d = db()
  const maxRow = d.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM etf_universe').get() as { m: number }
  const createdAt = new Date().toISOString()
  const sortOrder = maxRow.m + 10
  d.prepare(`
    INSERT INTO etf_universe (code, market, name, tier, enabled, sort_order, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(entry.code, entry.market, entry.name, entry.tier, sortOrder, createdAt)
  return { ...entry, enabled: true, sort_order: sortOrder, created_at: createdAt }
}

export function updateUniverseEntry(
  code: string,
  patch: { enabled?: boolean; tier?: EtfTier },
): EtfUniverseEntry | null {
  const cur = getUniverseEntry(code)
  if (!cur) return null
  const nextEnabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur.enabled ? 1 : 0)
  const nextTier = patch.tier ?? cur.tier
  db().prepare('UPDATE etf_universe SET enabled = ?, tier = ? WHERE code = ?').run(nextEnabled, nextTier, code)
  return getUniverseEntry(code)
}

export function deleteUniverseEntry(code: string): boolean {
  const d = db()
  return d.transaction(() => {
    d.prepare('DELETE FROM etf_daily_metrics WHERE code = ?').run(code)
    const info = d.prepare('DELETE FROM etf_universe WHERE code = ?').run(code)
    return info.changes > 0
  })()
}

export function getExistingMetricsForCode(code: string): EtfDailyMetricRow[] {
  return db().prepare(
    'SELECT * FROM etf_daily_metrics WHERE code = ? ORDER BY trade_date ASC',
  ).all(code) as EtfDailyMetricRow[]
}

export function upsertDailyMetrics(rows: EtfDailyMetricRow[]): void {
  if (rows.length === 0) return
  const d = db()
  const stmt = d.prepare(`
    INSERT INTO etf_daily_metrics (
      code, trade_date, open, close, pct_change, volume, amount,
      vol_ratio_5, vol_ratio_20, nav, nav_source, premium_rate,
      total_shares, share_source, share_delta, net_inflow_yi, signal_level, updated_at
    ) VALUES (
      @code, @trade_date, @open, @close, @pct_change, @volume, @amount,
      @vol_ratio_5, @vol_ratio_20, @nav, @nav_source, @premium_rate,
      @total_shares, @share_source, @share_delta, @net_inflow_yi, @signal_level, @updated_at
    )
    ON CONFLICT(code, trade_date) DO UPDATE SET
      open = excluded.open,
      close = excluded.close,
      pct_change = excluded.pct_change,
      volume = excluded.volume,
      amount = excluded.amount,
      vol_ratio_5 = excluded.vol_ratio_5,
      vol_ratio_20 = excluded.vol_ratio_20,
      nav = CASE
        WHEN excluded.nav_source = 'official' THEN excluded.nav
        WHEN etf_daily_metrics.nav_source = 'official' THEN etf_daily_metrics.nav
        ELSE COALESCE(excluded.nav, etf_daily_metrics.nav)
      END,
      nav_source = CASE
        WHEN excluded.nav_source = 'official' THEN 'official'
        WHEN etf_daily_metrics.nav_source = 'official' THEN 'official'
        ELSE COALESCE(excluded.nav_source, etf_daily_metrics.nav_source)
      END,
      premium_rate = CASE
        WHEN excluded.nav_source = 'official' THEN excluded.premium_rate
        WHEN etf_daily_metrics.nav_source = 'official' THEN etf_daily_metrics.premium_rate
        ELSE COALESCE(excluded.premium_rate, etf_daily_metrics.premium_rate)
      END,
      total_shares = COALESCE(excluded.total_shares, etf_daily_metrics.total_shares),
      share_source = CASE
        WHEN excluded.total_shares IS NOT NULL THEN excluded.share_source
        ELSE etf_daily_metrics.share_source
      END,
      share_delta = CASE
        WHEN excluded.share_delta IS NOT NULL THEN excluded.share_delta
        WHEN excluded.total_shares IS NULL THEN etf_daily_metrics.share_delta
        ELSE excluded.share_delta
      END,
      net_inflow_yi = CASE
        WHEN excluded.net_inflow_yi IS NOT NULL THEN excluded.net_inflow_yi
        WHEN excluded.total_shares IS NULL THEN etf_daily_metrics.net_inflow_yi
        ELSE excluded.net_inflow_yi
      END,
      signal_level = excluded.signal_level,
      updated_at = excluded.updated_at
  `)
  d.transaction(() => {
    for (const r of rows) stmt.run(r)
  })()
}

export function upsertDailySummaries(rows: EtfDailySummaryRow[]): void {
  if (rows.length === 0) return
  const d = db()
  const stmt = d.prepare(`
    INSERT INTO etf_daily_summary (
      trade_date, resonance_level, active_count, volume_spike_count,
      support_etf_count, support_tier_count, total_amount_yi,
      aggregate_vol_ratio, total_net_inflow_yi, data_stage, updated_at
    ) VALUES (
      @trade_date, @resonance_level, @active_count, @volume_spike_count,
      @support_etf_count, @support_tier_count, @total_amount_yi,
      @aggregate_vol_ratio, @total_net_inflow_yi, @data_stage, @updated_at
    )
    ON CONFLICT(trade_date) DO UPDATE SET
      resonance_level = excluded.resonance_level,
      active_count = excluded.active_count,
      volume_spike_count = excluded.volume_spike_count,
      support_etf_count = excluded.support_etf_count,
      support_tier_count = excluded.support_tier_count,
      total_amount_yi = excluded.total_amount_yi,
      aggregate_vol_ratio = excluded.aggregate_vol_ratio,
      total_net_inflow_yi = excluded.total_net_inflow_yi,
      data_stage = excluded.data_stage,
      updated_at = excluded.updated_at
  `)
  d.transaction(() => {
    for (const r of rows) stmt.run(r)
  })()
}

export function deleteSummaryDatesNotIn(validDates: string[]): void {
  const d = db()
  if (validDates.length === 0) {
    d.prepare('DELETE FROM etf_daily_summary').run()
    return
  }
  const placeholders = validDates.map(() => '?').join(',')
  d.prepare(`DELETE FROM etf_daily_summary WHERE trade_date NOT IN (${placeholders})`).run(...validDates)
}

export function getBoardByDate(tradeDate?: string): {
  summary: EtfDailySummaryRow | null
  metrics: EtfDailyMetricRow[]
  availableDates: string[]
} {
  const d = db()
  const dates = (d.prepare(
    'SELECT trade_date FROM etf_daily_summary ORDER BY trade_date DESC LIMIT 365',
  ).all() as Array<{ trade_date: string }>).map(r => r.trade_date)

  const targetDate = tradeDate ?? dates[0]
  if (!targetDate) {
    return { summary: null, metrics: [], availableDates: [] }
  }
  const summary = (d.prepare(
    'SELECT * FROM etf_daily_summary WHERE trade_date = ?',
  ).get(targetDate) as EtfDailySummaryRow | undefined) ?? null
  const metrics = d.prepare(
    'SELECT * FROM etf_daily_metrics WHERE trade_date = ?',
  ).all(targetDate) as EtfDailyMetricRow[]
  return { summary, metrics, availableDates: dates }
}

export function getAllMetricsGroupedByDate(): Map<string, EtfDailyMetricRow[]> {
  const rows = db().prepare(
    'SELECT * FROM etf_daily_metrics ORDER BY trade_date ASC, code ASC',
  ).all() as EtfDailyMetricRow[]
  const grouped = new Map<string, EtfDailyMetricRow[]>()
  for (const r of rows) {
    const bucket = grouped.get(r.trade_date)
    if (bucket) bucket.push(r)
    else grouped.set(r.trade_date, [r])
  }
  return grouped
}

export function getTimelineSummaries(days: number): EtfDailySummaryRow[] {
  const limit = Math.min(Math.max(Math.floor(days), 1), 365)
  const rows = db().prepare(
    'SELECT * FROM etf_daily_summary ORDER BY trade_date DESC LIMIT ?',
  ).all(limit) as EtfDailySummaryRow[]
  return rows.reverse()
}

export function getCodeHistory(code: string, days: number): EtfDailyMetricRow[] {
  const limit = Math.min(Math.max(Math.floor(days), 1), 365)
  return db().prepare(
    'SELECT * FROM etf_daily_metrics WHERE code = ? ORDER BY trade_date DESC LIMIT ?',
  ).all(code, limit) as EtfDailyMetricRow[]
}

export interface EtfCodePerformance {
  return_5d: number | null
  return_10d: number | null
  return_since: number | null
}

function roundPct2(val: number): number {
  return Math.round(val * 100) / 100
}

/**
 * 计算每只 ETF 截至 targetDate 的 5 日涨幅、10 日涨幅及从 targetDate 收盘至今（最新交易日）累计涨幅。
 */
export function getCodePerformanceByDate(targetDate: string): Map<string, EtfCodePerformance> {
  const d = db()
  const latestRows = d.prepare(`
    SELECT m.code, m.trade_date, m.close
    FROM etf_daily_metrics m
    INNER JOIN (
      SELECT code, MAX(trade_date) AS max_dt
      FROM etf_daily_metrics
      GROUP BY code
    ) x ON m.code = x.code AND m.trade_date = x.max_dt
  `).all() as Array<{ code: string; trade_date: string; close: number }>
  const latestByCode = new Map(latestRows.map(r => [r.code, r]))

  const trailingRows = d.prepare(`
    SELECT code, trade_date, close
    FROM (
      SELECT code, trade_date, close,
             ROW_NUMBER() OVER (PARTITION BY code ORDER BY trade_date DESC) AS rn
      FROM etf_daily_metrics
      WHERE trade_date <= ?
    )
    WHERE rn <= 11
    ORDER BY code ASC, trade_date DESC
  `).all(targetDate) as Array<{ code: string; trade_date: string; close: number }>

  const grouped = new Map<string, Array<{ trade_date: string; close: number }>>()
  for (const r of trailingRows) {
    const arr = grouped.get(r.code)
    if (arr) arr.push(r)
    else grouped.set(r.code, [r])
  }

  const out = new Map<string, EtfCodePerformance>()
  for (const [code, rowsDesc] of grouped.entries()) {
    const head = rowsDesc[0]
    if (!head || head.trade_date !== targetDate || head.close <= 0) continue

    const base5 = rowsDesc[5]
    const base10 = rowsDesc[10]
    const latest = latestByCode.get(code)

    out.set(code, {
      return_5d: base5 && base5.close > 0 ? roundPct2(((head.close - base5.close) / base5.close) * 100) : null,
      return_10d: base10 && base10.close > 0 ? roundPct2(((head.close - base10.close) / base10.close) * 100) : null,
      return_since: latest && latest.trade_date > targetDate && latest.close > 0
        ? roundPct2(((latest.close - head.close) / head.close) * 100)
        : null,
    })
  }
  return out
}
