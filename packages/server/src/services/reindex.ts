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
import { upsertChunkFts } from './chunkFts.js'

export interface ReindexOutcome {
  docId: string
  chunks: number
  /** missing:原文文件取不到(被手工删过,或上传时写盘失败)。 */
  status: 'ok' | 'missing'
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
  readMarkdown: (docId: string) => string | null,
): ReindexOutcome[] {
  return docIds.map(docId => {
    const md = readMarkdown(docId)
    if (md === null) return { docId, chunks: 0, status: 'missing' as const }
    const { chunks } = parseMarkdown(md)
    // upsert 是「先删后插」,所以原文改短后不会留下过时的旧块。
    upsertChunkFts(db, docId, chunks)
    return { docId, chunks: chunks.length, status: 'ok' as const }
  })
}
