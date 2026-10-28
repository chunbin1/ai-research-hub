// 13F 申报和持仓。和 holdings_*、signal_* 不共用表。
// ticker 不写进行里：公司名表更新后，读的时候重新配。
import type { DB } from '../db.js'
import type { AggregatedPosition } from './parser.js'
import { WHALE_SEEDS, type WhaleSource } from './seed.js'
import type { ValueUnit } from './valueUnit.js'

export interface WhaleInstitution {
  slug: string
  nameZh: string
  nameEn: string
  manager: string
  cik: string
  sortOrder: number
  source: WhaleSource
}

export interface WhaleFiling {
  id: number
  slug: string
  accession: string
  form: string
  reportPeriod: string
  filedAt: string
  sourceUrl: string
  valueUnit: ValueUnit
  fetchedAt: string
  /** '' 为原报；修正案为 RESTATEMENT 或 NEW HOLDINGS（已并入原报）。null 是加这一列之前入库的旧行。 */
  amendmentType: string | null
}

export interface SyncState {
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
}

export interface ReplaceFilingInput {
  slug: string
  accession: string
  form: string
  reportPeriod: string
  filedAt: string
  sourceUrl: string
  valueUnit: ValueUnit
  fetchedAt: string
  /** 省略当原报 ''。 */
  amendmentType?: string
  positions: AggregatedPosition[]
}

let _db: DB | null = null

export function initWhaleTables(db: DB): void {
  _db = db
  db.exec(`
    CREATE TABLE IF NOT EXISTS whale_institutions (
      slug       TEXT PRIMARY KEY,
      name_zh    TEXT NOT NULL,
      name_en    TEXT NOT NULL,
      manager    TEXT NOT NULL,
      cik        TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      source     TEXT NOT NULL DEFAULT 'sec-13f'
    );
    CREATE TABLE IF NOT EXISTS whale_filings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL,
      accession     TEXT NOT NULL,
      form          TEXT NOT NULL,
      report_period TEXT NOT NULL,
      filed_at      TEXT NOT NULL,
      source_url    TEXT NOT NULL,
      value_unit    TEXT NOT NULL,
      fetched_at    TEXT NOT NULL,
      UNIQUE (slug, report_period)
    );
    CREATE TABLE IF NOT EXISTS whale_positions (
      filing_id      INTEGER NOT NULL,
      cusip          TEXT NOT NULL,
      put_call       TEXT NOT NULL,
      share_type     TEXT NOT NULL,
      issuer_name    TEXT NOT NULL,
      title_of_class TEXT NOT NULL,
      shares         REAL NOT NULL,
      value_usd      REAL NOT NULL,
      value_reported REAL NOT NULL,
      value_label    TEXT,
      PRIMARY KEY (filing_id, cusip, put_call, share_type)
    );
    CREATE TABLE IF NOT EXISTS whale_sync (
      slug             TEXT PRIMARY KEY,
      last_attempt_at  TEXT,
      last_success_at  TEXT,
      last_error       TEXT
    );
    CREATE TABLE IF NOT EXISTS whale_meta (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      last_sync_at        TEXT,
      tickers_fetched_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS sec_company_tickers (
      ticker TEXT PRIMARY KEY,
      title  TEXT NOT NULL,
      cik    TEXT NOT NULL
    );
  `)
  // 表已存在时 CREATE TABLE 不会补列。先补列，再收掉重复 CIK，再建唯一索引。
  addColumn(db, 'whale_institutions', 'source', `TEXT NOT NULL DEFAULT 'sec-13f'`)
  addColumn(db, 'whale_positions', 'value_label', 'TEXT')
  addColumn(db, 'whale_filings', 'amendment_type', 'TEXT')
  collapseDuplicateCiks(db)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_whale_institutions_cik ON whale_institutions (cik)')
  const holderOf = db.prepare(`
    SELECT slug FROM whale_institutions WHERE cik = ? AND slug != ?
  `)
  const upsert = db.prepare(`
    INSERT INTO whale_institutions (slug, name_zh, name_en, manager, cik, sort_order, source)
    VALUES (@slug, @nameZh, @nameEn, @manager, @cik, @sortOrder, @source)
    ON CONFLICT(slug) DO UPDATE SET
      name_zh = excluded.name_zh,
      name_en = excluded.name_en,
      manager = excluded.manager,
      cik = excluded.cik,
      sort_order = excluded.sort_order,
      source = excluded.source
  `)
  for (const seed of WHALE_SEEDS) {
    // 删掉种子后又用同一 CIK 加了别人时，不要把种子写回去造成两行。
    const holder = holderOf.get(seed.cik, seed.slug) as { slug: string } | undefined
    if (holder) {
      console.warn(`[whales] 跳过种子 ${seed.slug}：CIK ${seed.cik} 已被 ${holder.slug} 占用`)
      continue
    }
    try {
      upsert.run({ ...seed, source: seed.source ?? 'sec-13f' })
    } catch (err) {
      if (!isInstitutionConstraint(err)) throw err
      console.warn(`[whales] 跳过种子 ${seed.slug}：CIK ${seed.cik} 写入冲突`)
    }
  }
}

