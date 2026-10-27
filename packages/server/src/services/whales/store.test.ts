import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { deleteInstitution, initWhaleTables, insertInstitution, listInstitutions, WhaleWriteError } from './store.ts'

test('机构表对 CIK 有唯一索引，直接插入重复 CIK 会被拒绝', () => {
  const database = new Database(':memory:')
  initWhaleTables(database)
  const index = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_whale_institutions_cik'
  `).get() as { name: string } | undefined
  assert.equal(index?.name, 'idx_whale_institutions_cik')
  assert.throws(
    () => database.prepare(`
      INSERT INTO whale_institutions (slug, name_zh, name_en, manager, cik, sort_order)
      VALUES ('dup', '甲', 'A', '甲', '0001067983', 99)
    `).run(),
    (err: unknown) => err instanceof Error && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE',
  )
  assert.equal(listInstitutions().filter(row => row.cik === '0001067983').length, 1)
})

test('删掉种子后若 CIK 空着，重启仍会把这家写回', () => {
  const database = new Database(':memory:')
  initWhaleTables(database)
  assert.equal(deleteInstitution('scion'), true)
  initWhaleTables(database)
  const scion = listInstitutions().find(row => row.slug === 'scion')
  assert.equal(scion?.cik, '0001649339')
  assert.equal(scion?.manager, '迈克尔·伯里')
})

test('同一 CIK 已被其它 slug 占用时，重启种子跳过并记日志，不会出现两行', () => {
  const database = new Database(':memory:')
  initWhaleTables(database)
  assert.equal(deleteInstitution('berkshire'), true)
  insertInstitution({
    slug: 'other-buffett',
    nameZh: '另一家',
    nameEn: 'Other Buffett',
    manager: '别人',
    cik: '0001067983',
  })
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  try {
    initWhaleTables(database)
  } finally {
    console.warn = original
  }
  const rows = listInstitutions().filter(row => row.cik === '0001067983')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.slug, 'other-buffett')
  assert.equal(listInstitutions().some(row => row.slug === 'berkshire'), false)
  assert.ok(warnings.some(line => line.includes('berkshire') && line.includes('0001067983') && line.includes('other-buffett')))
})

test('唯一约束比应用层检查先冲突时，仍抛 cik_taken，不会留下半截行', () => {
  const database = new Database(':memory:')
  initWhaleTables(database)
  database.exec(`
    CREATE TRIGGER whale_cik_race BEFORE INSERT ON whale_institutions
    WHEN NEW.slug = 'race'
    BEGIN
      INSERT INTO whale_institutions (slug, name_zh, name_en, manager, cik, sort_order)
      VALUES ('holder', '乙', 'B', '乙', NEW.cik, 50);
    END;
  `)
  assert.throws(
    () => insertInstitution({ slug: 'race', nameZh: '甲', nameEn: 'A', manager: '甲', cik: '0000000011' }),
    (err: unknown) => err instanceof WhaleWriteError && err.code === 'cik_taken' && err.message.includes('0000000011'),
  )
  const slugs = listInstitutions().map(row => row.slug)
  assert.equal(slugs.includes('race'), false)
  assert.equal(slugs.includes('holder'), false)
})

test('已有重复 CIK 的旧库先收成最早一行，再加唯一索引', () => {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE whale_institutions (
      slug TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL,
      manager TEXT NOT NULL,
      cik TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE whale_filings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      accession TEXT NOT NULL,
      form TEXT NOT NULL,
      report_period TEXT NOT NULL,
      filed_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      value_unit TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE (slug, report_period)
    );
    CREATE TABLE whale_positions (
      filing_id INTEGER NOT NULL,
      cusip TEXT NOT NULL,
      put_call TEXT NOT NULL,
      share_type TEXT NOT NULL,
      issuer_name TEXT NOT NULL,
      title_of_class TEXT NOT NULL,
      shares REAL NOT NULL,
      value_usd REAL NOT NULL,
      value_reported REAL NOT NULL,
      PRIMARY KEY (filing_id, cusip, put_call, share_type)
    );
    CREATE TABLE whale_sync (
      slug TEXT PRIMARY KEY,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error TEXT
    );
  `)
  database.prepare(`
    INSERT INTO whale_institutions (slug, name_zh, name_en, manager, cik, sort_order)
    VALUES ('other-buffett', '另一家', 'Other', '别人', '0001067983', 9)
  `).run()
  database.prepare(`
    INSERT INTO whale_institutions (slug, name_zh, name_en, manager, cik, sort_order)
    VALUES ('berkshire', '伯克希尔', 'Berkshire', '巴菲特', '0001067983', 1)
  `).run()
  const filing = database.prepare(`
    INSERT INTO whale_filings (slug, accession, form, report_period, filed_at, source_url, value_unit, fetched_at)
    VALUES ('berkshire', '0001193125-26-000099', '13F-HR', '2026-06-30', '2026-08-14', 'https://www.sec.gov/x', 'dollars', '2026-10-27T00:00:00.000Z')
  `).run()
  database.prepare(`
    INSERT INTO whale_positions (
      filing_id, cusip, put_call, share_type, issuer_name, title_of_class, shares, value_usd, value_reported
    ) VALUES (?, '037833100', '', 'SH', 'APPLE INC', 'COM', 1, 1, 1)
  `).run(Number(filing.lastInsertRowid))
  database.prepare(`
    INSERT INTO whale_sync (slug, last_attempt_at, last_success_at, last_error)
    VALUES ('berkshire', 't', NULL, 'dup')
  `).run()

  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  try {
    initWhaleTables(database)
  } finally {
    console.warn = original
  }

  const rows = listInstitutions().filter(row => row.cik === '0001067983')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.slug, 'other-buffett')
  const index = database.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_whale_institutions_cik'
  `).get() as { name: string } | undefined
  assert.equal(index?.name, 'idx_whale_institutions_cik')
  assert.equal((database.prepare(`SELECT COUNT(*) AS n FROM whale_filings WHERE slug = 'berkshire'`).get() as { n: number }).n, 0)
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM whale_positions').get() as { n: number }).n, 0)
  assert.equal((database.prepare(`SELECT COUNT(*) AS n FROM whale_sync WHERE slug = 'berkshire'`).get() as { n: number }).n, 0)
  assert.ok(warnings.some(line => line.includes('0001067983') && line.includes('other-buffett') && line.includes('berkshire')))
})

test('应用层插入重复 CIK 或短名时抛出明确错误', () => {
  initWhaleTables(new Database(':memory:'))
  assert.throws(
    () => insertInstitution({ slug: 'other', nameZh: '甲', nameEn: 'A', manager: '甲', cik: '0001067983' }),
    (err: unknown) => err instanceof WhaleWriteError && err.code === 'cik_taken',
  )
  assert.throws(
    () => insertInstitution({ slug: 'berkshire', nameZh: '甲', nameEn: 'A', manager: '甲', cik: '0000000099' }),
    (err: unknown) => err instanceof WhaleWriteError && err.code === 'slug_taken',
  )
})
