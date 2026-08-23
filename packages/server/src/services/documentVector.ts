// packages/server/src/services/documentVector.ts
import { ChromaClient } from 'chromadb'
import { embedBatch, isEmbeddingAvailable, ZhipuEmbeddingFunction } from './embeddings.js'
import { RAG } from './ragConfig.js'
import type { MdChunk } from './markdownParser.js'
import type { DocumentChunk } from '../types.js'

const COLLECTION_NAME = 'research_docs'
const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000'
const LOG_RETRIEVAL = /^(1|true)$/i.test(process.env.LOG_RETRIEVAL ?? '')

type ChromaCollection = Awaited<ReturnType<ChromaClient['getOrCreateCollection']>>

let _client: ChromaClient | null = null
let _collection: ChromaCollection | null = null
let _available = false

export async function initDocCollection(): Promise<void> {
  if (!isEmbeddingAvailable()) {
    console.warn('[documentVector] Embedding 不可用 — 文档检索关闭')
    return
  }
  try {
    _client = new ChromaClient({ path: CHROMA_URL })
    _collection = await _client.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: new ZhipuEmbeddingFunction(),
    })
    _available = true
    console.info(`[documentVector] ChromaDB connected — collection "${COLLECTION_NAME}"`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[documentVector] ChromaDB unavailable (${msg}) — 检索关闭`)
  }
}

export function isDocVectorAvailable(): boolean {
  return _available
}

export async function upsertChunks(docId: string, filename: string, chunks: MdChunk[]): Promise<void> {
  if (!_available || !_collection || chunks.length === 0) return
  try {
    const texts = chunks.map(c => c.content)
    const embeddings = await embedBatch(texts)
    const ids = chunks.map(c => `${docId}_chunk_${c.chunk_index}`)
    const metadatas = chunks.map(c => ({
      doc_id: docId,
      filename,
      chunk_index: c.chunk_index,
      section_title: c.section_title,
      section_slug: c.section_slug,
    }))
    await _collection.upsert({ ids, embeddings, documents: texts, metadatas })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[documentVector] upsertChunks failed: ${msg}`)
  }
}

export async function searchChunks(query: string, docId: string, limit = RAG.poolSize): Promise<DocumentChunk[]> {
  if (!_available || !_collection) return []
  const queryEmbedding = (await embedBatch([query]))[0]
  const results = await _collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: limit,
    where: { doc_id: { $eq: docId } },
  })
  const documents = results.documents[0] ?? []
  const metadatas = results.metadatas[0] ?? []
  const distances = results.distances?.[0] ?? []
  const meta = (i: number) => (metadatas[i] as Record<string, unknown>) ?? {}

  const hits: DocumentChunk[] = documents.map((_, i) => ({
    doc_id: String(meta(i).doc_id ?? ''),
    filename: String(meta(i).filename ?? ''),
    chunk_index: Number(meta(i).chunk_index ?? 0),
    content: documents[i] ?? '',
    distance: distances[i] ?? null,
    section_title: String(meta(i).section_title ?? ''),
    section_slug: String(meta(i).section_slug ?? ''),
  }))

  if (LOG_RETRIEVAL) {
    console.error(`🔍 向量 q="${query.slice(0, 40)}" 召回 ${hits.length} 块`)
  }
  return hits
}

export async function deleteByDocId(docId: string): Promise<void> {
  if (!_available || !_collection) return
  try {
    await _collection.delete({ where: { doc_id: { $eq: docId } } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[documentVector] deleteByDocId failed: ${msg}`)
  }
}