/** 同一 CIK 留最早写入的一行，并清掉后来那行的申报。 */
function collapseDuplicateCiks(database: DB): void {
  const dupes = database.prepare(`
    SELECT cik FROM whale_institutions GROUP BY cik HAVING COUNT(*) > 1
  `).all() as { cik: string }[]
  for (const { cik } of dupes) {
    const rows = database.prepare(`
      SELECT rowid AS id, slug FROM whale_institutions WHERE cik = ? ORDER BY rowid
    `).all(cik) as { id: number; slug: string }[]
    const keep = rows[0]
    for (const extra of rows.slice(1)) {
      console.warn(`[whales] CIK ${cik} 重复，保留 ${keep.slug}，删除 ${extra.slug}`)
      database.prepare(`
        DELETE FROM whale_positions
        WHERE filing_id IN (SELECT id FROM whale_filings WHERE slug = ?)
      `).run(extra.slug)
      database.prepare('DELETE FROM whale_filings WHERE slug = ?').run(extra.slug)
      database.prepare('DELETE FROM whale_sync WHERE slug = ?').run(extra.slug)
      database.prepare('DELETE FROM whale_institutions WHERE slug = ?').run(extra.slug)
    }
  }
}

function addColumn(database: DB, table: string, column: string, definition: string): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (cols.some(col => col.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function db(): DB {
  if (!_db) throw new Error('whale store 未初始化 —— 先调用 initWhaleTables()')
  return _db
}

interface InstitutionRow {
  slug: string
  name_zh: string
  name_en: string
  manager: string
  cik: string
  sort_order: number
  source: string | null
}

function toInstitution(row: InstitutionRow): WhaleInstitution {
  return {
    slug: row.slug,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    manager: row.manager,
    cik: row.cik,
    sortOrder: row.sort_order,
    source: row.source === 'house-fd' ? 'house-fd' : 'sec-13f',
  }
}

export function listInstitutions(): WhaleInstitution[] {
  const rows = db().prepare(`
    SELECT slug, name_zh, name_en, manager, cik, sort_order, source
    FROM whale_institutions
    ORDER BY sort_order, slug
  `).all() as InstitutionRow[]
  return rows.map(toInstitution)
}

export class WhaleWriteError extends Error {
  constructor(readonly code: 'slug_taken' | 'cik_taken', message: string) {
    super(message)
  }
}

/** 管理员新加的机构排在已有名单后面。slug、CIK 与现有行冲突则抛 WhaleWriteError。 */
export function insertInstitution(input: Omit<WhaleInstitution, 'sortOrder' | 'source'>): WhaleInstitution {
  const database = db()
  const existing = listInstitutions()
  if (existing.some(row => row.slug === input.slug)) {
    throw new WhaleWriteError('slug_taken', `短名 ${input.slug} 已被使用`)
  }
  if (existing.some(row => row.cik === input.cik)) {
    throw new WhaleWriteError('cik_taken', `CIK ${input.cik} 已在列表中`)
  }
  const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1
  try {
    database.prepare(`
      INSERT INTO whale_institutions (slug, name_zh, name_en, manager, cik, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.slug, input.nameZh, input.nameEn, input.manager, input.cik, sortOrder)
  } catch (err) {
    if (!isInstitutionConstraint(err)) throw err
    const message = err instanceof Error ? err.message : ''
    if (message.includes('.cik')) {
      throw new WhaleWriteError('cik_taken', `CIK ${input.cik} 已在列表中`)
    }
    throw new WhaleWriteError('slug_taken', `短名 ${input.slug} 已被使用`)
  }
  return { ...input, source: 'sec-13f', sortOrder }
}

function isInstitutionConstraint(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
}

/** 硬删机构，并清掉它的申报、持仓和同步记录。没有这家则返回 false。 */
export function deleteInstitution(slug: string): boolean {
  const database = db()
  if (!getInstitution(slug)) return false
  database.transaction(() => {
    database.prepare(`
      DELETE FROM whale_positions
      WHERE filing_id IN (SELECT id FROM whale_filings WHERE slug = ?)
    `).run(slug)
    database.prepare('DELETE FROM whale_filings WHERE slug = ?').run(slug)
    database.prepare('DELETE FROM whale_sync WHERE slug = ?').run(slug)
    database.prepare('DELETE FROM whale_institutions WHERE slug = ?').run(slug)
  })()
  return true
}

export function getInstitution(slug: string): WhaleInstitution | null {
  const row = db().prepare(`
    SELECT slug, name_zh, name_en, manager, cik, sort_order, source
    FROM whale_institutions WHERE slug = ?
  `).get(slug) as InstitutionRow | undefined
  return row ? toInstitution(row) : null
}

interface FilingRow {
  id: number
  slug: string
  accession: string
  form: string
  report_period: string
  filed_at: string
  source_url: string
  value_unit: ValueUnit
  fetched_at: string
  amendment_type: string | null
}

function toFiling(row: FilingRow): WhaleFiling {
  return {
    id: row.id,
    slug: row.slug,
    accession: row.accession,
    form: row.form,
    reportPeriod: row.report_period,
    filedAt: row.filed_at,
    sourceUrl: row.source_url,
    valueUnit: row.value_unit,
    fetchedAt: row.fetched_at,
    amendmentType: row.amendment_type,
  }
}

export function listFilings(slug: string): WhaleFiling[] {
  const rows = db().prepare(`
    SELECT id, slug, accession, form, report_period, filed_at, source_url, value_unit, fetched_at, amendment_type
    FROM whale_filings
    WHERE slug = ?
    ORDER BY report_period DESC
  `).all(slug) as FilingRow[]
  return rows.map(toFiling)
}

export function getFiling(slug: string, reportPeriod: string): WhaleFiling | null {
  const row = db().prepare(`
    SELECT id, slug, accession, form, report_period, filed_at, source_url, value_unit, fetched_at, amendment_type
    FROM whale_filings
    WHERE slug = ? AND report_period = ?
  `).get(slug, reportPeriod) as FilingRow | undefined
  return row ? toFiling(row) : null
}

interface PositionRow {
  cusip: string
  put_call: '' | 'Put' | 'Call'
  share_type: string
  issuer_name: string
  title_of_class: string
  shares: number
  value_usd: number
  value_reported: number
  value_label: string | null
}

export function listPositions(filingId: number): AggregatedPosition[] {
  const rows = db().prepare(`
    SELECT cusip, put_call, share_type, issuer_name, title_of_class, shares, value_usd, value_reported, value_label
    FROM whale_positions
    WHERE filing_id = ?
  `).all(filingId) as PositionRow[]
  return rows.map(row => ({
    cusip: row.cusip,
    putCall: row.put_call,
    shareType: row.share_type,
    issuerName: row.issuer_name,
    titleOfClass: row.title_of_class,
    shares: row.shares,
    valueUsd: row.value_usd,
    valueReported: row.value_reported,
    valueLabel: row.value_label,
  }))
}

export function replaceFiling(input: ReplaceFilingInput): void {
  const database = db()
  const findExisting = database.prepare('SELECT id FROM whale_filings WHERE slug = ? AND report_period = ?')
  const deletePositions = database.prepare('DELETE FROM whale_positions WHERE filing_id = ?')
  const deleteFiling = database.prepare('DELETE FROM whale_filings WHERE id = ?')
  const insertFiling = database.prepare(`
    INSERT INTO whale_filings (
      slug, accession, form, report_period, filed_at, source_url, value_unit, fetched_at, amendment_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertPosition = database.prepare(`
    INSERT INTO whale_positions (
      filing_id, cusip, put_call, share_type, issuer_name, title_of_class, shares, value_usd, value_reported, value_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  database.transaction(() => {
    const existing = findExisting.get(input.slug, input.reportPeriod) as { id: number } | undefined
    if (existing) {
      deletePositions.run(existing.id)
      deleteFiling.run(existing.id)
    }
    const info = insertFiling.run(
      input.slug,
      input.accession,
      input.form,
      input.reportPeriod,
      input.filedAt,
      input.sourceUrl,
      input.valueUnit,
      input.fetchedAt,
      input.amendmentType ?? '',
    )
    const filingId = Number(info.lastInsertRowid)
    for (const row of input.positions) {
      insertPosition.run(
        filingId,
        row.cusip,
        row.putCall,
        row.shareType,
        row.issuerName,
        row.titleOfClass,
        row.shares,
        row.valueUsd,
        row.valueReported,
        row.valueLabel ?? null,
      )
    }
  })()
}

export function getSync(slug: string): SyncState {
  const row = db().prepare(`
    SELECT last_attempt_at, last_success_at, last_error FROM whale_sync WHERE slug = ?
  `).get(slug) as { last_attempt_at: string | null; last_success_at: string | null; last_error: string | null } | undefined
  return {
    lastAttemptAt: row?.last_attempt_at ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
    lastError: row?.last_error ?? null,
  }
}

export function markSync(slug: string, at: string, error: string | null): void {
  const database = db()
  if (error) {
    database.prepare(`
      INSERT INTO whale_sync (slug, last_attempt_at, last_success_at, last_error)
      VALUES (?, ?, NULL, ?)
      ON CONFLICT(slug) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_error = excluded.last_error
    `).run(slug, at, error)
    return
  }
  database.prepare(`
    INSERT INTO whale_sync (slug, last_attempt_at, last_success_at, last_error)
    VALUES (?, ?, ?, NULL)
    ON CONFLICT(slug) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      last_success_at = excluded.last_success_at,
      last_error = NULL
  `).run(slug, at, at)
}

export function getMeta(): { lastSyncAt: string | null; tickersFetchedAt: string | null } {
  const row = db().prepare(`
    SELECT last_sync_at, tickers_fetched_at FROM whale_meta WHERE id = 1
  `).get() as { last_sync_at: string | null; tickers_fetched_at: string | null } | undefined
  return {
    lastSyncAt: row?.last_sync_at ?? null,
    tickersFetchedAt: row?.tickers_fetched_at ?? null,
  }
}

export function setLastSyncAt(iso: string): void {
  db().prepare(`
    INSERT INTO whale_meta (id, last_sync_at) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at
  `).run(iso)
}

export function replaceTickers(
  rows: { ticker: string; title: string; cik: string }[],
  fetchedAt: string,
): void {
  const database = db()
  const insert = database.prepare('INSERT INTO sec_company_tickers (ticker, title, cik) VALUES (?, ?, ?)')
  const touch = database.prepare(`
    INSERT INTO whale_meta (id, tickers_fetched_at) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET tickers_fetched_at = excluded.tickers_fetched_at
  `)
  database.transaction(() => {
    database.exec('DELETE FROM sec_company_tickers')
    for (const row of rows) insert.run(row.ticker, row.title, row.cik)
    touch.run(fetchedAt)
  })()
}

export function loadTickers(): { ticker: string; title: string }[] {
  return db().prepare('SELECT ticker, title FROM sec_company_tickers').all() as { ticker: string; title: string }[]
}
