import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { MdChunk } from './markdownParser.ts'

// documentStore 在模块顶层读一次 RAW_DIR,必须在 import 它之前指到临时目录。
const RAW = mkdtempSync(join(tmpdir(), 'doc-versions-'))
process.env.RAW_DIR = RAW

const {
  initDocumentTable, saveDocument, getDocument, readRawMarkdown, readVersionMarkdown, saveRawMarkdown,
} = await import('./documentStore.ts')
const { initChunkFtsTable, searchBm25, upsertChunkFts } = await import('./chunkFts.ts')
const { initIndexStateTable, getIndexState, planRetrieval } = await import('./indexState.ts')
const { listVersions, latestVersion, getVersion } = await import('./versionStore.ts')
const { createVersion, migrateLegacyVersions, SameContentError } = await import('./documentVersion.ts')
const { computeGen, LEGACY_GEN, NO_GEN } = await import('./indexGen.ts')
const { parseMarkdown } = await import('./markdownParser.ts')

const V1 = `# 腾讯生态

## 2.2 生意特征

游戏毛利率 61%。
`
const V2 = `# 腾讯生态(Q3 更新)

## 2.2 生意特征

游戏毛利率 65%,广告回暖。
`

function freshDb() {
  const db = new Database(':memory:')
  initDocumentTable(db)
  initChunkFtsTable(db)
  initIndexStateTable(db)
  return db
}

function fakeDeps(opts: { available?: boolean } = {}) {
  const calls = { stamps: 0, writes: [] as string[] }
  let fail: string | null = null
  let gate: Promise<void> = Promise.resolve()
  return {
    calls,
    failWrites: (msg: string) => { fail = msg },
    /** 让向量写入卡住,直到调用返回的 release —— 用来观察「向量还没落库」的中间态。 */
    hold: () => { let release!: () => void; gate = new Promise(r => { release = r }); return release },
    deps: {
      vectorsAvailable: opts.available ?? true,
      stampLegacy: async () => { calls.stamps++; return 0 },
      writeVectors: async (_d: string, _f: string, _c: MdChunk[], gen: string) => {
        await gate
        if (fail) throw new Error(fail)
        calls.writes.push(gen)
      },
      embedModel: 'embedding-3',
    },
  }
}

function newDoc(md: string) {
  return saveDocument({ filename: 'x', size_bytes: md.length, chunk_count: 1 })
}

test('第一个版本:登记 v1、原文落盘、FTS 可查、向量写完后 vec_gen 翻到这一代', async () => {
  const db = freshDb()
  const doc = newDoc(V1)
  const f = fakeDeps()
  const release = f.hold()
  const created = await createVersion(db, doc.id, V1, { fallbackName: 'x' }, f.deps)
  assert.equal(created.version.version, 1)
  assert.equal(created.version.filename, '腾讯生态')
  assert.equal(readVersionMarkdown(doc.id, 1), V1)
  assert.equal(readRawMarkdown(doc.id), V1, '最新版镜像')
  assert.equal(searchBm25(db, doc.id, '毛利率', 10, created.gen).length, 1)

  assert.equal(getIndexState(db, doc.id, 1)!.vec_gen, NO_GEN, '向量落库前如实记 none')
  release()
  await created.vectors
  assert.equal(getIndexState(db, doc.id, 1)!.vec_gen, created.gen)
})

test('新版本:版本号递增,documents 刷成最新版,旧版本原文和索引都还在', async () => {
  const db = freshDb()
  const doc = newDoc(V1)
  const { deps } = fakeDeps()
  const a = await createVersion(db, doc.id, V1, { fallbackName: 'x' }, deps)
  await a.vectors
  const b = await createVersion(db, doc.id, V2, { note: '加入 Q3 数据', fallbackName: 'x' }, deps)
  await b.vectors

  assert.equal(b.version.version, 2)
  assert.equal(getVersion(db, doc.id, 2)!.note, '加入 Q3 数据')
  assert.equal(latestVersion(db, doc.id), 2)
  const d = getDocument(doc.id)!
  assert.equal(d.filename, '腾讯生态(Q3 更新)')
  assert.equal(d.latest_version, 2)
  assert.equal(readRawMarkdown(doc.id), V2)
  assert.equal(readVersionMarkdown(doc.id, 1), V1, '旧版本原文不可变')

  // 每个版本只查得到自己的内容
  const p1 = planRetrieval(getIndexState(db, doc.id, 1))
  const p2 = planRetrieval(getIndexState(db, doc.id, 2))
  assert.deepEqual(searchBm25(db, doc.id, '毛利率', 10, p1.gen).map(h => h.content.includes('61%')), [true])
  assert.deepEqual(searchBm25(db, doc.id, '毛利率', 10, p2.gen).map(h => h.content.includes('65%')), [true])
})

