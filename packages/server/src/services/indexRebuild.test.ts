import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initChunkFtsTable, searchBm25 } from './chunkFts.ts'
import { initIndexStateTable, getIndexState, putIndexState } from './indexState.ts'
import { initVersionTable, insertVersion } from './versionStore.ts'
import { parseMarkdown } from './markdownParser.ts'
import { computeGen, LEGACY_GEN } from './indexGen.ts'
import { rebuildDoc, rebuildDocs, type RebuildDeps } from './indexRebuild.ts'

// 必须切出不止一块 —— 「向量只写进去一半」这条要靠它才测得出来。
const MD = `# 腾讯生态

## 2.2 生意特征

| 环节 | 毛利率 |
|---|---|
| 游戏 | 61% |

## 2.3 竞争格局

网易是全球第二大游戏公司,自研双巨头。
`
const MD_LONGER = MD + '\n## 3.1 新增一节\n\n补充的正文内容。\n'

const genOf = (md: string) => computeGen(parseMarkdown(md).chunks)

function freshDb() {
  const db = new Database(':memory:')
  initChunkFtsTable(db)
  initIndexStateTable(db)
  initVersionTable(db)
  return db
}

/** 内存版向量库:按 id 存,id 带代次,行为与 Chroma 侧一致。 */
function fakeVectors() {
  const store = new Map<string, { docId: string; gen: string }>()
  const calls = { writes: 0, stamps: 0, deletes: [] as string[] }
  let failNext: string | null = null
  let writeOnly = -1 // ≥0 时只写这么多条,模拟写了一半

  const deps: RebuildDeps = {
    readMarkdown: () => MD,
    stampLegacy: async docId => {
      calls.stamps++
      let n = 0
      for (const [id, v] of store) {
        if (v.docId === docId && v.gen === '') { store.set(id, { docId, gen: LEGACY_GEN }); n++ }
      }
      return n
    },
    writeVectors: async (docId, _filename, chunks, gen) => {
      calls.writes++
      if (failNext) { const msg = failNext; failNext = null; throw new Error(msg) }
      const take = writeOnly >= 0 ? chunks.slice(0, writeOnly) : chunks
      for (const c of take) store.set(`${docId}_g${gen}_chunk_${c.chunk_index}`, { docId, gen })
    },
    countVectors: async (docId, gen) =>
      [...store.values()].filter(v => v.docId === docId && v.gen === gen).length,
    deleteVectors: async (docId, gen) => {
      calls.deletes.push(gen)
      for (const [id, v] of store) if (v.docId === docId && v.gen === gen) store.delete(id)
    },
    embedModel: 'embedding-3',
  }
  return {
    deps, store, calls,
    failOnce: (msg: string) => { failNext = msg },
    writePartial: (n: number) => { writeOnly = n },
    writeAll: () => { writeOnly = -1 },
    seedLegacy: (docId: string, n: number) => {
      for (let i = 0; i < n; i++) store.set(`${docId}_chunk_${i}`, { docId, gen: '' })
    },
  }
}

test('首次重建:写新代、翻转 active_gen、FTS 可查', () => {
  const db = freshDb()
  const v = fakeVectors()
  return rebuildDoc(db, 'doc_a', 1, v.deps).then(o => {
    assert.equal(o.status, 'rebuilt')
    assert.equal(o.gen, genOf(MD))
    const s = getIndexState(db, 'doc_a', 1)!
    assert.equal(s.active_gen, o.gen)
    assert.equal(s.vec_gen, o.gen)
    assert.equal(s.fts_gen, o.gen)
    assert.equal(searchBm25(db, 'doc_a', '毛利率', 10).length, 1)
  })
})

// 续传的核心:第二次跑什么都不做,尤其是不重新 embedding。
test('已经是目标代次的直接跳过,不再写向量', async () => {
  const db = freshDb()
  const v = fakeVectors()
  await rebuildDoc(db, 'doc_a', 1, v.deps)
  const writesAfterFirst = v.calls.writes

  const second = await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(second.status, 'skipped')
  assert.equal(v.calls.writes, writesAfterFirst, '跳过就不该再调 embedding')
})

// 线上真实发生过:Chroma 容器重建后向量全丢,SQLite 的状态表还在,
// 每次都判「已是最新」跳过,向量那一路一直零召回。
test('状态表说已是目标代次、但向量库里没有:照常重建补回来', async () => {
  const db = freshDb()
  const v = fakeVectors()
  const first = await rebuildDoc(db, 'doc_a', 1, v.deps)
  v.store.clear()

  const second = await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(second.status, 'rebuilt')
  assert.equal(second.gen, first.gen)
  assert.equal(await v.deps.countVectors('doc_a', first.gen!), first.chunks)
  assert.ok(!v.calls.deletes.includes(first.gen!), '同一代补写,不该回收它自己')

  const third = await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(third.status, 'skipped', '补齐之后恢复正常跳过')
})

