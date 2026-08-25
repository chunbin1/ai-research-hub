// packages/server/src/services/retrieval.ts
//
// 混合检索:向量路 + BM25 路并发召回,RRF 按名次融合。
//
// 两路各补对方的盲区(实测,腾讯篇 47 块,目标是那张毛利率表):
//
//   query                  向量  BM25  RRF
//   毛利率是多少              6     4    1
//   游戏业务的竞争格局          4     2    1
//   云业务毛利率怎么样          3     4    1
//   腾讯去年赚了多少钱(负样本)  11     —   11
//
// 前三行:两路单独都进不了第 1,融合后都是第 1。
// 最后一行:口语提问和书面原文零字面重叠,BM25 零召回,融合原样保留向量名次。

import type { DocumentChunk } from '../types.js'
import type { Bm25Hit } from './chunkFts.js'
import { reciprocalRankFusion } from './rrf.js'
import { RAG } from './ragConfig.js'

export interface RetrievalDeps {
  vectorSearch: (query: string, docId: string) => Promise<DocumentChunk[]>
  keywordSearch: (query: string, docId: string, limit: number) => Bm25Hit[]
}

export type DegradeReason =
  | 'vector_failed'   // 向量路抛错(embedding 配额耗尽 / Chroma 挂了),降级为纯 BM25
  | 'bm25_failed'     // BM25 路抛错,降级为纯向量
  | 'both_failed'     // 两路都挂
  | 'both_empty'      // 两路都正常但都没召回
  | null

export interface RetrievalMeta {
  vectorCount: number
  bm25Count: number
  /** 每个入选块在两路里的名次,融合后顺序。没有它,调 RRF 的 k 值就是盲调。 */
  ranks: Array<{
    chunk_index: number
    vectorRank: number | null
    bm25Rank: number | null
    score: number
  }>
  degraded: DegradeReason
}

export interface HybridResult {
  chunks: DocumentChunk[]
  meta: RetrievalMeta
}

/** BM25 命中转成统一形状。distance 为 null —— 它没有向量距离,别用 0 冒充。 */
function toChunk(hit: Bm25Hit): DocumentChunk {
  return {
    doc_id: hit.doc_id,
    filename: '',
    chunk_index: hit.chunk_index,
    content: hit.content,
    distance: null,
    section_title: hit.section_title,
    section_slug: hit.section_slug,
  }
}

export async function hybridRetrieve(
  query: string,
  docId: string,
  deps: RetrievalDeps,
  opts: { maxK?: number; k?: number; poolSize?: number } = {},
): Promise<HybridResult> {
  const maxK = opts.maxK ?? RAG.maxK
  const poolSize = opts.poolSize ?? RAG.poolSize

  // 两路独立成败:一条腿断了另一条要能继续走。向量路挂过一次真事故 ——
  // embedding 配额耗尽,searchChunks 静默返回空,整站每个回答都变成
  // 零依据生成且持续多日无人察觉。
  const [vecRes, bmRes] = await Promise.allSettled([
    deps.vectorSearch(query, docId),
    Promise.resolve().then(() => deps.keywordSearch(query, docId, poolSize)),
  ])

  const vectorFailed = vecRes.status === 'rejected'
  const bm25Failed = bmRes.status === 'rejected'
  const vectorHits = vecRes.status === 'fulfilled' ? vecRes.value : []
  const bm25Hits = bmRes.status === 'fulfilled' ? bmRes.value.map(toChunk) : []

  // 向量路放在前面:同一个块在两路都命中时,RRF 保留首次出现的对象,
  // 于是保住向量路那份真实的 distance。
  const fused = reciprocalRankFusion(
    [vectorHits, bm25Hits],
    c => `${c.doc_id}#${c.chunk_index}`,
    { k: opts.k, limit: maxK },
  )

  const degraded: DegradeReason =
    vectorFailed && bm25Failed ? 'both_failed'
    : vectorFailed ? 'vector_failed'
    : bm25Failed ? 'bm25_failed'
    : fused.length === 0 ? 'both_empty'
    : null

  return {
    chunks: fused.map(f => f.item),
    meta: {
      vectorCount: vectorHits.length,
      bm25Count: bm25Hits.length,
      ranks: fused.map(f => ({
        chunk_index: f.item.chunk_index,
        vectorRank: f.ranks[0],
        bm25Rank: f.ranks[1],
        score: Number(f.score.toFixed(6)),
      })),
      degraded,
    },
  }
}
