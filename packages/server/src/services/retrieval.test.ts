import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hybridRetrieve, type RetrievalDeps } from './retrieval.ts'
import type { DocumentChunk } from '../types.ts'
import type { Bm25Hit } from './chunkFts.ts'

const DOC = 'd1'

function vec(chunk_index: number, distance: number): DocumentChunk {
  return {
    doc_id: DOC, filename: 'r.md', chunk_index, content: `正文${chunk_index}`,
    distance, section_title: `§${chunk_index}`, section_slug: `s${chunk_index}`,
  }
}

function bm(chunk_index: number, score: number): Bm25Hit {
  return {
    doc_id: DOC, chunk_index, section_title: `§${chunk_index}`, section_slug: `s${chunk_index}`,
    content: `正文${chunk_index}`, score,
  }
}

function deps(vecHits: DocumentChunk[], bmHits: Bm25Hit[]): RetrievalDeps {
  return {
    vectorSearch: async () => vecHits,
    keywordSearch: () => bmHits,
  }
}

const idxs = (r: { chunks: DocumentChunk[] }) => r.chunks.map(c => c.chunk_index)

test('两路都靠前的块被融合到最前', async () => {
  // 向量: 9 8 7   BM25: 7 9
  // 7 在 BM25 第 1、向量第 3;9 在向量第 1、BM25 第 2 —— 都有双份证据
  const r = await hybridRetrieve('毛利率是多少', DOC, deps(
    [vec(9, 0.60), vec(8, 0.62), vec(7, 0.65)],
    [bm(7, -2.0), bm(9, -1.5)],
  ))
  assert.deepEqual(idxs(r).slice(0, 2).sort(), [7, 9])
})

// 线上实测过:问「腾讯去年赚了多少钱」时 BM25 零召回,
// 融合结果必须原样保留向量名次,不能因为多接一路就被搅乱。
test('BM25 零召回时结果等于纯向量', async () => {
  const r = await hybridRetrieve('腾讯去年赚了多少钱', DOC, deps([vec(3, 0.5), vec(1, 0.6), vec(2, 0.7)], []))
  assert.deepEqual(idxs(r), [3, 1, 2])
})

test('只有 BM25 命中时也能返回结果', async () => {
  const r = await hybridRetrieve('ERR_AUTH_1042', DOC, deps([], [bm(5, -3.0)]))
  assert.deepEqual(idxs(r), [5])
})

test('截断到 maxK', async () => {
  const r = await hybridRetrieve('q', DOC, deps([vec(1, .1), vec(2, .2), vec(3, .3)], []), { maxK: 2 })
  assert.equal(r.chunks.length, 2)
})

// BM25 单路命中的块没有 cosine 距离。用 null 明确表示「没有」,
// 而不是 0 或 NaN —— 0 会被误读成「距离极近」,NaN 会污染 toFixed。
test('仅 BM25 命中的块 distance 为 null', async () => {
  const r = await hybridRetrieve('q', DOC, deps([], [bm(5, -3.0)]))
  assert.equal(r.chunks[0].distance, null)
})

test('两路都命中时保留向量路的 distance', async () => {
  const r = await hybridRetrieve('q', DOC, deps([vec(7, 0.65)], [bm(7, -2.0)]))
  assert.equal(r.chunks[0].distance, 0.65)
})

test('仅 BM25 命中的块带着 section_slug,溯源回链不会断', async () => {
  const r = await hybridRetrieve('q', DOC, deps([], [bm(5, -3.0)]))
  assert.equal(r.chunks[0].section_slug, 's5')
})

test('meta 记录两路各自名次与召回数,供 trace 排查', async () => {
  const r = await hybridRetrieve('q', DOC, deps([vec(9, .6), vec(7, .65)], [bm(7, -2)]))
  assert.equal(r.meta.vectorCount, 2)
  assert.equal(r.meta.bm25Count, 1)
  const seven = r.meta.ranks.find(x => x.chunk_index === 7)!
  assert.deepEqual([seven.vectorRank, seven.bm25Rank], [2, 1])
  const nine = r.meta.ranks.find(x => x.chunk_index === 9)!
  assert.deepEqual([nine.vectorRank, nine.bm25Rank], [1, null])
})

// 检索的两条腿要能各自独立倒下。向量路挂过一次真事故:embedding 配额耗尽,
// searchChunks 静默返回空,整站每个回答都变成零依据生成且无人察觉。
test('向量路抛错时降级为纯 BM25,不整体失败', async () => {
  const r = await hybridRetrieve('q', DOC, {
    vectorSearch: async () => { throw new Error('embedding 429') },
    keywordSearch: () => [bm(5, -3)],
  })
  assert.deepEqual(idxs(r), [5])
  assert.equal(r.meta.degraded, 'vector_failed')
})

test('BM25 路抛错时降级为纯向量,不整体失败', async () => {
  const r = await hybridRetrieve('q', DOC, {
    vectorSearch: async () => [vec(1, .5)],
    keywordSearch: () => { throw new Error('fts broken') },
  })
  assert.deepEqual(idxs(r), [1])
  assert.equal(r.meta.degraded, 'bm25_failed')
})

test('两路都空时返回空结果而不是抛错', async () => {
  const r = await hybridRetrieve('q', DOC, deps([], []))
  assert.deepEqual(r.chunks, [])
  assert.equal(r.meta.degraded, 'both_empty')
})

test('两路都挂时标记 both_failed', async () => {
  const r = await hybridRetrieve('q', DOC, {
    vectorSearch: async () => { throw new Error('x') },
    keywordSearch: () => { throw new Error('y') },
  })
  assert.deepEqual(r.chunks, [])
  assert.equal(r.meta.degraded, 'both_failed')
})

test('正常情况下 degraded 为 null', async () => {
  const r = await hybridRetrieve('q', DOC, deps([vec(1, .5)], [bm(1, -2)]))
  assert.equal(r.meta.degraded, null)
})