test('原文变了则重建,并回收旧代向量', async () => {
  const db = freshDb()
  const v = fakeVectors()
  await rebuildDoc(db, 'doc_a', 1, v.deps)
  const oldGen = getIndexState(db, 'doc_a', 1)!.active_gen

  v.deps.readMarkdown = () => MD_LONGER
  const o = await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(o.status, 'rebuilt')
  assert.notEqual(o.gen, oldGen)
  assert.equal(v.calls.deletes.at(-1), oldGen, '旧代应被回收')
  assert.equal([...v.store.values()].every(x => x.gen === o.gen), true)
})

// 这条是整个设计的目的:中途失败不留下「FTS 新、向量旧」的静默错块状态。
test('写向量失败时整篇停在旧代,FTS 不动', async () => {
  const db = freshDb()
  const v = fakeVectors()
  await rebuildDoc(db, 'doc_a', 1, v.deps)
  const before = getIndexState(db, 'doc_a', 1)!

  v.deps.readMarkdown = () => MD_LONGER
  v.failOnce('embedding 配额耗尽')
  const o = await rebuildDoc(db, 'doc_a', 1, v.deps)

  assert.equal(o.status, 'failed')
  assert.match(o.error ?? '', /配额/)
  const after = getIndexState(db, 'doc_a', 1)!
  assert.deepEqual(
    { a: after.active_gen, v: after.vec_gen, f: after.fts_gen },
    { a: before.active_gen, v: before.vec_gen, f: before.fts_gen },
    '失败后三个代次都不该动',
  )
  assert.equal(searchBm25(db, 'doc_a', '补充的正文内容', 10).length, 0, 'FTS 不该提前换代')
})

// upsert 不抛错不等于写成功了。以前那个「✓ N 块」是解析出的块数,从没验过。
test('向量只写进去一半时判失败,不翻转', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.writePartial(1)
  const o = await rebuildDoc(db, 'doc_a', 1, v.deps)

  assert.equal(o.status, 'failed')
  assert.match(o.error ?? '', /实到 1 块/)
  assert.equal(getIndexState(db, 'doc_a', 1)!.active_gen, LEGACY_GEN, '没验证通过就不该翻转')
})

test('失败后修好原因重跑,这次成功', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.writePartial(1)
  assert.equal((await rebuildDoc(db, 'doc_a', 1, v.deps)).status, 'failed')

  v.writeAll()
  const o = await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(o.status, 'rebuilt')
  assert.equal(getIndexState(db, 'doc_a', 1)!.active_gen, genOf(MD))
})

// 存量向量没有代次标记。先盖 legacy 再写新代,否则 legacy 模式的查询
// (不加代次过滤)会把两代一起捞回来。
test('存量向量先被盖上 legacy 标记,再写新代', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.seedLegacy('doc_a', 3)

  await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(v.calls.stamps, 1)
  assert.equal(v.calls.deletes.includes(LEGACY_GEN), true, '翻转后旧的 legacy 代应被回收')
  assert.equal([...v.store.values()].some(x => x.gen === LEGACY_GEN), false)
})

test('原文取不到时标记 missing,不碰状态表', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.deps.readMarkdown = () => null
  const o = await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(o.status, 'missing')
  assert.equal(getIndexState(db, 'doc_a', 1), null)
})

// --no-vectors:FTS 换代了但向量没有,状态表如实记下不一致,
// 检索侧据此退成纯 BM25 —— 而不是假装两路都在。
test('withVectors=false 只换 FTS,vec_gen 保持落后', async () => {
  const db = freshDb()
  const v = fakeVectors()
  const o = await rebuildDoc(db, 'doc_a', 1, v.deps, { withVectors: false })

  assert.equal(o.status, 'rebuilt')
  assert.equal(v.calls.writes, 0)
  const s = getIndexState(db, 'doc_a', 1)!
  assert.equal(s.fts_gen, o.gen)
  assert.equal(s.active_gen, o.gen)
  assert.equal(s.vec_gen, LEGACY_GEN, '向量没建就不能说它是新代')
})

test('换 embedding 模型会让已完成的文档重新建', async () => {
  const db = freshDb()
  const v = fakeVectors()
  await rebuildDoc(db, 'doc_a', 1, v.deps)

  const o = await rebuildDoc(db, 'doc_a', 1, { ...v.deps, embedModel: 'bge-m3' })
  assert.equal(o.status, 'rebuilt', '维度都变了,存量向量必须作废重建')
  assert.equal(getIndexState(db, 'doc_a', 1)!.embed_model, 'bge-m3')
})

test('一篇失败不中断后面的', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.failOnce('第一篇挂了')
  const out = await rebuildDocs(db, ['doc_a', 'doc_b'], v.deps)

  assert.equal(out[0].status, 'failed')
  assert.equal(out[1].status, 'rebuilt')
})

