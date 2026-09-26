// packages/server/src/services/importRaw.ts
//
// 从 data/raw/*.md 把文档「登记」进库:建 documents 行 + 写 BM25 索引。
//
// 与 reindex 的分工:reindex 假设 documents 行已经在了(它是给存量文档补索引的),
// 而这里处理的是**库里根本没有这一行**的情况 —— 原文是从别处搬来的(生产环境
// 拉下来的语料、别人给的一批研报),走不了上传接口。
//
// doc_id 直接取文件名(`data/raw/<id>.md` 去掉后缀),不重新生成:
// 原文和向量库都按这个 id 对应,重编号会让三者全部失联。
//
// **建索引不在这里** —— 两路索引都归 indexRebuild 管,因为它们必须和代次一起
// 翻转:FTS 换代和 active_gen 翻转要在同一个事务里,向量还要先写新代、验证过
// 才算数。这里只负责「让库里有这一行」,拿到 outcome 后交给 rebuildDocs。

import type { DB } from './db.js'
import { parseMarkdown } from './markdownParser.js'
import type { MdChunk } from './markdownParser.js'
import { uploadedAtFromId } from './documentStore.js'

export interface ImportOutcome {
  docId: string
  /** 展示名:取原文的 H1,没有 H1 就退回 doc_id。 */
  filename: string
  chunks: number
  /** missing:`data/raw/<id>.md` 取不到。 */
  status: 'ok' | 'missing'
  /** 切好的块,调用方拿去建索引。missing 时为空数组。 */
  parsed: MdChunk[]
}

/**
 * 登记这些文档。
 *
 * `readMarkdown` 由调用方注入 —— 脚本传 documentStore 的 readRawMarkdown,
 * 测试传内存 map,这样测试不必碰文件系统(与 reindexFts 一致)。
 *
 * 可重复执行:同一个 id 再导一次是就地更新,不会变成两行,也不会把
 * created_at 刷成今天(那会让文档列表的顺序每次重导都乱一次)。
 *
 * 新登记的行也不写「导入那一刻」:id 里编着当初的上传时刻,用它。否则一批老研报
 * 会整体排到导入前上传的新研报前面,首页日期也全是导入那天。
 */
export function importRawDocs(
  db: DB,
  docIds: readonly string[],
  readMarkdown: (docId: string) => string | null,
): ImportOutcome[] {
  const upsert = db.prepare(`
    INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      filename    = excluded.filename,
      size_bytes  = excluded.size_bytes,
      chunk_count = excluded.chunk_count
  `)

  return docIds.map(docId => {
    const md = readMarkdown(docId)
    if (md === null) {
      return { docId, filename: docId, chunks: 0, status: 'missing' as const, parsed: [] }
    }

    const { displayName, chunks } = parseMarkdown(md)
    const filename = displayName || docId

    // 字节数而非字符数:中文一个字三字节,用 md.length 会把体积算少三分之二。
    const createdAt = uploadedAtFromId(docId) ?? new Date().toISOString()
    upsert.run(docId, filename, Buffer.byteLength(md, 'utf8'), chunks.length, createdAt)

    return { docId, filename, chunks: chunks.length, status: 'ok' as const, parsed: chunks }
  })
}
