// packages/server/src/services/indexRebuild.ts
//
// 按**篇**重建索引:先把新代写进去并验证,再用一个事务翻转。
//
// ## 为什么这个顺序能扛住中途失败
//
// 旧的做法是「全库 FTS 先重建一遍 → 再逐篇建向量」。跑到第 9 篇挂掉,库里就是
// 新切块的 FTS + 旧切块的向量,编号对不上,而且不报错 —— 只是悄悄返回错块。
// 前 8 篇的 embedding 钱也白花了,因为重跑是全量重来。
//
// 现在每篇是这样:
//
//   1. 算出目标代次;已经是它了就**跳过**(续传就是这么来的)
//   2. 把新代写进 Chroma —— 用带代次的 id,旧代原地不动,而且查询不会看见它
//   3. 数一遍新代实到多少块,对不上就判失败(不看 upsert 的返回值)
//   4. 一个 SQLite 事务:重建该篇 FTS + 翻转 active_gen
//   5. 删旧代向量(尽力而为,失败只是留点垃圾,下次重建会清)
//
// 第 4 步之前任何一步崩掉,这篇仍然完整地服务旧代 —— 不是「坏了一半」,是
// 「还没升级」。重跑时它会从第 1 步重新判断,已完成的直接跳过。

import type { DB } from './db.js'
import { parseMarkdown, type MdChunk } from './markdownParser.js'
import { upsertChunkFts } from './chunkFts.js'
import { computeGen, LEGACY_GEN } from './indexGen.js'
import { getIndexState, putIndexState } from './indexState.js'

export interface RebuildDeps {
  readMarkdown: (docId: string) => string | null
  /** 给没有代次标记的存量向量补 legacy 标记,返回补了多少条。 */
  stampLegacy: (docId: string) => Promise<number>
  writeVectors: (docId: string, filename: string, chunks: MdChunk[], gen: string) => Promise<void>
  countVectors: (docId: string, gen: string) => Promise<number>
  deleteVectors: (docId: string, gen: string) => Promise<void>
  embedModel: string
}

export type RebuildStatus =
  | 'skipped'   // 已经是目标代次,什么也没做
  | 'rebuilt'   // 新代已就位并翻转
  | 'missing'   // data/raw 下取不到原文
  | 'failed'    // 中途出错;这篇仍然完整地停在旧代

export interface RebuildOutcome {
  docId: string
  filename: string
  status: RebuildStatus
  /** 目标代次;missing 时为 null。 */
  gen: string | null
  /** 这一代有多少块。 */
  chunks: number
  /** 从哪一代翻过来的;首次代次化时是 'legacy'。 */
  fromGen: string | null
  error?: string
}

export interface RebuildOptions {
  /** false:只重建 FTS,不碰向量(本地不想花 embedding 钱时用)。 */
  withVectors?: boolean
}

export async function rebuildDoc(
  db: DB,
  docId: string,
  deps: RebuildDeps,
  opts: RebuildOptions = {},
): Promise<RebuildOutcome> {
  const withVectors = opts.withVectors ?? true

  const md = deps.readMarkdown(docId)
  if (md === null) {
    return { docId, filename: docId, status: 'missing', gen: null, chunks: 0, fromGen: null }
  }

  const { displayName, chunks } = parseMarkdown(md)
  const filename = displayName || docId
  const gen = computeGen(chunks)

  // 存量向量没有代次标记。必须**先**给它们盖上 legacy 再写新代 —— 否则这篇
  // 处于「旧的没标记、新的有标记」的混合态,而没有状态行时查询不加代次过滤,
  // 会把两代一起捞回来。盖完立刻落一行 legacy 状态,把这个窗口关死。
  let state = getIndexState(db, docId)
  if (state === null) {
    if (withVectors) await deps.stampLegacy(docId)
    putIndexState(db, {
      doc_id: docId,
      active_gen: LEGACY_GEN,
      vec_gen: LEGACY_GEN,
      fts_gen: LEGACY_GEN,
      embed_model: deps.embedModel,
    })
    state = getIndexState(db, docId)!
  }

  const fromGen = state.active_gen
  const done =
    state.active_gen === gen &&
    state.fts_gen === gen &&
    state.embed_model === deps.embedModel &&
    (!withVectors || state.vec_gen === gen)
  if (done) {
    return { docId, filename, status: 'skipped', gen, chunks: chunks.length, fromGen }
  }

  if (withVectors) {
    try {
      await deps.writeVectors(docId, filename, chunks, gen)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { docId, filename, status: 'failed', gen, chunks: chunks.length, fromGen, error: msg }
    }

    // 不看 upsert 的返回值,数一遍真实落库的条数。以前那个「✓ 56 块」是解析
    // 出来的块数,写没写进去根本没人验。
    const actual = await deps.countVectors(docId, gen)
    if (actual !== chunks.length) {
      return {
        docId, filename, status: 'failed', gen, chunks: chunks.length, fromGen,
        error: `向量实到 ${actual} 块,应为 ${chunks.length} 块`,
      }
    }
  }

  // 这一步是原子的:FTS 换代和 active_gen 翻转要么都发生,要么都不发生。
  // withVectors=false 时故意不动 vec_gen —— 它就是和 active 对不上,如实记下来,
  // 检索侧会据此降级为纯 BM25,而不是假装两路都在。
  db.transaction(() => {
    upsertChunkFts(db, docId, chunks)
    putIndexState(db, {
      doc_id: docId,
      active_gen: gen,
      vec_gen: withVectors ? gen : state!.vec_gen,
      fts_gen: gen,
      embed_model: deps.embedModel,
    })
  })()

  // 旧代回收。失败不影响正确性 —— 查询按 active_gen 过滤,看不见旧代,
  // 它只是占点空间,下次重建还会再试一次。
  if (withVectors && fromGen !== gen) {
    try {
      await deps.deleteVectors(docId, fromGen)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[indexRebuild] ${docId} 旧代 ${fromGen} 回收失败(不影响正确性): ${msg}`)
    }
  }

  return { docId, filename, status: 'rebuilt', gen, chunks: chunks.length, fromGen }
}

/**
 * 逐篇重建。**一篇失败不中断后面的** —— 失败的那篇停在旧代,继续跑完其余的,
 * 最后由调用方统一报告。重跑时成功的会被跳过,只补失败的。
 */
export async function rebuildDocs(
  db: DB,
  docIds: readonly string[],
  deps: RebuildDeps,
  opts: RebuildOptions & { onDone?: (o: RebuildOutcome) => void } = {},
): Promise<RebuildOutcome[]> {
  const out: RebuildOutcome[] = []
  for (const docId of docIds) {
    const o = await rebuildDoc(db, docId, deps, opts)
    out.push(o)
    opts.onDone?.(o)
  }
  return out
}
