// packages/server/src/routes/documents.ts
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { parseMarkdown } from '../services/markdownParser.js'
import {
  saveDocument, getAllDocuments, getDocument, deleteDocument,
  readVersionMarkdown, readRawMarkdown, deleteRawMarkdown,
} from '../services/documentStore.js'
import { upsertChunks, deleteByDocId, isDocVectorAvailable, stampLegacy } from '../services/documentVector.js'
import { deleteChunkFts } from '../services/chunkFts.js'
import { deleteIndexState } from '../services/indexState.js'
import { listVersions, latestVersion, deleteVersions } from '../services/versionStore.js'
import { createVersion, SameContentError, type VersionDeps } from '../services/documentVersion.js'
import { embeddingModel } from '../services/embeddings.js'
import { getDb } from '../services/db.js'
import { syncWatchlistFromMarkdown } from '../services/signals/watchlistSync.js'
import { requireAdmin } from './auth.js'

const NOTE_MAX = 200

function versionDeps(): VersionDeps {
  return {
    vectorsAvailable: isDocVectorAvailable(),
    stampLegacy,
    writeVectors: upsertChunks,
    embedModel: embeddingModel(),
  }
}

/** 读上传的 markdown。出错时已经回了 4xx,返回 null。 */
async function readUpload(
  request: FastifyRequest, reply: FastifyReply,
): Promise<{ md: string; baseName: string; note: string | null } | null> {
  const data = await request.file()
  if (!data) { reply.status(400).send({ error: '未上传文件' }); return null }
  if (!/\.(md|markdown|txt)$/i.test(data.filename)) {
    reply.status(400).send({ error: '只支持 .md / .markdown / .txt 文件' })
    return null
  }
  const md = (await data.toBuffer()).toString('utf8')
  if (!md.trim()) { reply.status(422).send({ error: '文件内容为空' }); return null }
  return { md, baseName: data.filename.replace(/\.(md|markdown|txt)$/i, ''), note: readNote(data) }
}

/** 更新说明是文件前面的普通表单字段;客户端必须先 append note 再 append file,否则这里读不到。 */
function readNote(data: MultipartFile): string | null {
  const f = data.fields.note
  const field = Array.isArray(f) ? f[0] : f
  if (!field || field.type !== 'field') return null
  const note = String(field.value ?? '').trim().slice(0, NOTE_MAX)
  return note || null
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents', async () => ({ documents: getAllDocuments() }))

  /** ?version=n 取指定版本;不传就是最新版。 */
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/documents/:id', async (request, reply) => {
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    const db = getDb()
    const versions = listVersions(db, doc.id)
    const raw = request.query.version
    // 原文缺失的旧文档迁移不出版本记录 —— 照旧按 v1 返回(正文为空),不能 404 掉整篇
    if (versions.length === 0 && raw === undefined) {
      return { document: doc, markdown: readRawMarkdown(doc.id) ?? '', version: 1, versions }
    }
    const latest = latestVersion(db, doc.id) ?? 1
    const version = raw === undefined ? latest : Number(raw)
    if (!Number.isInteger(version) || !versions.some(v => v.version === version)) {
      return reply.status(404).send({ error: 'version_not_found' })
    }
    const markdown = readVersionMarkdown(doc.id, version) ?? ''
    return { document: doc, markdown, version, versions }
  })

  app.post('/documents', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const up = await readUpload(request, reply)
    if (!up) return

    const { displayName, chunks } = parseMarkdown(up.md)
    const doc = saveDocument({
      filename: displayName || up.baseName,
      size_bytes: Buffer.byteLength(up.md, 'utf8'),
      chunk_count: chunks.length,
    })
    await addVersion(doc.id, up)
    return { document: getDocument(doc.id) }
  })

  app.post<{ Params: { id: string } }>('/documents/:id/versions', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    const up = await readUpload(request, reply)
    if (!up) return

    try {
      const created = await addVersion(doc.id, { ...up, baseName: doc.filename })
      return { document: getDocument(doc.id), version: created.version }
    } catch (err) {
      if (err instanceof SameContentError) {
        return reply.status(409).send({ error: 'same_content', message: err.message })
      }
      throw err
    }
  })

  async function addVersion(docId: string, up: { md: string; baseName: string; note: string | null }) {
    const created = await createVersion(getDb(), docId, up.md, { note: up.note, fallbackName: up.baseName }, versionDeps())
    created.vectors?.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.warn(`[documents] ${docId} v${created.version.version} 向量写入失败: ${msg}`)
    })

    // 从标题抽标的进自选股。抽取失败不该让上传失败 —— 上传的主职责是存报告。
    try {
      const symbols = syncWatchlistFromMarkdown(docId, up.md)
      if (symbols.length) app.log.info(`[watchlist] ${docId} 抽到 ${symbols.join(', ')}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      app.log.warn(`[watchlist] ${docId} 抽取失败: ${msg}`)
    }
    return created
  }

  app.delete<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    await deleteByDocId(doc.id)
    deleteChunkFts(getDb(), doc.id)
    deleteIndexState(getDb(), doc.id)
    deleteVersions(getDb(), doc.id)
    deleteRawMarkdown(doc.id)
    deleteDocument(doc.id)
    return { success: true }
  })
}
