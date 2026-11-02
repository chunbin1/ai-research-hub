// packages/server/src/services/publishReport.ts
//
// 网页上传和 MCP upload_report 共用的落库。
// 建版本(原文、FTS、后台向量)并从标题抽自选股。向量或抽取失败不让上传失败。
import { createVersion, type CreatedVersion, type VersionDeps } from './documentVersion.js'
import { getAllDocuments, readRawMarkdown, readVersionMarkdown } from './documentStore.js'
import type { Document } from '../types.js'
import { upsertChunks, isDocVectorAvailable, stampLegacy } from './documentVector.js'
import { embeddingModel, embedBatch, isEmbeddingAvailable } from './embeddings.js'
import { findSimilarReports, topicScores, type SimilarReport } from './similarReports.js'
import { syncWatchlistFromMarkdown } from './signals/watchlistSync.js'
import { getDb } from './db.js'
import type { ReportKind } from './reportKind.js'

/** 版本说明上限。网页表单和 MCP 都按这个截断。 */
export const NOTE_MAX = 200

export interface PublishLog {
  info(msg: string): void
  warn(msg: string): void
}

function versionDeps(): VersionDeps {
  return {
    vectorsAvailable: isDocVectorAvailable(),
    stampLegacy,
    writeVectors: upsertChunks,
    embedModel: embeddingModel(),
  }
}

/**
 * 给已经建好的 documents 行加一个版本,并抽标题里的标的。
 * `fallbackName` 是原文没有一级标题时的展示名。
 */
export async function publishVersion(
  docId: string,
  md: string,
  opts: { note?: string | null; fallbackName: string },
  log: PublishLog,
): Promise<CreatedVersion> {
  const created = await createVersion(
    getDb(), docId, md,
    { note: opts.note ?? null, fallbackName: opts.fallbackName },
    versionDeps(),
  )
  created.vectors?.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn(`[documents] ${docId} v${created.version.version} 向量写入失败: ${msg}`)
  })

  // 从标题抽标的进自选股。抽取失败不该让上传失败 —— 上传的主职责是存报告。
  try {
    const symbols = syncWatchlistFromMarkdown(docId, md)
    if (symbols.length) log.info(`[watchlist] ${docId} 抽到 ${symbols.join(', ')}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn(`[watchlist] ${docId} 抽取失败: ${msg}`)
  }
  return created
}

export type SimilarUpload = { document: Document } & Omit<SimilarReport, 'id'>

/**
 * 上传前查重。向量不可用或出错时退回只按标题、正文排,不让查重失败。
 * 一篇都不像时返回空数组。
 */
export async function findSimilarUploads(
  upload: { title: string; markdown: string; kind?: ReportKind },
  log: PublishLog,
): Promise<SimilarUpload[]> {
  const docs = getAllDocuments()
  const existing = docs.map(d => ({
    id: d.id,
    title: d.filename,
    kind: d.kind,
    // 迁移不出版本记录的老文档只有 raw 原文
    markdown: readVersionMarkdown(d.id, d.latest_version) ?? readRawMarkdown(d.id),
  }))
  let topic: number[] | undefined
  if (isEmbeddingAvailable() && existing.length > 0) {
    try {
      topic = await topicScores(upload.markdown, existing, embedBatch, embeddingModel())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`[documents] 查重算主题相近度失败,只按标题和正文排: ${msg}`)
    }
  }
  const byId = new Map(docs.map(d => [d.id, d]))
  return findSimilarReports(upload, existing, topic)
    .flatMap(({ id, ...scores }) => {
      const document = byId.get(id)
      return document ? [{ document, ...scores }] : []
    })
}
