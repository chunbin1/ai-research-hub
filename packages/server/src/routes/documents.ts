// packages/server/src/routes/documents.ts
import type { FastifyPluginAsync } from 'fastify'
import { parseMarkdown } from '../services/markdownParser.js'
import {
  saveDocument, getAllDocuments, getDocument, deleteDocument,
  saveRawMarkdown, readRawMarkdown, deleteRawMarkdown,
} from '../services/documentStore.js'
import { upsertChunks, deleteByDocId, isDocVectorAvailable } from '../services/documentVector.js'
import { requireAdmin } from './auth.js'

export const documentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/documents', async () => ({ documents: getAllDocuments() }))

  app.get<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    const markdown = readRawMarkdown(doc.id) ?? ''
    return { document: doc, markdown }
  })

  app.post('/documents', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: '未上传文件' })
    if (!/\.(md|markdown|txt)$/i.test(data.filename)) {
      return reply.status(400).send({ error: '只支持 .md / .markdown / .txt 文件' })
    }
    const buffer = await data.toBuffer()
    const md = buffer.toString('utf8')
    if (!md.trim()) return reply.status(422).send({ error: '文件内容为空' })

    const { displayName, chunks } = parseMarkdown(md)
    const baseName = data.filename.replace(/\.(md|markdown|txt)$/i, '')
    const filename = displayName || baseName

    const doc = saveDocument({ filename, size_bytes: buffer.length, chunk_count: chunks.length })
    saveRawMarkdown(doc.id, md)

    if (isDocVectorAvailable()) {
      upsertChunks(doc.id, doc.filename, chunks).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        app.log.warn(`[documents] upsertChunks failed for ${doc.id}: ${msg}`)
      })
    }
    return { document: doc }
  })

  app.delete<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const doc = getDocument(request.params.id)
    if (!doc) return reply.status(404).send({ error: 'not_found' })
    await deleteByDocId(doc.id)
    deleteRawMarkdown(doc.id)
    deleteDocument(doc.id)
    return { success: true }
  })
}
