// packages/server/src/services/documentVector.ts
import { ChromaClient, type Where } from 'chromadb'
import { embedBatch, isEmbeddingAvailable, ZhipuEmbeddingFunction } from './embeddings.js'
import { RAG } from './ragConfig.js'
import { LEGACY_GEN, vectorId } from './indexGen.js'
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

/** doc_id 过滤,可选叠加代次过滤。gen 为 null 表示 legacy 模式(库里没有代次标记)。 */
function scopeWhere(docId: string, gen: string | null): Where {
  return gen === null
    ? { doc_id: { $eq: docId } }
    : { $and: [{ doc_id: { $eq: docId } }, { gen: { $eq: gen } }] }
}

/**
 * 写入某一代的向量。
 *
 * **失败会抛出。** 以前这里把异常吞成一条 warn 就正常返回,于是调用方拿不到
 * 真相:`import:raw` 的循环照样给每篇打勾,一篇 embedding 全挂也看不出来 ——
 * 那个勾来自「解析出了多少块」,不是「写进去了多少块」。索引是否建成是重建
 * 流程的核心判据,不能靠猜。
 */
export async function upsertChunks(
  docId: string,
  filename: string,
  chunks: MdChunk[],
  gen: string,
): Promise<void> {
  if (!_available || !_collection || chunks.length === 0) return
  const texts = chunks.map(c => c.content)
  const embeddings = await embedBatch(texts)
  const ids = chunks.map(c => vectorId(docId, gen, c.chunk_index))
  const metadatas = chunks.map(c => ({
    doc_id: docId,
    filename,
    gen,
    chunk_index: c.chunk_index,
    section_title: c.section_title,
    section_slug: c.section_slug,
  }))
  await _collection.upsert({ ids, embeddings, documents: texts, metadatas })
}

export async function searchChunks(
  query: string,
  docId: string,
  limit = RAG.poolSize,
  gen: string | null = null,
): Promise<DocumentChunk[]> {
  if (!_available || !_collection) return []
  const queryEmbedding = (await embedBatch([query]))[0]
  const results = await _collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: limit,
    where: scopeWhere(docId, gen),
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

/** 某篇某一代实际存了多少块 —— 重建后用它验证,而不是看 upsert 的返回值。 */
export async function countChunks(docId: string, gen: string | null): Promise<number> {
  if (!_available || !_collection) return 0
  const got = await _collection.get({ where: scopeWhere(docId, gen), include: [] })
  return got.ids.length
}

/** 删掉某篇某一代 —— 翻转到新代之后回收旧代用。 */
export async function deleteByGen(docId: string, gen: string): Promise<void> {
  if (!_available || !_collection) return
  await _collection.delete({ where: scopeWhere(docId, gen) })
}

/**
 * 给本次改动之前写入的向量补上 `gen: 'legacy'` 标记。
 *
 * 只改元数据,不重新 embedding,所以不花钱也很快。必须在写入任何新代之前做 ——
 * 否则这篇会处于「旧向量没标记、新向量有标记」的状态,而 legacy 模式的查询不加
 * 代次过滤,会把两代一起捞回来。
 *
 * 返回补了多少条。
 */
export async function stampLegacy(docId: string): Promise<number> {
  if (!_available || !_collection) return 0
  const got = await _collection.get({
    where: { doc_id: { $eq: docId } },
    include: ['metadatas'],
  })
  const ids: string[] = []
  const metadatas: Record<string, unknown>[] = []
  got.ids.forEach((id, i) => {
    const m = (got.metadatas?.[i] as Record<string, unknown> | null) ?? {}
    if (m.gen) return
    ids.push(id)
    metadatas.push({ ...m, gen: LEGACY_GEN })
  })
  if (ids.length === 0) return 0
  await _collection.update({ ids, metadatas: metadatas as never })
  return ids.length
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
