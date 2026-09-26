// packages/server/src/services/documentVersion.ts
//
// 给文档加一个版本:上传新文档(v1)和上传新版本走的是同一条路。
//
// 顺序和上传一直以来的做法一致:
//   1. 原文落盘(版本文件 + 最新版镜像)、版本记录、documents 摘要
//   2. 一个事务:写这一代的 FTS + 这个版本的状态行(vec_gen 如实记 none)
//   3. 后台写向量,写完再把 vec_gen 翻成这一代
//
// 第 2 步之后这个版本就能用 BM25 查了;向量落库之前检索侧会降级成纯 BM25
// 并留下 trace。向量写失败只记日志,可以用 `pnpm import:raw --doc=` 补。

import type { DB } from './db.js'
import type { DocumentVersion } from '../types.js'
import { parseMarkdown, type MdChunk } from './markdownParser.js'
import { computeGen, LEGACY_GEN, NO_GEN } from './indexGen.js'
import { upsertChunkFts } from './chunkFts.js'
import { getIndexState, putIndexState } from './indexState.js'
import { insertVersion, latestVersion, listVersions, registerVersion } from './versionStore.js'
import {
  getAllDocuments, readRawMarkdown, saveRawMarkdown, saveVersionMarkdown, readVersionMarkdown,
  listVersionFiles, updateDocumentSummary,
} from './documentStore.js'

export interface VersionDeps {
  /** 向量库不可用时为 false:只建 BM25,不碰向量。 */
  vectorsAvailable: boolean
  stampLegacy: (docId: string) => Promise<number>
  writeVectors: (docId: string, filename: string, chunks: MdChunk[], gen: string) => Promise<void>
  embedModel: string
}

/** 新版本和最新版切块完全相同 —— 上传了等于没传。 */
export class SameContentError extends Error {
  constructor(public readonly latest: number) {
    super(`内容和最新版 v${latest} 一致`)
    this.name = 'SameContentError'
  }
}

export interface CreatedVersion {
  version: DocumentVersion
  gen: string
  /** 后台写向量的那个 promise;向量库不可用时为 null。失败会 reject,由调用方记日志。 */
  vectors: Promise<void> | null
}

/**
 * 给已存在的 documents 行加一个版本。
 *
 * `fallbackName` 是原文里没有 H1 时的展示名(上传时的文件名)。
 */
export async function createVersion(
  db: DB,
  docId: string,
  md: string,
  opts: { note?: string | null; fallbackName: string },
  deps: VersionDeps,
): Promise<CreatedVersion> {
  const { displayName, chunks } = parseMarkdown(md)
  const gen = computeGen(chunks)
  const filename = displayName || opts.fallbackName

  const prev = latestVersion(db, docId)
  if (prev !== null) {
    const prevMd = readVersionMarkdown(docId, prev)
    if (prevMd !== null && computeGen(parseMarkdown(prevMd).chunks) === gen) throw new SameContentError(prev)
    await pinLegacyVersions(db, docId, deps)
  }

  const summary = { filename, size_bytes: Buffer.byteLength(md, 'utf8'), chunk_count: chunks.length }
  const version = insertVersion(db, { doc_id: docId, ...summary, note: opts.note ?? null })
  saveVersionMarkdown(docId, version.version, md)
  saveRawMarkdown(docId, md)
  updateDocumentSummary(docId, summary)

  // 关键词索引:纯本地 SQLite,同步写。它不依赖任何外部服务,
  // 所以不像向量那样做成 fire-and-forget —— 失败就是真失败。
  //
  // 代次此刻只有 FTS 这一路就位,vec_gen 如实记成 none:在向量落库之前,
  // 这个版本的检索本来就只有 BM25,检索侧会据此降级并留下 trace。
  db.transaction(() => {
    upsertChunkFts(db, docId, gen, chunks)
    putIndexState(db, {
      doc_id: docId,
      version: version.version,
      active_gen: gen,
      vec_gen: NO_GEN,
      fts_gen: gen,
      embed_model: deps.embedModel,
    })
  })()

  const vectors = deps.vectorsAvailable
    ? deps.writeVectors(docId, filename, chunks, gen).then(() => {
      // 向量写完之前文档可能已经被删了,别把状态行复活成孤儿。
      if (getIndexState(db, docId, version.version) === null) return
      putIndexState(db, {
        doc_id: docId,
        version: version.version,
        active_gen: gen,
        vec_gen: gen,
        fts_gen: gen,
        embed_model: deps.embedModel,
      })
    })
    : null

  return { version, gen, vectors }
}

/**
 * 给还没有代次状态的旧版本落一行 legacy 状态。
 *
 * 没有状态行时查询不加代次过滤 —— 单版本时这没问题,但新版本一写进来,
 * 旧版本的查询就会把新版本的块一起捞回来。所以写新版本**之前**,先把旧
 * 向量盖上 legacy 标记,并把旧版本钉在 legacy 这一代上。
 * 迁移时 FTS 的存量行也是记在 legacy 名下的,两路对得上。
 */
async function pinLegacyVersions(db: DB, docId: string, deps: VersionDeps): Promise<void> {
  const unpinned = listVersions(db, docId).filter(v => getIndexState(db, docId, v.version) === null)
  if (unpinned.length === 0) return
  if (deps.vectorsAvailable) await deps.stampLegacy(docId)
  for (const v of unpinned) {
    putIndexState(db, {
      doc_id: docId,
      version: v.version,
      active_gen: LEGACY_GEN,
      vec_gen: LEGACY_GEN,
      fts_gen: LEGACY_GEN,
      embed_model: deps.embedModel,
    })
  }
}

/**
 * 给版本化之前的文档补上版本记录。启动时和 import:raw 里都会跑,幂等,不调任何 API。
 *
 * - 磁盘上已经有版本文件(从别的环境整个拷过来的 data/raw)→ 按文件登记
 * - 否则把最新版镜像 `{id}.md` 登记成 v1,并复制一份到版本目录
 *
 * 返回补登记了多少篇。
 */
export function migrateLegacyVersions(db: DB): number {
  let migrated = 0
  for (const doc of getAllDocuments()) {
    if (listVersions(db, doc.id).length > 0) continue

    const files = listVersionFiles(doc.id)
    if (files.length > 0) {
      for (const n of files) {
        const md = readVersionMarkdown(doc.id, n)!
        const { displayName, chunks } = parseMarkdown(md)
        registerVersion(db, {
          doc_id: doc.id,
          version: n,
          filename: displayName || doc.filename,
          size_bytes: Buffer.byteLength(md, 'utf8'),
          chunk_count: chunks.length,
          note: null,
          created_at: doc.created_at,
        })
      }
      migrated++
      continue
    }

    const md = readRawMarkdown(doc.id)
    if (md === null) {
      console.warn(`[versions] ${doc.id} 原文缺失,无法登记 v1`)
      continue
    }
    saveVersionMarkdown(doc.id, 1, md)
    registerVersion(db, {
      doc_id: doc.id,
      version: 1,
      filename: doc.filename,
      size_bytes: doc.size_bytes,
      chunk_count: doc.chunk_count,
      note: null,
      created_at: doc.created_at,
    })
    migrated++
  }
  return migrated
}
