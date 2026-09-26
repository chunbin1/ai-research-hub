// packages/server/src/services/reindex.ts
//
// 从原始 markdown 重建索引。
//
// 为什么必须有它:
//  1. BM25 是后加的,现有文档的 FTS 表是空的。不回填的话老文档在关键词
//     那一路永远零召回,混合检索只剩一条腿。
//  2. 切块规则一改(maxChars、标题处理),库里的旧块就和代码对不上了。
//  3. 将来换 embedding 模型时,维度变化会让所有存量向量作废
//     (当前 embedding-3 是 2048 维,bge-m3 是 1024 维),必须整体重建。
//
// 原文存在 data/raw/*.md,重建 FTS 不需要任何 API 调用。

import type { DB } from './db.js'
import { parseMarkdown } from './markdownParser.js'
import { upsertChunkFts, deleteChunkFtsGen, listFtsGens } from './chunkFts.js'
import { computeGen } from './indexGen.js'
import { getIndexState, setFtsGen, isGenReferenced } from './indexState.js'
import { versionsOf } from './versionStore.js'

export interface ReindexOutcome {
  docId: string
  version: number
  chunks: number
  /** missing:原文文件取不到(被手工删过,或上传时写盘失败)。 */
  status: 'ok' | 'missing'
  /** 这次写进 FTS 的切块代次;missing 时为 null。 */
  gen: string | null
  /**
   * 写完之后 FTS 与向量是否错位了。
   *
   * 只重建 FTS 本来就会造成错位 —— 这里**如实返回**,由调用方警告。检索侧会
   * 据此拒绝融合、退成单路。把它悄悄抹平才是危险的:那等于让两个索引对同一个
   * chunk_index 指向不同的文字,而没有任何人知道。
   */
  mismatch: boolean
}

/**
 * 重建这些文档的 BM25 索引。
 *
 * `readMarkdown` 由调用方注入 —— 生产传 documentStore 的 readRawMarkdown,
 * 测试传内存 map,这样测试不必碰文件系统。
 *
 * 单篇取不到原文时记 missing 继续下一篇,不中断整次重建:一次全量回填涉及
 * 全部文档,为一篇缺失而整体失败会让人无从下手。
 */
export function reindexFts(
  db: DB,
  docIds: readonly string[],
  readMarkdown: (docId: string, version: number) => string | null,
): ReindexOutcome[] {
  return docIds.flatMap(docId => versionsOf(db, docId).map(version => {
    const md = readMarkdown(docId, version)
    if (md === null) return { docId, version, chunks: 0, status: 'missing' as const, gen: null, mismatch: false }
    const { chunks } = parseMarkdown(md)
    const gen = computeGen(chunks)
    const before = getIndexState(db, docId, version)
    db.transaction(() => {
      // upsert 是「先删后插」,所以原文改短后不会留下过时的旧块。
      upsertChunkFts(db, docId, gen, chunks)
      setFtsGen(db, docId, version, gen)
      sweepFts(db, docId, version, gen)
    })()
    const state = getIndexState(db, docId, version)
    return {
      docId,
      version,
      chunks: chunks.length,
      status: 'ok' as const,
      gen,
      // 没有状态行 = legacy,两路都还没代次化,谈不上错位。
      mismatch: state !== null && state.active_gen !== gen,
    }
  }))
}

/**
 * 清掉这篇里没有任何版本在用的 FTS 代次 —— 原文改短、切块变了之后,旧块不能
 * 留着被召回。
 *
 * 「在用」看状态表:任何版本的任何一路引用着就留。没有状态行的版本(legacy)
 * 说不清自己的行属于哪一代,所以只有当本篇其他版本**都有**状态行时才敢扫 ——
 * 这时没被引用的行只可能是当前这个版本的旧行。
 */
function sweepFts(db: DB, docId: string, version: number, gen: string): void {
  const others = versionsOf(db, docId).filter(v => v !== version)
  if (others.some(v => getIndexState(db, docId, v) === null)) return
  for (const g of listFtsGens(db, docId)) {
    if (g !== gen && !isGenReferenced(db, docId, g, NO_VERSION)) deleteChunkFtsGen(db, docId, g)
  }
}

/** 传给 isGenReferenced 的「排除版本」:不排除任何版本。 */
const NO_VERSION = -1