test('重跑只补没做完的', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.failOnce('第一篇挂了')
  await rebuildDocs(db, ['doc_a', 'doc_b'], v.deps)

  const out = await rebuildDocs(db, ['doc_a', 'doc_b'], v.deps)
  assert.equal(out[0].status, 'rebuilt', '上次失败的这次补上')
  assert.equal(out[1].status, 'skipped', '上次成功的这次跳过')
})

test('legacy 存量在首次重建前被登记成 legacy 状态 —— 关掉混合态窗口', async () => {
  const db = freshDb()
  const v = fakeVectors()
  v.seedLegacy('doc_a', 3)
  v.failOnce('写新代时挂了')

  await rebuildDoc(db, 'doc_a', 1, v.deps)
  const s = getIndexState(db, 'doc_a', 1)!
  assert.equal(s.active_gen, LEGACY_GEN, '失败了也要有状态行,查询才会被限定在 legacy 代')
  assert.equal([...v.store.values()].every(x => x.gen === LEGACY_GEN), true)
})

test('状态行已存在时不会重复盖 legacy', async () => {
  const db = freshDb()
  const v = fakeVectors()
  putIndexState(db, {
    doc_id: 'doc_a', version: 1, active_gen: 'g0', vec_gen: 'g0', fts_gen: 'g0', embed_model: 'embedding-3',
  })
  await rebuildDoc(db, 'doc_a', 1, v.deps)
  assert.equal(v.calls.stamps, 0)
})

// ---------- 多版本 ----------

function addVersions(db: ReturnType<typeof freshDb>, docId: string, n: number) {
  for (let i = 0; i < n; i++) insertVersion(db, { doc_id: docId, filename: docId, size_bytes: 1, chunk_count: 1 })
}

test('rebuildDocs 逐个版本重建,各版本落在自己的代次上', async () => {
  const db = freshDb()
  const v = fakeVectors()
  addVersions(db, 'doc_a', 2)
  v.deps.readMarkdown = (_d, ver) => (ver === 1 ? MD : MD_LONGER)

  const out = await rebuildDocs(db, ['doc_a'], v.deps)
  assert.deepEqual(out.map(o => [o.version, o.status]), [[1, 'rebuilt'], [2, 'rebuilt']])
  assert.equal(getIndexState(db, 'doc_a', 1)!.active_gen, genOf(MD))
  assert.equal(getIndexState(db, 'doc_a', 2)!.active_gen, genOf(MD_LONGER))
  // 两代的 FTS 都在,按代次各查各的
  assert.equal(searchBm25(db, 'doc_a', '补充的正文内容', 10, genOf(MD)).length, 0)
  assert.equal(searchBm25(db, 'doc_a', '补充的正文内容', 10, genOf(MD_LONGER)).length, 1)
})

test('没有版本记录的文档按 v1 处理', async () => {
  const db = freshDb()
  const v = fakeVectors()
  const out = await rebuildDocs(db, ['doc_a'], v.deps)
  assert.deepEqual(out.map(o => o.version), [1])
})

// 两个版本切块相同就共用一代索引。重建其中一个时不能把另一个的检索打空。
test('旧代还被别的版本用着时不回收', async () => {
  const db = freshDb()
  const v = fakeVectors()
  addVersions(db, 'doc_a', 2)
  await rebuildDocs(db, ['doc_a'], v.deps)            // 两个版本都是 MD,共用一代
  const shared = genOf(MD)

  // v2 的原文换了,重建 v2
  v.deps.readMarkdown = (_d, ver) => (ver === 1 ? MD : MD_LONGER)
  const o = await rebuildDoc(db, 'doc_a', 2, v.deps)
  assert.equal(o.status, 'rebuilt')
  assert.equal(v.calls.deletes.includes(shared), false, 'v1 还在用,不能删')
  assert.equal([...v.store.values()].some(x => x.gen === shared), true)
  assert.equal(searchBm25(db, 'doc_a', '毛利率', 10, shared).length, 1, 'v1 的 FTS 也要留着')
})

test('旧代没人用了才回收,FTS 行一起清掉', async () => {
  const db = freshDb()
  const v = fakeVectors()
  addVersions(db, 'doc_a', 2)
  v.deps.readMarkdown = (_d, ver) => (ver === 1 ? MD : MD_LONGER)
  await rebuildDocs(db, ['doc_a'], v.deps)
  const oldV2 = genOf(MD_LONGER)

  // 切块规则变了的效果:v2 得到一个全新的代次
  v.deps.readMarkdown = (_d, ver) => (ver === 1 ? MD : MD_LONGER + '\n再补一句。\n')
  await rebuildDoc(db, 'doc_a', 2, v.deps)
  assert.equal(v.calls.deletes.includes(oldV2), true)
  assert.equal(searchBm25(db, 'doc_a', '补充的正文内容', 10, oldV2).length, 0)
})
