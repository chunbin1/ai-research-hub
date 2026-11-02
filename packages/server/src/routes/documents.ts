// packages/server/src/routes/documents.ts
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { describeRoute } from '../openapi/doc.js'
import { parseMarkdown } from '../services/markdownParser.js'
import {
  saveDocument, getAllDocuments, getDocument, deleteDocument, setDocumentKind,
  readVersionMarkdown, readRawMarkdown, deleteRawMarkdown,
} from '../services/documentStore.js'
import { deleteByDocId } from '../services/documentVector.js'
import { deleteChunkFts } from '../services/chunkFts.js'
import { deleteIndexState } from '../services/indexState.js'
import { listVersions, latestVersion, deleteVersions } from '../services/versionStore.js'
import { SameContentError } from '../services/documentVersion.js'
import { inferKind, isReportKind, type ReportKind } from '../services/reportKind.js'
import { getDb } from '../services/db.js'
import { findSimilarUploads, publishVersion, NOTE_MAX } from '../services/publishReport.js'
import { requireAdmin } from './auth.js'

/** 读上传的 markdown。出错时已经回了 4xx,返回 null。 */
async function readUpload(
  request: FastifyRequest, reply: FastifyReply,
): Promise<{ md: string; baseName: string; note: string | null; kind: ReportKind | null } | null> {
  const data = await request.file()
  if (!data) { reply.status(400).send({ error: '未上传文件' }); return null }
  if (!/\.(md|markdown|txt)$/i.test(data.filename)) {
    reply.status(400).send({ error: '只支持 .md / .markdown / .txt 文件' })
    return null
  }
  // 先读字段再 toBuffer:文件之前的字段此时已经解析完
  const kind = readKind(data)
  if (kind === 'invalid') { reply.status(400).send({ error: 'invalid_kind' }); return null }
  const md = (await data.toBuffer()).toString('utf8')
  if (!md.trim()) { reply.status(422).send({ error: '文件内容为空' }); return null }
  return { md, baseName: data.filename.replace(/\.(md|markdown|txt)$/i, ''), note: readNote(data), kind }
}

/** 文件前面的普通表单字段;客户端必须先 append 它再 append file,否则这里读不到。 */
function readField(data: MultipartFile, name: string): string | null {
  const f = data.fields[name]
  const field = Array.isArray(f) ? f[0] : f
  if (!field || field.type !== 'field') return null
  return String(field.value ?? '')
}

function readNote(data: MultipartFile): string | null {
  const note = (readField(data, 'note') ?? '').trim().slice(0, NOTE_MAX)
  return note || null
}

/** 没传返回 null;传了但不是合法类型返回 'invalid' */
function readKind(data: MultipartFile): ReportKind | null | 'invalid' {
  const v = readField(data, 'kind')?.trim()
  if (!v) return null
  return isReportKind(v) ? v : 'invalid'
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents', describeRoute(
    ['documents'],
    '研报列表',
    '公开读。返回 `{ documents }`。每项含 id、filename、size_bytes、chunk_count、created_at、kind（industry 或 company）、latest_version、updated_at。',
  ), async () => ({ documents: getAllDocuments() }))

  /** ?version=n 取指定版本;不传就是最新版。 */
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/documents/:id', describeRoute(
    ['documents'],
    '研报正文',
    '公开读。路径参数 id 是研报 id。查询参数 version 指定版本号；不传则返回最新版。没有这篇返回 404 `{ error: "not_found" }`；版本不存在返回 404 `{ error: "version_not_found" }`。成功时返回 `{ document, markdown, version, versions }`。',
  ), async (request, reply) => {
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
    const filename = displayName || up.baseName
    const doc = saveDocument({
      filename,
      // 弹窗里管理员选的为准;脚本 / curl 不带就按标题推断,拿不准按行业研报
      kind: up.kind ?? inferKind(filename) ?? 'industry',
      size_bytes: Buffer.byteLength(up.md, 'utf8'),
      chunk_count: chunks.length,
    })
    await publishVersion(doc.id, up.md, { note: up.note, fallbackName: up.baseName }, app.log)
    return { document: getDocument(doc.id) }
  })

  /**
   * 上传前查重:库里最相近的 3 篇,交给上传弹窗让管理员选「作为其中一篇的新版本」还是「新建」。
   * 只读,不落任何东西。向量不可用或出错时退回只按标题、正文排,不让查重失败。
   */
  app.post('/documents/similar', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const up = await readUpload(request, reply)
    if (!up) return

    const title = parseMarkdown(up.md).displayName || up.baseName
    const suggestedKind = inferKind(title)
    // 只在同类之间查重。上传方类型:管理员在弹窗里选的 > 按标题推断的建议 > 未知(不过滤)
    const kind = up.kind ?? suggestedKind ?? undefined
    const candidates = await findSimilarUploads({ title, markdown: up.md, kind }, app.log)
    return { title, suggestedKind, candidates }
  })

  /** 改研报类型。预填错了可以改,不用删掉重传 —— 删除会连版本和问答记录一起丢。 */
  app.patch<{ Params: { id: string }; Body: { kind?: unknown } }>('/documents/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    const kind = request.body?.kind
    if (!isReportKind(kind)) return reply.status(400).send({ error: 'invalid_kind' })
    setDocumentKind(doc.id, kind)
    return { document: getDocument(doc.id) }
  })

  app.post<{ Params: { id: string } }>('/documents/:id/versions', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    const up = await readUpload(request, reply)
    if (!up) return

    try {
      const created = await publishVersion(doc.id, up.md, { note: up.note, fallbackName: doc.filename }, app.log)
      return { document: getDocument(doc.id), version: created.version }
    } catch (err) {
      if (err instanceof SameContentError) {
        return reply.status(409).send({ error: 'same_content', message: err.message })
      }
      throw err
    }
  })

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
