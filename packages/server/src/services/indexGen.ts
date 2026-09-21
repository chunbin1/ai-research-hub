// packages/server/src/services/indexGen.ts
//
// 索引代次(generation):一篇文档的「这一版切块」的身份。
//
// ## 为什么需要它
//
// 融合按 `doc_id#chunk_index` 对齐两路。切块规则一改,编号整体平移 ——
// 实测改一次切块,CNOOC 47 个编号里只有 27 个还指向同一段文字。此时若只重建
// 了一路(`reindex` 只管 FTS),同一个键在 FTS 和 Chroma 里指的就是不同的文字。
// **不报错,只是悄悄把错块塞进 prompt。**
//
// 代次把「这批向量属于哪一版切块」写进数据本身,于是:
//   · 两路对不上 → 查得出来,降级而不是返回错块
//   · 新旧两代可以共存 → 重建期间旧代继续服务,失败不伤线上
//   · 已经是目标代次的 → 直接跳过,重建天然可续传
//
// ## 为什么是哈希而不是手工版本号
//
// 手工维护的 `CHUNKER_VERSION = 2` 依赖人记得改。这里直接对**切块结果**取哈希:
// 解析器行为变了,输出就变,代次自动变;解析器改了但输出逐字节相同,代次不变 ——
// 那本来也不需要重建。没有「忘记 +1」这种失效模式。

import { createHash } from 'node:crypto'
import type { MdChunk } from './markdownParser.js'

/** 本次改动之前写入的向量没有代次标记,统一按这个名字登记。 */
export const LEGACY_GEN = 'legacy'

/**
 * 「这一路还没有当前代次的数据」。
 *
 * 上传时 FTS 是同步写的、向量是后台写的,中间这段时间向量路确实是空的 ——
 * 与其乐观地标成已就位(向量建失败就成了谎报),不如如实记 none,让检索侧
 * 降级成纯 BM25 并留下 trace。向量落库后再翻成真正的代次。
 */
export const NO_GEN = 'none'

/** 字段分隔符:正文里不可能出现 NUL,拿它当边界不会被内容伪造。 */
const SEP = '\u0000'

/**
 * 由切块结果派生代次。
 *
 * 参与哈希的是编号、起止偏移和正文 —— 也就是「检索会看到什么」。章节标题一类
 * 的派生字段不参与:它们由正文和标题行决定,已经间接包含在内。
 */
export function computeGen(chunks: readonly MdChunk[]): string {
  const h = createHash('sha256')
  h.update(`n=${chunks.length}`)
  for (const c of chunks) {
    h.update(`${SEP}${c.chunk_index}${SEP}${c.char_start}${SEP}${c.char_end}${SEP}${c.content}`)
  }
  return h.digest('hex').slice(0, 12)
}

/** 向量在 Chroma 里的 id。带上代次,新旧两代才能共存。 */
export function vectorId(docId: string, gen: string, chunkIndex: number): string {
  return `${docId}_g${gen}_chunk_${chunkIndex}`
}
