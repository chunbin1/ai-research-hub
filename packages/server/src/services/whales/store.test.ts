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