test('内容和最新版一致时拒绝,不产生新版本', async () => {
  const db = freshDb()
  const doc = newDoc(V1)
  const { deps } = fakeDeps()
  await createVersion(db, doc.id, V1, { fallbackName: 'x' }, deps)
  await assert.rejects(
    createVersion(db, doc.id, V1, { fallbackName: 'x' }, deps),
    (e: unknown) => e instanceof SameContentError && e.latest === 1,
  )
  assert.equal(listVersions(db, doc.id).length, 1)
})

// legacy 文档没有状态行,查询不加代次过滤。新版本一写进来,不先把旧版本钉在
// legacy 代上,v1 的查询就会把 v2 的块一起捞回来。
test('legacy 文档上传新版本前,先盖 legacy 标记并给旧版本落状态行', async () => {
  const db = freshDb()
  const doc = newDoc(V1)
  saveRawMarkdown(doc.id, V1)
  upsertChunkFts(db, doc.id, LEGACY_GEN, parseMarkdown(V1).chunks)   // 迁移后的存量 FTS 行
  migrateLegacyVersions(db)
  assert.equal(getIndexState(db, doc.id, 1), null)

  const { deps, calls } = fakeDeps()
  await createVersion(db, doc.id, V2, { fallbackName: 'x' }, deps)
  assert.equal(calls.stamps, 1)
  const s1 = getIndexState(db, doc.id, 1)!
  assert.equal(s1.active_gen, LEGACY_GEN)
  const p1 = planRetrieval(s1)
  assert.equal(p1.gen, LEGACY_GEN, 'v1 的查询被限定在 legacy 代')
  assert.equal(searchBm25(db, doc.id, '毛利率', 10, p1.gen).length, 1, '只命中 v1 自己的块')
})

test('向量库不可用时只建 BM25,不盖标记、不写向量', async () => {
  const db = freshDb()
  const doc = newDoc(V1)
  const { deps, calls } = fakeDeps({ available: false })
  const created = await createVersion(db, doc.id, V1, { fallbackName: 'x' }, deps)
  assert.equal(created.vectors, null)
  assert.equal(calls.writes.length, 0)
  assert.equal(planRetrieval(getIndexState(db, doc.id, 1)).restrict, 'bm25')
})

test('向量写失败:版本照常登记,vec_gen 停在 none,检索退成纯 BM25', async () => {
  const db = freshDb()
  const doc = newDoc(V1)
  const f = fakeDeps()
  f.failWrites('embedding 配额耗尽')
  const created = await createVersion(db, doc.id, V1, { fallbackName: 'x' }, f.deps)
  await assert.rejects(created.vectors!, /配额/)
  assert.equal(getIndexState(db, doc.id, 1)!.vec_gen, NO_GEN)
  assert.equal(planRetrieval(getIndexState(db, doc.id, 1)).restrict, 'bm25')
})

test('迁移:把没有版本记录的旧文档登记成 v1,并复制原文;再跑一次是空操作', () => {
  const db = freshDb()
  const doc = newDoc(V1)
  saveRawMarkdown(doc.id, V1)
  assert.equal(migrateLegacyVersions(db), 1)
  assert.deepEqual(listVersions(db, doc.id).map(v => v.version), [1])
  assert.equal(readVersionMarkdown(doc.id, 1), V1)
  assert.equal(getVersion(db, doc.id, 1)!.created_at, doc.created_at, '沿用首次上传的时间')
  assert.equal(migrateLegacyVersions(db), 0)
})

test('迁移:磁盘上已经有版本文件(从别的环境拷来的)就按文件登记', () => {
  const db = freshDb()
  const doc = newDoc(V2)
  saveRawMarkdown(doc.id, V2)
  mkdirSync(join(RAW, 'versions', doc.id), { recursive: true })
  writeFileSync(join(RAW, 'versions', doc.id, 'v1.md'), V1)
  writeFileSync(join(RAW, 'versions', doc.id, 'v2.md'), V2)
  migrateLegacyVersions(db)
  const vs = listVersions(db, doc.id)
  assert.deepEqual(vs.map(v => v.version), [1, 2])
  assert.equal(vs[1].filename, '腾讯生态(Q3 更新)')
  assert.equal(computeGen(parseMarkdown(readVersionMarkdown(doc.id, 2)!).chunks), computeGen(parseMarkdown(V2).chunks))
})

test('没有版本记录的文档,列表里最新版本号记为 1', () => {
  freshDb()
  const doc = newDoc(V1)
  assert.equal(getDocument(doc.id)!.latest_version, 1)
  assert.equal(getDocument(doc.id)!.updated_at, doc.created_at)
})
